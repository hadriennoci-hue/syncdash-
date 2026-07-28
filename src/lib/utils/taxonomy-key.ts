/**
 * Derive a product's taxonomy_key (the channel_category_map key) from its collection membership,
 * so category resolution works from data the product already has — no per-product backfill.
 *
 * taxonomy_key is the slug of a collection name (docs/tiktok-readiness-spec.md §2.3): the seed uses
 * lower-case with " & " and spaces collapsed to "_", e.g. "Headsets & Earbuds" -> "headsets_earbuds".
 */

/** Slugify a collection name into a taxonomy_key candidate. Mirrors the 0039 seed keys. */
export function slugifyCollection(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, '_')
    .replace(/\s+/g, '_')
}

/**
 * Pick the first collection whose slug is a known taxonomy_key.
 * `validKeys` is the set of keys present in channel_category_map for the platform.
 */
export function deriveTaxonomyKey(
  collectionNames: Array<string | null | undefined>,
  validKeys: ReadonlySet<string>,
): string | null {
  for (const name of collectionNames) {
    if (!name) continue
    const slug = slugifyCollection(name)
    if (validKeys.has(slug)) return slug
  }
  return null
}
