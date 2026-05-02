import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'

import { verifyBearer } from '@/lib/auth/bearer'
import { createConnector } from '@/lib/connectors/registry'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { getProductTranslations } from '@/lib/functions/product-translations'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { toShopifyDescriptionHtml } from '@/lib/utils/description'
import type { ProductTranslationPayload } from '@/lib/connectors/types'

type LocaleCheck = {
  locale: string
  publishedInShopify: boolean
  source: 'base' | 'db-row' | 'missing'
  expected: {
    title: string | null
    descriptionHtml: string | null
    metaTitle: string | null
    metaDescription: string | null
  }
  actual: {
    title: string | null
    bodyHtml: string | null
    metaTitle: string | null
    metaDescription: string | null
  }
  matches: {
    title: boolean
    description: boolean
    metaTitle: boolean
    metaDescription: boolean
  }
}

function normalizeExact(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  return text.replace(/\s+/g, ' ')
}

function normalizeDescription(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toLocaleMap(entries: ProductTranslationPayload[]): Map<string, ProductTranslationPayload> {
  return new Map(entries.map((entry) => [entry.locale.toLowerCase(), entry]))
}

function collectRequestedLocales(
  rawLocales: string | null,
  dbLocales: string[],
): string[] {
  if (rawLocales) {
    return [...new Set(
      rawLocales
        .split(',')
        .map((locale) => locale.trim().toLowerCase())
        .filter(Boolean)
    )]
  }

  return [...new Set(['en', ...dbLocales.map((locale) => locale.toLowerCase())])]
}

export async function GET(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const product = await db.query.products.findFirst({
    where: eq(products.id, params.sku),
    with: {
      platformMappings: true,
    },
  })
  if (!product) return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)

  const translations = await getProductTranslations(params.sku)
  const translationMap = toLocaleMap(translations)
  const platformMapping = product.platformMappings.find((mapping) => mapping.platform === 'shopify_komputerzz')
  if (!platformMapping) {
    return apiError('NOT_FOUND', `Product ${params.sku} is not mapped to shopify_komputerzz`, 404)
  }

  const connector = await createConnector('shopify_komputerzz')
  const readBaseSnapshot = 'readProductBaseSnapshot' in connector && typeof connector.readProductBaseSnapshot === 'function'
    ? await connector.readProductBaseSnapshot(platformMapping.platformId)
    : null
  if (!('readProductTranslationSnapshot' in connector) || typeof connector.readProductTranslationSnapshot !== 'function') {
    return apiError('INTERNAL_ERROR', 'Shopify connector does not support translation diagnostics', 500)
  }

  const requestedLocales = collectRequestedLocales(
    req.nextUrl.searchParams.get('locales'),
    translations.map((translation) => translation.locale),
  )
  const snapshot = await connector.readProductTranslationSnapshot(platformMapping.platformId, requestedLocales)
  const liveLocaleMap = snapshot.translationsByLocale
  const publishedLocales = new Set(snapshot.shopLocales.map((locale) => locale.toLowerCase()))

  const checks: LocaleCheck[] = requestedLocales.map((locale) => {
    const dbRow = translationMap.get(locale) ?? null
    const isEnglish = locale === 'en'
    const source: LocaleCheck['source'] =
      dbRow ? (isEnglish ? 'base' : 'db-row') :
      isEnglish ? 'base' : 'missing'

    const expectedTitle = isEnglish
      ? (dbRow?.title ?? product.title)
      : (dbRow?.title ?? null)
    const expectedDescription = isEnglish
      ? (dbRow?.description ?? product.description ?? null)
      : (dbRow?.description ?? null)
    const expectedMetaTitle = isEnglish
      ? (dbRow?.metaTitle ?? null)
      : (dbRow?.metaTitle ?? null)
    const expectedMetaDescription = isEnglish
      ? (dbRow?.metaDescription ?? product.metaDescription ?? null)
      : (dbRow?.metaDescription ?? null)

    const liveEntries = liveLocaleMap[locale] ?? []
    const actualTitle = liveEntries.find((entry) => entry.key === 'title')?.value ?? null
    const actualBodyHtml = liveEntries.find((entry) => entry.key === 'body_html')?.value ?? null
    const actualMetaTitle = liveEntries.find((entry) => entry.key === 'meta_title')?.value ?? null
    const actualMetaDescription = liveEntries.find((entry) => entry.key === 'meta_description')?.value ?? null

    const expectedDescriptionHtml = expectedDescription ? toShopifyDescriptionHtml(expectedDescription) : null

    return {
      locale,
      publishedInShopify: publishedLocales.has(locale),
      source,
      expected: {
        title: normalizeExact(expectedTitle),
        descriptionHtml: normalizeExact(expectedDescriptionHtml),
        metaTitle: normalizeExact(expectedMetaTitle),
        metaDescription: normalizeExact(expectedMetaDescription),
      },
      actual: {
        title: normalizeExact(actualTitle),
        bodyHtml: normalizeExact(actualBodyHtml),
        metaTitle: normalizeExact(actualMetaTitle),
        metaDescription: normalizeExact(actualMetaDescription),
      },
      matches: {
        title: normalizeExact(expectedTitle) === normalizeExact(actualTitle),
        description: normalizeDescription(expectedDescriptionHtml) === normalizeDescription(actualBodyHtml),
        metaTitle: normalizeExact(expectedMetaTitle) === normalizeExact(actualMetaTitle),
        metaDescription: normalizeExact(expectedMetaDescription) === normalizeExact(actualMetaDescription),
      },
    }
  })

  const summary = {
    totalLocales: checks.length,
    matchingLocales: checks.filter((check) => check.matches.title && check.matches.description && check.matches.metaTitle && check.matches.metaDescription).length,
    mismatchingLocales: checks.filter((check) => !(check.matches.title && check.matches.description && check.matches.metaTitle && check.matches.metaDescription)).length,
    publishedLocales: checks.filter((check) => check.publishedInShopify).length,
    missingDbLocales: checks.filter((check) => check.source === 'missing').length,
  }

  return apiResponse({
    sku: params.sku,
    platform: 'shopify_komputerzz',
    platformId: platformMapping.platformId,
    base: readBaseSnapshot,
    requestedLocales,
    shopLocales: snapshot.shopLocales,
    summary,
    checks,
  })
}
