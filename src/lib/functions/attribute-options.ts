import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { attributeAllowedValues } from '@/lib/db/schema'
import { getAttributeOptions, type AttributeBrand, type AttributeCollection } from '@/lib/constants/product-attribute-options'
import { getShortAttributeValue } from '@/lib/constants/attribute-short-values'
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

function toCanonicalValue(collection: AttributeCollection, key: string, value: string): string {
  return getShortAttributeValue(collection, key, value) ?? value.trim()
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
    list.push(row.valueShort ?? row.value)
    customByKey.set(key, list)
  }

  const merged: Record<string, string[]> = { ...base }
  for (const [key, values] of customByKey.entries()) {
    merged[key] = dedupeValues([...(merged[key] ?? []), ...values])
  }

  return merged
}

export async function canonicalizeAttributeValue(
  collection: AttributeCollection,
  key: string,
  rawValue: string,
): Promise<string> {
  const normalizedKey = normalizeKey(key)
  const normalizedValue = normalizeValue(rawValue)

  const customRows = await db.query.attributeAllowedValues.findMany({
    where: and(
      eq(attributeAllowedValues.collection, collection),
      eq(attributeAllowedValues.key, normalizedKey),
    ),
  })

  for (const row of customRows) {
    if (row.valueNormalized === normalizedValue) return row.valueShort ?? row.value
    if (row.valueShort && normalizeValue(row.valueShort) === normalizedValue) return row.valueShort
  }

  const allowed = getAttributeOptions(collection)[normalizedKey] ?? []
  const baseMatch = allowed.find((value) => normalizeValue(value) === normalizedValue)
  if (baseMatch) return baseMatch

  return toCanonicalValue(collection, normalizedKey, rawValue)
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
    const canonical = toCanonicalValue(input.collection, key, value)
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
      valueShort: canonical,
      valueNormalized: normalized,
      createdAt: new Date().toISOString(),
    })
  }
}
