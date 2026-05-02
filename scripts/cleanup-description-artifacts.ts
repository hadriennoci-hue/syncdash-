import { cleanTextArtifacts } from '@/lib/utils/description'

type ProductListItem = {
  id: string
  title: string
  hasDescription: boolean
  updatedAt?: string | null
}

type ProductDetail = {
  id: string
  description: string | null
  metaDescription: string | null
  translations: Array<{
    locale: string
    title: string | null
    description: string | null
    metaTitle: string | null
    metaDescription: string | null
  }>
}

const BASE_URL = process.env.CLEANUP_BASE_URL?.trim() || 'https://wizhard.store'
const TOKEN = process.env.AGENT_BEARER_TOKEN?.trim()
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID?.trim()
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET?.trim()

if (!TOKEN) throw new Error('Missing AGENT_BEARER_TOKEN')
if (!CF_ACCESS_CLIENT_ID) throw new Error('Missing CF_ACCESS_CLIENT_ID')
if (!CF_ACCESS_CLIENT_SECRET) throw new Error('Missing CF_ACCESS_CLIENT_SECRET')

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
}

function asText(value: string | null | undefined): string | null {
  const cleaned = cleanTextArtifacts(value)
  return cleaned
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  const payload = await res.json() as { data: T }
  return payload.data
}

async function apiPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`)
}

async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`)
}

async function fetchAllProducts(): Promise<ProductListItem[]> {
  const out: ProductListItem[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await fetch(`${BASE_URL}/api/products?page=${page}&perPage=200`, { headers: HEADERS })
    if (!res.ok) throw new Error(`GET /api/products?page=${page} failed: ${res.status} ${await res.text()}`)
    const payload = await res.json() as { data: ProductListItem[]; meta?: { totalPages?: number } }
    out.push(...(payload.data ?? []))
    totalPages = payload.meta?.totalPages ?? page
    page += 1
  } while (page <= totalPages)
  return out
}

async function main() {
  const products = await fetchAllProducts()
  let productUpdates = 0
  let translationUpdates = 0

  for (const product of products) {
    const detail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(product.id)}`)

    const nextDescription = asText(detail.description)
    const nextMetaDescription = asText(detail.metaDescription)

    const baseChanged =
      nextDescription !== detail.description ||
      nextMetaDescription !== detail.metaDescription

    if (baseChanged) {
      await apiPatch(`/api/products/${encodeURIComponent(product.id)}`, {
        fields: {
          ...(nextDescription !== detail.description ? { description: nextDescription } : {}),
          ...(nextMetaDescription !== detail.metaDescription ? { metaDescription: nextMetaDescription } : {}),
        },
        triggeredBy: 'agent',
      })
      productUpdates += 1
    }

    const changedTranslations = detail.translations
      .map((translation) => {
        const nextTranslationDescription = asText(translation.description)
        const nextTranslationMetaDescription = asText(translation.metaDescription)
        const changed =
          nextTranslationDescription !== translation.description ||
          nextTranslationMetaDescription !== translation.metaDescription

        return changed ? {
          locale: translation.locale,
          ...(translation.title ? { title: translation.title } : {}),
          ...(nextTranslationDescription !== translation.description ? { description: nextTranslationDescription } : {}),
          ...(translation.metaTitle ? { metaTitle: translation.metaTitle } : {}),
          ...(nextTranslationMetaDescription !== translation.metaDescription ? { metaDescription: nextTranslationMetaDescription } : {}),
        } : null
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))

    if (changedTranslations.length > 0) {
      await apiPut(`/api/products/${encodeURIComponent(product.id)}/translations`, {
        translations: changedTranslations,
        triggeredBy: 'agent',
      })
      translationUpdates += changedTranslations.length
    }
  }

  console.log(JSON.stringify({
    scanned: products.length,
    productUpdates,
    translationRowsUpdated: translationUpdates,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
