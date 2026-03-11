import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { attributeAllowedValues } from '@/lib/db/schema'
import { getAttributeOptions, type AttributeBrand, type AttributeCollection } from '@/lib/constants/product-attribute-options'
import { generateId } from '@/lib/utils/id'

export interface UpsertAttributeOptionsInput {
  collection: AttributeCollection
  key: string
  values: string[]
  mode: 'append' | 'replace'
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase()
}

function normalizeValue(raw: string): string {
  return raw.trim().toLowerCase()
}

function dedupeValues(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeValue(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }

  return out
}

export async function getRuntimeAttributeOptions(
  collection: AttributeCollection,
  brand?: AttributeBrand
): Promise<Record<string, string[]>> {
  const base = getAttributeOptions(collection, brand)
  const customRows = await db.query.attributeAllowedValues.findMany({
    where: eq(attributeAllowedValues.collection, collection),
  })

  if (customRows.length === 0) return base

  const customByKey = new Map<string, string[]>()
  for (const row of customRows) {
    const key = normalizeKey(row.key)
    const list = customByKey.get(key) ?? []
    list.push(row.value)
    customByKey.set(key, list)
  }

  const merged: Record<string, string[]> = { ...base }
  for (const [key, values] of customByKey.entries()) {
    merged[key] = dedupeValues([...(merged[key] ?? []), ...values])
  }

  return merged
}

export async function upsertRuntimeAttributeOptions(input: UpsertAttributeOptionsInput): Promise<void> {
  const key = normalizeKey(input.key)
  const values = dedupeValues(input.values)

  if (input.mode === 'replace') {
    await db.delete(attributeAllowedValues).where(and(
      eq(attributeAllowedValues.collection, input.collection),
      eq(attributeAllowedValues.key, key)
    ))
  }

  for (const value of values) {
    const normalized = normalizeValue(value)
    const exists = await db.query.attributeAllowedValues.findFirst({
      where: and(
        eq(attributeAllowedValues.collection, input.collection),
        eq(attributeAllowedValues.key, key),
        eq(attributeAllowedValues.valueNormalized, normalized)
      ),
      columns: { id: true },
    })

    if (exists) continue

    await db.insert(attributeAllowedValues).values({
      id: generateId(),
      collection: input.collection,
      key,
      value,
      valueNormalized: normalized,
      createdAt: new Date().toISOString(),
    })
  }
}
