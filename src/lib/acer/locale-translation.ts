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
  fr: 'Use natural French retail terminology. Prefer "PC" for computers, keep "gaming" as the product qualifier, use "écran" or "moniteur" for displays, and never use "ordinateur de bureau" or "de jeu".',
  de: 'Use natural German retail terminology. Prefer "Notebook" for portable computers and avoid leftover English category nouns where a natural German term exists.',
  es: 'Use natural Spanish retail terminology. Prefer "portátil" or "ordenador portátil" over "laptop" where natural, and prefer "gaming" / "PC gaming" over literal "para juegos" phrasing.',
  it: 'Use natural Italian retail terminology. Prefer "notebook" or "portatile" as appropriate, not raw English category phrases like "Gaming Laptop".',
  nl: 'Use natural Dutch retail terminology. Normalize common mixed terms and avoid leaving English memory phrases like "dedicated memory".',
  fi: 'Use natural Finnish retail terminology. Avoid stiff literal calques for memory or graphics phrasing.',
}

const LOCALE_FORBIDDEN_PATTERNS: Record<AcerTargetLocale, RegExp[]> = {
  fr: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bPortable Gaming\b/i, /\bordinateur de bureau\b/i, /\bde jeu\b/i, /\bicosa[- ]core\b/i, /\bécran de jeu\b/i, /\becran de jeu\b/i],
  de: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bIcosa[- ]?core\b/i],
  es: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bportatil\b/i, /\bordenador portatil\b/i, /\bIcosa[- ]?core\b/i],
  it: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bIcosa[- ]?core\b/i, /\bper Videogiochi\b/i],
  nl: [/\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
  fi: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i, /\bjaettu muisti\b/i],
}

const LOCALE_TITLE_REPLACEMENTS: Record<AcerTargetLocale, Array<[RegExp, string]>> = {
  fr: [
    [/\bGaming Laptop\b/gi, 'PC gaming'],
    [/\bGaming PC\b/gi, 'PC gaming'],
    [/\bGaming Desktop\b/gi, 'PC gaming'],
    [/\bGaming Monitor\b/gi, 'écran gaming'],
    [/\bLaptop\b/gi, 'PC'],
    [/\bDesktop\b/gi, 'PC'],
    [/\bMonitor\b/gi, 'écran'],
    [/\bÉcran Gaming\b/gi, 'Écran gaming'],
    [/\bMoniteur Gaming\b/gi, 'écran gaming'],
    [/\bMoniteur\b/gi, 'écran'],
    [/\bordinateur de bureau de jeu\b/gi, 'PC gaming'],
    [/\bordinateur de bureau\b/gi, 'PC'],
    [/\bécran de jeu\b/gi, 'écran gaming'],
    [/\becran de jeu\b/gi, 'écran gaming'],
    [/\bPortable Gaming\b/gi, 'gaming'],
    [/\bde jeu\b/gi, 'gaming'],
    [/\bicosa[- ]core\b(?:\s*\(\s*20 cœurs\s*\))?/gi, '20 cœurs'],
    [/\bCustodia Cabina\b/gi, 'valise cabine'],
    [/\bProjector\b/gi, 'projecteur'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
  ],
  de: [
    [/\bGaming Laptop\b/gi, 'Gaming-Notebook'],
    [/\bGaming Desktop\b/gi, 'Gaming-PC'],
    [/\bGaming Monitor\b/gi, 'Gaming-Monitor'],
    [/\bLaptop\b/gi, 'Notebook'],
    [/\bDesktop\b/gi, 'Desktop-PC'],
    [/\bMonitor\b/gi, 'Monitor'],
    [/\bIcosa[- ]?core\b(?:\s*\(\s*20 Kerne\s*\))?/gi, '20 Kerne'],
    [/\b20 Kernen\s*\(\s*20 Kerne\s*\)/gi, '20 Kernen'],
    [/\bProjector\b/gi, 'Projektor'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
  ],
  es: [
    [/\bGaming Laptop\b/gi, 'portátil gaming'],
    [/\bGaming Desktop\b/gi, 'PC gaming'],
    [/\bGaming Monitor\b/gi, 'monitor gaming'],
    [/\bmonitor gamer\b/gi, 'monitor gaming'],
    [/\bmonitor Curvo para Juegos\b/gi, 'monitor gaming curvo'],
    [/\bmonitor Gaming\b/gi, 'monitor gaming'],
    [/\bGaming Curvo\b/gi, 'gaming curvo'],
    [/\bEscritorio Gaming\b/gi, 'PC gaming'],
    [/\bOrdenador de sobremesa gaming\b/gi, 'PC gaming'],
    [/\bOrdenador de sobremesa para juegos\b/gi, 'PC gaming'],
    [/\bPC Gaming Predator Orion 3000\b/gi, 'Predator Orion 3000 PC gaming'],
    [/\bmonitor Acer Nitro VG0 para PC Gaming\b/gi, 'monitor gaming Acer Nitro VG0'],
    [/\bmonitor Curvo Acer Nitro ED0 gaming\b/gi, 'monitor gaming curvo Acer Nitro ED0'],
    [/\bpara Gaming\b/gi, 'gaming'],
    [/\bLaptop\b/gi, 'portátil'],
    [/\bDesktop\b/gi, 'PC de sobremesa'],
    [/\bMonitor\b/gi, 'monitor'],
    [/\bPortatile\b/gi, 'portátil'],
    [/\bde icosa[- ]?núcleo(?:s)?\b(?:\s*\(\s*20 núcleos\s*\))?/gi, 'de 20 núcleos'],
    [/\bIcosa[- ]?core\b(?:\s*\(\s*20 núcleos\s*\))?/gi, '20 núcleos'],
    [/\bProjector\b/gi, 'proyector'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
  ],
  it: [
    [/\bGaming Laptop\b/gi, 'Notebook gaming'],
    [/\bGaming Desktop\b/gi, 'PC gaming'],
    [/\bGaming Monitor\b/gi, 'monitor gaming'],
    [/\bmonitor per gaming\b/gi, 'monitor gaming'],
    [/\bmonitor Gaming\b/gi, 'monitor gaming'],
    [/\bmonitor Curvo\b/gi, 'monitor curvo'],
    [/\bmonitor\b\s+.*\bper Gaming\b/gi, 'monitor gaming'],
    [/\bPortatile da Gioco\b/gi, 'Notebook gaming'],
    [/\bda gioco\b/gi, 'gaming'],
    [/\bper Videogiochi\b/gi, 'gaming'],
    [/\bLaptop\b/gi, 'Notebook'],
    [/\bDesktop gaming\b/gi, 'PC gaming'],
    [/\bPC fisso\b/gi, 'Desktop'],
    [/\bfisso\b/gi, 'Desktop'],
    [/\bDesktop\b/gi, 'Desktop'],
    [/\bMonitor\b/gi, 'monitor'],
    [/\bIcosa[- ]?core\b(?:\s*\(\s*20 Core™\s*\))?/gi, '20 core'],
    [/\bCustodia Cabina\b/gi, 'Valigia da cabina'],
    [/\bProjector\b/gi, 'proiettore'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
  ],
  nl: [
    [/\bGaming Laptop\b/gi, 'gaming-laptop'],
    [/\bGaming Desktop\b/gi, 'gaming-pc'],
    [/\bGaming Monitor\b/gi, 'gaming-monitor'],
    [/\bNotebook\b/gi, 'laptop'],
    [/\bLaptop\b/g, 'laptop'],
    [/\bDesktop\b/gi, 'desktop-pc'],
    [/\bMonitor\b/gi, 'monitor'],
    [/\bProjector\b/gi, 'projector'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
  ],
  fi: [
    [/\bGaming Laptop\b/gi, 'pelikannettava'],
    [/\bGaming Desktop\b/gi, 'pelipöytäkone'],
    [/\bGaming Monitor\b/gi, 'pelinäyttö'],
    [/\bKannettava Tietokone\b/g, 'kannettava tietokone'],
    [/\bPelikannettava\b/g, 'pelikannettava'],
    [/\bDesktop\b/gi, 'pöytätietokone'],
    [/\bMonitor\b/gi, 'näyttö'],
    [/\bProjector\b/gi, 'projektori'],
    [/\bUSB Type-C\b/gi, 'USB-C'],
    [/\bKäyrä\b/gi, 'kaareva'],
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

function applyLocaleReplacements(locale: AcerTargetLocale, input: string): string {
  let next = input
  for (const [pattern, replacement] of LOCALE_TITLE_REPLACEMENTS[locale]) {
    next = next.replace(pattern, replacement)
  }
  return next.replace(/\s{2,}/g, ' ').trim()
}

export function normalizeAcerLocaleTitle(locale: AcerTargetLocale, title: string): string {
  return applyLocaleReplacements(locale, title.trim())
}

export function normalizeAcerLocaleTranslation(translation: AcerLocaleTranslation): AcerLocaleTranslation {
  const title = typeof translation.title === 'string' ? translation.title : ''
  const description = typeof translation.description === 'string' ? translation.description : ''
  const metaDescription = typeof translation.metaDescription === 'string' ? translation.metaDescription : ''

  return {
    ...translation,
    title: normalizeAcerLocaleTitle(translation.locale, title),
    description: applyLocaleReplacements(translation.locale, description.trim().replace(/\n{3,}/g, '\n\n')),
    metaDescription: applyLocaleReplacements(translation.locale, metaDescription.trim()),
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
  if (translation.locale === 'fr' && /\bordinateur de bureau\b/i.test(haystack)) issues.push('awkward_fr_desktop')
  if (translation.locale === 'fr' && /\bde jeu\b/i.test(haystack)) issues.push('awkward_fr_de_jeu')
  if (translation.locale === 'fr' && /\bicosa[- ]core\b/i.test(haystack)) issues.push('awkward_fr_icosa_core')
  if (translation.locale === 'de' && /\bIcosa[- ]?core\b/i.test(haystack)) issues.push('awkward_de_icosa_core')
  if (translation.locale === 'it' && /\bda gioco\b/i.test(haystack)) issues.push('awkward_it_da_gioco')
  if (translation.locale === 'it' && /\bper Videogiochi\b/i.test(haystack)) issues.push('awkward_it_per_videogiochi')
  if (translation.locale === 'it' && /\bfisso\b/i.test(haystack)) issues.push('awkward_it_fisso')
  if (translation.locale === 'it' && /\bIcosa[- ]?core\b/i.test(haystack)) issues.push('awkward_it_icosa_core')
  if (translation.locale === 'nl' && /\bgaming desktop\b/i.test(haystack)) issues.push('awkward_nl_gaming_desktop')
  if (translation.locale === 'de' && /\bgaming desktop\b/i.test(haystack)) issues.push('awkward_de_gaming_desktop')

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
    if (!res.ok) {
      const body = await res.text()
      if (res.status >= 500 || res.status === 429) {
        feedback = `Previous attempt hit a transient OpenAI HTTP ${res.status}. Retry with a calmer, more concise response.`
        continue
      }
      throw new Error(`OpenAI ${res.status}: ${body}`)
    }
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
