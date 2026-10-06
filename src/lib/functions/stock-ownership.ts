import type { Platform } from '@/types/platform'

// Channels whose stock is owned by the warehouse system, never written by Wizhard.
// shopify_tiktok: Mintsoft (2Flow WMS) pushes stock to the Tech Store itself, so any quantity
// Wizhard wrote there (e.g. scraped acer_store stock) would be fictitious.
export const EXTERNALLY_STOCKED_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(['shopify_tiktok'])
