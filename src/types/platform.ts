export type Platform =
  | 'woocommerce'
  | 'shopify_komputerzz'
  | 'shopify_tiktok'
  | 'libre_market'
  | 'xmr_bazaar'
  | 'platform_4'
  | 'platform_5'

export type WarehouseId =
  | 'ireland'
  | 'poland'
  | 'acer_store'
  | 'spain'

export type TriggeredBy = 'human' | 'agent' | 'system'

export type SyncResult = {
  platform: Platform
  success: boolean
  platformId?: string
  error?: string
}

export type ImageInput =
  | { type: 'url'; url: string; alt?: string }
  | { type: 'file'; data: Buffer; filename: string; mimeType: string }

export type PricePerPlatform = Partial<Record<Platform, number>>

export type PlatformStatus = 'synced' | 'differences' | 'missing' | 'error' | 'pending'

export const PLATFORMS: Platform[] = [
  'woocommerce',
  'shopify_komputerzz',
  'shopify_tiktok',
  'xmr_bazaar',
  'libre_market',
]

export const PLATFORM_LABELS: Record<Platform, string> = {
  woocommerce:        'COINCART.STORE',
  shopify_komputerzz: 'KOMPUTERZZ.COM',
  shopify_tiktok:     'Tech Store (TikTok)',
  libre_market:       'Libre Market',
  xmr_bazaar:         'XMR Bazaar',
  platform_4:         'Platform 4',
  platform_5:         'Platform 5',
}

export const WAREHOUSE_LABELS: Record<WarehouseId, string> = {
  ireland:    'Entrepôt Irlande',
  poland:     'Entrepôt Pologne',
  acer_store: 'ACER Store',
  spain:      'Entrepôt Espagne',
}
