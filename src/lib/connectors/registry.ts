import type { Platform } from '@/types/platform'
import type { PlatformConnector, WarehouseConnector } from './types'
import { ShopifyConnector, ShopifyWarehouseConnector } from './shopify'
import { WooCommerceConnector } from './woocommerce'
import { EbayConnector } from './ebay'
import { AcerScraperConnector } from './acer-scraper'
import { getStoredToken } from '@/lib/functions/tokens'

// ---------------------------------------------------------------------------
// Platform connector factory (sync)
// Pass tokenOverride to use a dynamically-obtained OAuth token.
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
      if (!tokenOverride) {
        throw new Error('Missing stored OAuth token for shopify_komputerzz. Refresh tokens first.')
      }
      return new ShopifyConnector(
        process.env.SHOPIFY_KOMPUTERZZ_SHOP!,
        tokenOverride,
        process.env.SHOPIFY_KOMPUTERZZ_LOCATION_ID
      )

    case 'shopify_tiktok':
      if (!tokenOverride) {
        throw new Error('Missing stored OAuth token for shopify_tiktok. Refresh tokens first.')
      }
      return new ShopifyConnector(
        process.env.SHOPIFY_TIKTOK_SHOP!,
        tokenOverride,
        process.env.SHOPIFY_TIKTOK_LOCATION_ID
      )

    case 'ebay_ie':
      return new EbayConnector(
        process.env.EBAY_CLIENT_ID!,
        process.env.EBAY_CLIENT_SECRET!,
        process.env.EBAY_REFRESH_TOKEN!,
        process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_IE',
        process.env.EBAY_API_BASE_URL ?? 'https://api.ebay.com'
      )

    case 'xmr_bazaar':
      throw new Error('xmr_bazaar is a browser-automated channel - use the local push script, not getConnector()')

    case 'libre_market':
      throw new Error('libre_market is a browser-automated channel - use the local push script, not getConnector()')

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
 * Async connector factory - resolves stored OAuth token from D1.
 * Use this everywhere instead of getConnector() for Shopify channels.
 */
export async function createConnector(platform: Platform): Promise<PlatformConnector> {
  if (platform === 'shopify_komputerzz' || platform === 'shopify_tiktok') {
    const token = await getStoredToken(platform)
    if (!token) {
      throw new Error(`No valid stored OAuth token for ${platform}. Run /api/tokens/refresh first.`)
    }
    return getConnector(platform, token)
  }
  return getConnector(platform)
}

// ---------------------------------------------------------------------------
// Warehouse connector factory (sync)
// ---------------------------------------------------------------------------

export function getWarehouseConnector(warehouseId: string): WarehouseConnector {
  switch (warehouseId) {
    case 'ireland':
      if (!process.env.SHOPIFY_TIKTOK_TOKEN) {
        throw new Error('Legacy SHOPIFY_TIKTOK_TOKEN is not configured for synchronous warehouse connector.')
      }
      return new ShopifyWarehouseConnector(
        process.env.SHOPIFY_TIKTOK_SHOP!,
        process.env.SHOPIFY_TIKTOK_TOKEN!,
        process.env.SHOPIFY_TIKTOK_IRELAND_LOCATION_ID!
      )

    case 'acer_store': {
      const urls = process.env.ACER_STORE_SCRAPE_URLS
        ? process.env.ACER_STORE_SCRAPE_URLS.split(',').map((u) => u.trim()).filter(Boolean)
        : [
            'https://store.acer.com/fr-fr/ecrans',
            'https://store.acer.com/fr-fr/peripheriques',
            'https://store.acer.com/fr-fr/accessoires',
            'https://store.acer.com/fr-fr/gaming',
          ]
      return new AcerScraperConnector(process.env.FIRECRAWL_API_KEY!, urls)
    }

    case 'poland':
      throw new Error('Poland warehouse connector not yet implemented - API TBD')

    case 'spain':
      throw new Error('Spain warehouse connector not yet implemented')

    default:
      throw new Error(`Unknown warehouse: ${warehouseId}`)
  }
}

/**
 * Async warehouse connector factory - resolves stored OAuth token for
 * Shopify-based warehouses (Ireland).
 */
export async function createWarehouseConnector(warehouseId: string): Promise<WarehouseConnector> {
  if (warehouseId === 'ireland') {
    const token = await getStoredToken('shopify_tiktok')
    if (!token) {
      throw new Error('No valid stored OAuth token for shopify_tiktok. Run /api/tokens/refresh first.')
    }
    return new ShopifyWarehouseConnector(
      process.env.SHOPIFY_TIKTOK_SHOP!,
      token,
      process.env.SHOPIFY_TIKTOK_IRELAND_LOCATION_ID!
    )
  }
  return getWarehouseConnector(warehouseId)
}

// ---------------------------------------------------------------------------
// All platform connectors - used for health checks
// ---------------------------------------------------------------------------

export const ALL_PLATFORMS: Platform[] = [
  'woocommerce',
  'shopify_komputerzz',
  'shopify_tiktok',
  'ebay_ie',
]

export const ALL_WAREHOUSE_IDS = ['ireland', 'acer_store'] as const
