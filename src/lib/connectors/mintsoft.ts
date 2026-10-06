import type {
  HealthCheckResult,
  WarehouseConnector,
  WarehouseStockOptions,
  WarehouseStockSnapshot,
} from './types'

// Mintsoft (2Flow's WMS) — the source of truth for the Ireland warehouse.
// Mintsoft pushes this same stock to the TikTok Tech Store on Shopify; reading it here directly
// avoids depending on that copy (and the loop where Wizhard read the Tech Store back).
//
// API notes (checked against the live API):
// - Auth: GET /api/Auth/Login?UserName=&Password= returns a GUID, sent as the `ms-apikey` header.
// - A User-Agent header is mandatory: without it the WAF answers 403.
// - /api/Product/StockLevels returns every level at once (its ProductIds filter is ignored).
// - SKUs come from /api/Product/List (paged), joined on the product id.
const BASE_URL = 'https://api.mintsoft.co.uk/api'
const USER_AGENT = 'Wizhard/1.0 (+https://wizhard.store)'
const PAGE_SIZE = 200
const MAX_PAGES = 50

type MintsoftRecord = Record<string, unknown>

// Mintsoft field casing is not consistent across endpoints (ProductId / ProductID / productId).
export function pickField(record: MintsoftRecord, ...names: string[]): unknown {
  const byLower = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]))
  for (const name of names) {
    const key = byLower.get(name.toLowerCase())
    if (key !== undefined && record[key] !== null && record[key] !== undefined) return record[key]
  }
  return undefined
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Sellable quantity of one stock-level row: `Available` when Mintsoft provides it, otherwise
 * on-hand `Level` minus `Allocated` (stock already reserved for orders). Never negative.
 */
export function sellableQuantity(level: MintsoftRecord): number {
  const available = toNumber(pickField(level, 'Available', 'AvailableLevel', 'AvailableStock'))
  if (available !== null) return Math.max(0, Math.floor(available))
  const onHand = toNumber(pickField(level, 'Level', 'StockLevel', 'Quantity')) ?? 0
  const allocated = toNumber(pickField(level, 'Allocated', 'AllocatedLevel')) ?? 0
  return Math.max(0, Math.floor(onHand - allocated))
}

/**
 * Join stock levels to product SKUs and sum per SKU (a product can have one row per warehouse
 * or location). Products with no stock-level row are reported at 0 so the scan zeroes them.
 */
export function buildSnapshots(
  productRows: MintsoftRecord[],
  levelRows: MintsoftRecord[],
  warehouseId?: number | null,
): WarehouseStockSnapshot[] {
  const productById = new Map<string, { sku: string; name?: string }>()
  for (const p of productRows) {
    const id = pickField(p, 'ID', 'Id', 'ProductId')
    const sku = pickField(p, 'SKU', 'Sku')
    if (id === undefined || typeof sku !== 'string' || !sku.trim()) continue
    const name = pickField(p, 'Name', 'Description')
    productById.set(String(id), { sku: sku.trim(), name: typeof name === 'string' ? name : undefined })
  }

  const quantityBySku = new Map<string, number>()
  for (const level of levelRows) {
    if (warehouseId != null) {
      const levelWarehouse = toNumber(pickField(level, 'WarehouseId', 'WarehouseID'))
      if (levelWarehouse !== null && levelWarehouse !== warehouseId) continue
    }
    const productId = pickField(level, 'ProductId', 'ProductID')
    const directSku = pickField(level, 'SKU', 'Sku')
    const sku = (productId !== undefined ? productById.get(String(productId))?.sku : undefined)
      ?? (typeof directSku === 'string' ? directSku.trim() : undefined)
    if (!sku) continue
    quantityBySku.set(sku, (quantityBySku.get(sku) ?? 0) + sellableQuantity(level))
  }

  const snapshots: WarehouseStockSnapshot[] = []
  for (const { sku, name } of productById.values()) {
    snapshots.push({ sku, quantity: quantityBySku.get(sku) ?? 0, sourceName: name })
    quantityBySku.delete(sku)
  }
  // Levels whose product id was not in the product list still carry a SKU — keep them.
  for (const [sku, quantity] of quantityBySku) snapshots.push({ sku, quantity })
  return snapshots
}

export class MintsoftWarehouseConnector implements WarehouseConnector {
  private apiKey: string | null = null

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly warehouseId: number | null = null,
  ) {}

  private headers(): Record<string, string> {
    return { Accept: 'application/json', 'User-Agent': USER_AGENT }
  }

  private async login(): Promise<string> {
    if (this.apiKey) return this.apiKey
    const url = `${BASE_URL}/Auth/Login?UserName=${encodeURIComponent(this.username)}&Password=${encodeURIComponent(this.password)}`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) throw new Error(`Mintsoft login failed: ${res.status}`)
    const key = (await res.text()).trim().replace(/^"|"$/g, '')
    if (!key) throw new Error('Mintsoft login returned an empty API key')
    this.apiKey = key
    return key
  }

  private async get<T>(path: string): Promise<T> {
    const key = await this.login()
    const res = await fetch(`${BASE_URL}${path}`, { headers: { ...this.headers(), 'ms-apikey': key } })
    if (!res.ok) throw new Error(`Mintsoft ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  private async listProducts(): Promise<MintsoftRecord[]> {
    const all: MintsoftRecord[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await this.get<MintsoftRecord[]>(`/Product/List?PageSize=${PAGE_SIZE}&PageNo=${page}`)
      if (!Array.isArray(rows) || rows.length === 0) break
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return all
  }

  async getStock(options: WarehouseStockOptions = {}): Promise<WarehouseStockSnapshot[]> {
    const onProgress = options.onProgress
    onProgress?.({ stage: 'start', warehouseId: 'ireland', message: 'Scanning Mintsoft (2Flow Dublin)', current: 0, total: 1 })
    const [productRows, levelRows] = await Promise.all([
      this.listProducts(),
      this.get<MintsoftRecord[]>('/Product/StockLevels'),
    ])
    const snapshots = buildSnapshots(productRows, Array.isArray(levelRows) ? levelRows : [], this.warehouseId)
    onProgress?.({ stage: 'fetch_done', warehouseId: 'ireland', message: `Mintsoft scan done (${snapshots.length} SKUs)`, current: 1, total: 1 })
    return snapshots
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await this.get<unknown>('/Warehouse')
      return { ok: true, latencyMs: Date.now() - start, error: null }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Unknown' }
    }
  }
}
