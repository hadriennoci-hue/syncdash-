import { and, eq } from 'drizzle-orm'

import type { ProductTranslationPayload } from '@/lib/connectors/types'
import { db } from '@/lib/db/client'
import { cleanTextArtifacts } from '@/lib/utils/description'
import { productTranslations } from '@/lib/db/schema'
import { logOperation } from '@/lib/functions/log'
import type { Platform, TriggeredBy } from '@/types/platform'

export async function getProductTranslations(productId: string): Promise<ProductTranslationPayload[]> {
  const rows = await db.query.productTranslations.findMany({
    where: eq(productTranslations.productId, productId),
    orderBy: (table, { asc }) => [asc(table.locale)],
  })

  return rows.map((row) => ({
    locale: row.locale,
    title: row.title ?? null,
    description: row.description ?? null,
    metaTitle: row.metaTitle ?? null,
    metaDescription: row.metaDescription ?? null,
  }))
}

export async function logProductTranslationSync(
  productId: string,
  platform: Platform,
  status: 'success' | 'error',
  message: string,
  triggeredBy: TriggeredBy
): Promise<void> {
  await logOperation({
    productId,
    platform,
    action: 'sync_translations',
    status,
    message,
    triggeredBy,
  })
}

export async function upsertProductTranslations(
  productId: string,
  translations: ProductTranslationPayload[],
  triggeredBy: TriggeredBy
): Promise<ProductTranslationPayload[]> {
  const now = new Date().toISOString()

  for (const translation of translations) {
    await db.insert(productTranslations).values({
      productId,
      locale: translation.locale,
      title: translation.title?.trim() || null,
      description: cleanTextArtifacts(translation.description),
      metaTitle: translation.metaTitle?.trim() || null,
      metaDescription: cleanTextArtifacts(translation.metaDescription),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [productTranslations.productId, productTranslations.locale],
      set: {
        title: translation.title?.trim() || null,
        description: cleanTextArtifacts(translation.description),
        metaTitle: translation.metaTitle?.trim() || null,
        metaDescription: cleanTextArtifacts(translation.metaDescription),
        updatedAt: now,
      },
    })

    await logOperation({
      productId,
      action: 'upsert_translation',
      status: 'success',
      message: `Locale ${translation.locale}`,
      triggeredBy,
    })
  }

  return getProductTranslations(productId)
}

export async function deleteProductTranslation(
  productId: string,
  locale: string,
  triggeredBy: TriggeredBy
): Promise<void> {
  await db.delete(productTranslations).where(
    and(
      eq(productTranslations.productId, productId),
      eq(productTranslations.locale, locale)
    )
  )

  await logOperation({
    productId,
    action: 'delete_translation',
    status: 'success',
    message: `Locale ${locale}`,
    triggeredBy,
  })
}
