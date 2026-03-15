import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { productMetafields, products } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { logOperation } from '@/lib/functions/log'
import type { TriggeredBy } from '@/types/platform'

export interface ProductAttributeInput {
  namespace?: string
  key: string
  value: string | null
  type?: string | null
}

interface SetProductAttributesInput {
  attributes: ProductAttributeInput[]
  mode: 'replace' | 'merge'
  triggeredBy?: TriggeredBy
}

function normalizeNamespace(raw?: string): string {
  return (raw ?? 'attributes').trim().toLowerCase()
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase()
}

function pairKey(namespace: string, key: string): string {
  return `${namespace}:${key}`
}

export async function getProductAttributes(sku: string) {
  return db.query.productMetafields.findMany({
    where: eq(productMetafields.productId, sku),
  })
}

export async function setProductAttributes(
  sku: string,
  input: SetProductAttributesInput
): Promise<void> {
  const triggeredBy = input.triggeredBy ?? 'human'

  const product = await db.query.products.findFirst({
    where: eq(products.id, sku),
    columns: { id: true },
  })
  if (!product) {
    throw new Error(`Product ${sku} not found`)
  }

  const existing = await db.query.productMetafields.findMany({
    where: eq(productMetafields.productId, sku),
  })

  const existingByPair = new Map<string, (typeof existing)[number]>()
  for (const row of existing) {
    existingByPair.set(pairKey(row.namespace, row.key), row)
  }

  const deduped = new Map<string, ProductAttributeInput>()
  for (const attr of input.attributes) {
    const namespace = normalizeNamespace(attr.namespace)
    const key = normalizeKey(attr.key)
    deduped.set(pairKey(namespace, key), {
      namespace,
      key,
      value: attr.value,
      type: attr.type ?? null,
    })
  }

  try {
    if (input.mode === 'replace') {
      await db.delete(productMetafields).where(eq(productMetafields.productId, sku))
      existingByPair.clear()
    }

    let writes = 0
    for (const attr of deduped.values()) {
      const namespace = normalizeNamespace(attr.namespace)
      const key = normalizeKey(attr.key)
      const found = existingByPair.get(pairKey(namespace, key))

      if (found) {
        await db.update(productMetafields)
          .set({
            value: attr.value,
            type: attr.type ?? 'single_line_text_field',
          })
          .where(eq(productMetafields.id, found.id))
        writes++
        continue
      }

      await db.insert(productMetafields).values({
        id: generateId(),
        productId: sku,
        namespace,
        key,
        value: attr.value,
        type: attr.type ?? 'single_line_text_field',
        createdAt: new Date().toISOString(),
      })
      writes++
    }

    await logOperation({
      productId: sku,
      action: 'update_attributes',
      status: 'success',
      message: `mode=${input.mode} writes=${writes}`,
      triggeredBy,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await logOperation({
      productId: sku,
      action: 'update_attributes',
      status: 'error',
      message,
      triggeredBy,
    })
    throw error
  }
}
