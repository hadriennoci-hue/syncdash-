/**
 * Canonical attribute-value normalizer (see docs/tiktok-readiness-spec.md §2.5).
 *
 * Wizhard stores spec attributes as free text ("Up to 16,000 DPI", "16.8M RGB Lighting with
 * QuarterMaster(TM)", "Laptop compartment | Multiple compartments"). TikTok category attributes
 * want clean, consistent values, and the power image wants compact ones. This module provides:
 *
 *  - cleanAttributeValue: conservative formatting cleanup (no semantic change)
 *  - splitAttributeValues: multi-value split that does NOT break "16,000" on the comma
 *  - normalizeAttributeValues: split + clean + de-dupe -> the values to push
 *  - shortAttributeValue: the compact form (ATTRIBUTE_SHORT_VALUE_MAP), for the power image
 *
 * ATTRIBUTE_SHORT_VALUE_MAP is only populated for laptops/monitors today; for the accessory
 * categories the generic cleanup does the work. Populate the map per collection over time.
 */
import { ATTRIBUTE_SHORT_VALUE_MAP } from '@/lib/constants/attribute-short-values'
import type { AttributeCollection } from '@/lib/constants/product-attribute-options'

const NBSP_RE = / /g
const TRADEMARK_RE = /[™©®]/g // (TM) (C) (R)
const DIACRITIC_RE = /[̀-ͯ]/g

/** Conservative cleanup: strip noise, keep meaning. */
export function cleanAttributeValue(raw: string): string {
  return raw
    .replace(NBSP_RE, ' ')       // non-breaking space -> space
    .replace(TRADEMARK_RE, '')   // strip (TM) (C) (R)
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim()
    .replace(/^up to\s+/i, '')   // drop "Up to " prefix (Acer phrasing)
    .replace(/[.\s]+$/, '')      // trailing period / space
    .trim()
}

/**
 * Split a stored attribute string into individual values.
 * Splits on '|' and ';' always; on ',' only when it is NOT a thousands separator,
 * so "16,000 DPI" stays intact while "HDMI, DisplayPort" splits.
 */
export function splitAttributeValues(raw: string): string[] {
  return raw
    .split(/\s*[|;]\s*|\s*,(?!\d)\s*/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/** De-dupe case/accent-insensitively, preserving first-seen casing and order. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const k = v.normalize('NFD').replace(DIACRITIC_RE, '').toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

export interface AttributeContext {
  collection?: AttributeCollection
  key?: string
}

/** The compact form for the power image: short-map lookup, else the cleaned value. */
export function shortAttributeValue(raw: string, ctx: AttributeContext = {}): string {
  const cleaned = cleanAttributeValue(raw)
  if (ctx.collection && ctx.key) {
    const perKey = ATTRIBUTE_SHORT_VALUE_MAP[ctx.collection]?.[ctx.key]
    const hit = perKey?.[raw] ?? perKey?.[cleaned]
    if (hit) return hit
  }
  return cleaned
}

/** Split a raw attribute string, clean each value, and de-dupe -> the values to push. */
export function normalizeAttributeValues(raw: string, ctx: AttributeContext = {}): string[] {
  const parts = splitAttributeValues(raw).map((v) => shortAttributeValue(v, ctx) || cleanAttributeValue(v))
  return dedupe(parts.filter(Boolean))
}
