export type AcerTargetLocale = 'fr' | 'de' | 'es' | 'it' | 'nl' | 'fi'

export interface AcerLocaleTranslation {
  locale: AcerTargetLocale
  title: string
  description: string
  metaDescription: string
}

export const ACER_TARGET_LOCALES: AcerTargetLocale[] = ['fr', 'de', 'es', 'it', 'nl', 'fi']

const LOCALE_NAMES: Record<AcerTargetLocale, string> = {
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  nl: 'Dutch',
  fi: 'Finnish',
}

const LOCALE_STYLE_GUIDANCE: Record<AcerTargetLocale, string> = {
  fr: 'Use natural French retail terminology. Prefer "ordinateur portable" over "laptop". Avoid awkward mixed phrases like "Portable Gaming".',
  de: 'Use natural German retail terminology. Prefer "Notebook" for portable computers and avoid leftover English category nouns where a natural German term exists.',
  es: 'Use natural Spanish retail terminology. Prefer "portatil" or "ordenador portatil" over "laptop" where natural.',
  it: 'Use natural Italian retail terminology. Prefer "notebook" or "portatile" as appropriate, not raw English category phrases like "Gaming Laptop".',
  nl: 'Use natural Dutch retail terminology. Normalize common mixed terms and avoid leaving English memory phrases like "dedicated memory".',
  fi: 'Use natural Finnish retail terminology. Avoid stiff literal calques for memory or graphics phrasing.',
}

const LOCALE_FORBIDDEN_PATTERNS: Record<AcerTargetLocale, RegExp[]> = {
  fr: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bPortable Gaming\b/i],
  de: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
  es: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
  it: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
  nl: [/\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
  fi: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bjaettu muisti\b/i],
}

const LOCALE_TITLE_REPLACEMENTS: Record<AcerTargetLocale, Array<[RegExp, string]>> = {
  fr: [
    [/\bGaming Laptop\b/gi, 'ordinateur portable de jeu'],
    [/\bLaptop\b/gi, 'ordinateur portable'],
    [/\bPortable Gaming\b/gi, 'ordinateur portable de jeu'],
    [/\bCustodia Cabina\b/gi, 'valise cabine'],
  ],
  de: [
    [/\bGaming Laptop\b/gi, 'Gaming-Notebook'],
    [/\bLaptop\b/gi, 'Notebook'],
  ],
  es: [
    [/\bGaming Laptop\b/gi, 'portatil para juegos'],
    [/\bLaptop\b/gi, 'portatil'],
    [/\bPortatile\b/gi, 'portatil'],
  ],
  it: [
    [/\bGaming Laptop\b/gi, 'Notebook da gaming'],
    [/\bPortatile da Gioco\b/gi, 'Notebook da gaming'],
    [/\bLaptop\b/gi, 'Notebook'],
    [/\bCustodia Cabina\b/gi, 'Valigia da cabina'],
  ],
  nl: [
    [/\bGaming Laptop\b/gi, 'gaming-laptop'],
    [/\bNotebook\b/gi, 'laptop'],
    [/\bLaptop\b/g, 'laptop'],
  ],
  fi: [
    [/\bGaming Laptop\b/gi, 'pelikannettava'],
    [/\bKannettava Tietokone\b/g, 'kannettava tietokone'],
    [/\bPelikannettava\b/g, 'pelikannettava'],
  ],
}

function normalizeText(input: string | null | undefined): string | null {
  const value = (input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return value || null
}

export function normalizeAcerLocaleTitle(locale: AcerTargetLocale, title: string): string {
  let next = title.trim()
  for (const [pattern, replacement] of LOCALE_TITLE_REPLACEMENTS[locale]) {
    next = next.replace(pattern, replacement)
  }
  return next.replace(/\s{2,}/g, ' ').trim()
}

export function normalizeAcerLocaleTranslation(translation: AcerLocaleTranslation): AcerLocaleTranslation {
  return {
    ...translation,
    title: normalizeAcerLocaleTitle(translation.locale, translation.title),
    description: translation.description.trim().replace(/\n{3,}/g, '\n\n'),
    metaDescription: translation.metaDescription.trim(),
  }
}

export function validateAcerLocaleTranslation(translation: AcerLocaleTranslation): string[] {
  const haystack = `${translation.title}\n${translation.description}\n${translation.metaDescription}`
  const issues: string[] = []

  for (const pattern of LOCALE_FORBIDDEN_PATTERNS[translation.locale]) {
    if (pattern.test(haystack)) issues.push(`forbidden:${pattern}`)
  }

  if (translation.locale === 'nl' && /\bdedicated geheugen\b/i.test(haystack)) issues.push('awkward_nl_dedicated_geheugen')
  if (translation.locale === 'fi' && /\bjaettu muisti\b/i.test(haystack) && /\bGraphics\b/i.test(haystack)) issues.push('awkward_fi_graphics_phrase')

  return issues
}

function buildLocalePrompt(locale: AcerTargetLocale): string {
  return [
    `Translate this Acer product from English into ${LOCALE_NAMES[locale]}.`,
    'Preserve product facts exactly and do not invent any specifications.',
    'Keep model codes, dimensions, units, storage, memory capacities, keyboard markers, and punctuation structure intact where possible.',
    'Write natural e-commerce copy for the target market.',
    LOCALE_STYLE_GUIDANCE[locale],
    'Do not leave obvious English category nouns or phrases in the output when a natural local equivalent exists.',
    'Translate terms like Laptop, Gaming Laptop, shared memory, dedicated memory, display wording, and processor labels naturally.',
    'Meta description should be one concise SEO-style sentence derived only from the same title and description.',
  ].join(' ')
}

export async function translateAcerLocaleWithRetry(
  openAiKey: string,
  product: { sku: string; title: string; description: string; metaDescription: string | null },
  locale: AcerTargetLocale,
): Promise<AcerLocaleTranslation> {
  let feedback = ''

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'acer_single_locale_fill',
            schema: {
              type: 'object',
              properties: {
                locale: { type: 'string', enum: [locale] },
                title: { type: 'string' },
                description: { type: 'string' },
                metaDescription: { type: 'string' },
              },
              required: ['locale', 'title', 'description', 'metaDescription'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: [
              buildLocalePrompt(locale),
              feedback,
              'Return strict JSON only.',
            ].filter(Boolean).join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              sku: product.sku,
              targetLocale: locale,
              englishTitle: product.title,
              englishDescription: product.description,
              englishMetaDescription: product.metaDescription,
            }),
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const json = await res.json() as {
      choices?: Array<{
        message?: { content?: string | null }
      }>
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('OpenAI returned empty content')
    const parsed = JSON.parse(content) as AcerLocaleTranslation
    const cleaned = normalizeAcerLocaleTranslation(parsed)
    const issues = validateAcerLocaleTranslation(cleaned)
    if (issues.length === 0) return cleaned
    feedback = `Previous attempt failed quality checks for these reasons: ${issues.join(', ')}. Rewrite more naturally and eliminate those issues.`
  }

  throw new Error(`Quality gate failed for ${product.sku} ${locale} after 3 attempts`)
}

export async function translateAcerLocalesWithRetry(
  openAiKey: string,
  product: { sku: string; title: string; description: string; metaDescription: string | null },
  locales: AcerTargetLocale[],
): Promise<AcerLocaleTranslation[]> {
  const translations: AcerLocaleTranslation[] = []
  for (const locale of locales) {
    translations.push(await translateAcerLocaleWithRetry(openAiKey, product, locale))
  }
  return translations
}

export function acerLocaleNeedsTranslation(translation: { title: string | null; description: string | null } | undefined): boolean {
  return !!normalizeText(translation?.title) && !!normalizeText(translation?.description)
}
