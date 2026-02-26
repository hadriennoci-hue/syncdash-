import type { Platform } from '@/types/platform'
import type { PlatformConnector, WarehouseConnector } from './types'
import { ShopifyConnector, ShopifyWarehouseConnector } from './shopify'
import { WooCommerceConnector } from './woocommerce'
import { AcerScraperConnector } from './acer-scraper'
import { getStoredToken } from '@/lib/functions/tokens'

// ---------------------------------------------------------------------------
// Platform connector factory (synchronous — uses env var tokens)
// Pass tokenOverride to use a dynamically-obtained OAuth token instead.
// ---------------------------------------------------------------------------

export function getConnector(platform: Platform, tokenOverride?: string): PlatformConnector {
  switch (platform) {
    case 'woocommerce':
      return new WooCommerceConnector(
        process.env.WOO_BASE_URL!,
        process.env.WOO_CONSUMER_KEY!,
        process.env.WOO_CONSUMER_SECRET!
      )

    case 'shopify_komputerzz':
      return new ShopifyConnector(
        process.env.SHOPIFY_KOMPUTERZZ_SHOP!,
        tokenOverride ?? process.env.SHOPIFY_KOMPUTERZZ_TOKEN!,
        process.env.SHOPIFY_KOMPUTERZZ_LOCATION_ID
      )

    case 'shopify_tiktok':
      return new ShopifyConnector(
        process.env.SHOPIFY_TIKTOK_SHOP!,
        tokenOverride ?? process.env.SHOPIFY_TIKTOK_TOKEN!,
        process.env.SHOPIFY_TIKTOK_LOCATION_ID
      )

    case 'xmr_bazaar':
      throw new Error('xmr_bazaar is a browser-automated channel — use the local push script, not getConnector()')

    case 'libre_market':
      throw new Error('libre_market is a browser-automated channel — use the local push script, not getConnector()')

    case 'platform_4':
      throw new Error('platform_4 connector not yet implemented')

    case 'platform_5':
      throw new Error('platform_5 connector not yet implemented')

    default: {
      const exhaustive: never = platform
      throw new Error(`Unknown platform: ${exhaustive}`)
    }
  }
}

/**
 * Async connector factory — resolves the stored OAuth token from D1 first,
 * falling back to the static env var token. Use this everywhere instead of
 * getConnector() so that daily-refreshed Shopify tokens are always used.
 */
export async function createConnector(platform: Platform): Promise<PlatformConnector> {
  if (platform === 'shopify_komputerzz' || platform === 'shopify_tiktok') {
    const token = await getStoredToken(platform)
    return getConnector(platform, token)
  }
  return getConnector(platform)
}

// ---------------------------------------------------------------------------
// Warehouse connector factory (synchronous — uses env var tokens)
// ---------------------------------------------------------------------------

export function getWarehouseConnector(warehouseId: string): WarehouseConnector {
  switch (warehouseId) {
    case 'ireland':
      return new ShopifyWarehouseConnector(
        process.env.SHOPIFY_TIKTOK_SHOP!,
        process.env.SHOPIFY_TIKTOK_TOKEN!,
        process.env.SHOPIFY_TIKTOK_IRELAND_LOCATION_ID!
      )

    case 'acer_store': {
      const urls = process.env.ACER_STORE_SCRAPE_URLS
        ? process.env.ACER_STORE_SCRAPE_URLS.split(',').map(u => u.trim()).filter(Boolean)
        : [
            'https://store.acer.com/fr-fr/ecrans',
            'https://store.acer.com/fr-fr/peripheriques',
            'https://store.acer.com/fr-fr/accessoires',
            'https://store.acer.com/fr-fr/gaming',
          ]
      return new AcerScraperConnector(process.env.FIRECRAWL_API_KEY!, urls)
    }

    case 'poland':
      throw new Error('Poland warehouse connector not yet implemented — API TBD')

    case 'spain':
      throw new Error('Spain warehouse connector not yet implemented')

    default:
      throw new Error(`Unknown warehouse: ${warehouseId}`)
  }
}

/**
 * Async warehouse connector factory — resolves stored OAuth token for Shopify-based
 * warehouses (Ireland). Falls back to env var token if none stored.
 */
export async function createWarehouseConnector(warehouseId: string): Promise<WarehouseConnector> {
  if (warehouseId === 'ireland') {
    const token = await getStoredToken('shopify_tiktok')
    return new ShopifyWarehouseConnector(
      process.env.SHOPIFY_TIKTOK_SHOP!,
      token ?? process.env.SHOPIFY_TIKTOK_TOKEN!,
      process.env.SHOPIFY_TIKTOK_IRELAND_LOCATION_ID!
    )
  }
  return getWarehouseConnector(warehouseId)
}

// ---------------------------------------------------------------------------
// All platform connectors — used for health checks
// ---------------------------------------------------------------------------

export const ALL_PLATFORMS: Platform[] = [
  'woocommerce',
  'shopify_komputerzz',
  'shopify_tiktok',
]

export const ALL_WAREHOUSE_IDS = ['ireland', 'acer_store'] as const
