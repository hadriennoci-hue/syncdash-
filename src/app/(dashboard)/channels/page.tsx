'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'
import type { Platform } from '@/types/platform'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

type StatusFilter = 'all' | 'for_sale' | 'out_of_stock' | 'deactivated'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  for_sale: 'For sale',
  out_of_stock: 'Out of stock',
  deactivated: 'Deactivated',
}

interface ScanResult {
  imported: number
  updated: number
  errors: string[]
}

interface PlatformData {
  status?: string
  price?: number | null
  compareAt?: number | null
}

export default function ChannelsPage() {
  const qc = useQueryClient()

  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<Record<string, ScanResult | { error: string }> | null>(null)
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null)

  const [channelFilter, setChannelFilter] = useState<Platform | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['channels-products'],
    queryFn: () => apiFetch('/api/products?perPage=200'),
  })

  async function handleScan() {
    setScanning(true)
    setScanResults(null)
    const results: Record<string, ScanResult | { error: string }> = {}

    await Promise.all(
      PLATFORMS.map(async (platform) => {
        try {
          const res = await apiPost(`/api/import/${platform}`, { mode: 'new_changed', triggeredBy: 'human' })
          results[platform] = res.data
        } catch (err) {
          results[platform] = { error: err instanceof Error ? err.message : 'Error' }
        }
      })
    )

    setScanResults(results)
    setLastScannedAt(new Date().toLocaleTimeString())
    qc.invalidateQueries({ queryKey: ['channels-products'] })
    setScanning(false)
  }

  const products: any[] = productsData?.data ?? []

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (channelFilter !== 'all' && p.platforms[channelFilter]?.status === 'missing') return false

        const totalStock = (p.stock.ireland ?? 0) + (p.stock.poland ?? 0) + (p.stock.acer_store ?? 0)
        if (statusFilter === 'for_sale' && !(p.status === 'active' && totalStock > 0)) return false
        if (statusFilter === 'out_of_stock' && !(p.status === 'active' && totalStock === 0)) return false
        if (statusFilter === 'deactivated' && p.status !== 'archived') return false

        return true
      }),
    [products, channelFilter, statusFilter]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Sale Channels</h1>
        <div className="flex items-center gap-3">
          {lastScannedAt && <span className="text-xs text-muted-foreground">Last scanned: {lastScannedAt}</span>}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning ? 'Scanning...' : 'Scan sale channels'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {PLATFORMS.map((p) => (
          <Link
            key={p}
            href={`/channels/${p}`}
            className="border border-border rounded p-3 hover:bg-accent transition-colors text-xs"
          >
            <div className="font-medium">{PLATFORM_LABELS[p]}</div>
            <div className="text-muted-foreground mt-0.5 font-mono">{p}</div>
          </Link>
        ))}
      </div>

      {scanResults && (
        <div className="grid grid-cols-3 gap-3">
          {PLATFORMS.map((p) => {
            const r = scanResults[p]
            const isErr = 'error' in r
            return (
              <div
                key={p}
                className={`border rounded p-3 text-xs ${isErr ? 'border-destructive' : 'border-green-500/40'}`}
              >
                <div className="font-medium text-muted-foreground mb-1">{PLATFORM_LABELS[p]}</div>
                {isErr ? (
                  <span className="text-destructive">{(r as { error: string }).error}</span>
                ) : (
                  (() => {
                    const s = r as ScanResult
                    return (
                      <span>
                        <span className="text-green-600">
                          {s.imported} new � {s.updated} updated
                        </span>
                        {s.errors.length > 0 && <span className="text-amber-500"> � {s.errors.length} errors</span>}
                      </span>
                    )
                  })()
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value as Platform | 'all')}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="all">All channels</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          {(Object.entries(STATUS_LABELS) as [StatusFilter, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} product{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading products...</p>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">SKU</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Coincart</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Komputerzz</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">TikTok</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">eBay IE</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">LibreMarket</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">XMRBazar</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-muted-foreground">
                    No products match the current filters
                  </td>
                </tr>
              ) : (
                filtered.map((p: any) => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
                    <td className="px-3 py-2 font-mono">
                      <Link href={`/products/${p.id}`} className="text-primary hover:underline">
                        {p.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={p.title}>
                      {p.title}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.woocommerce} product={p} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.shopify_komputerzz} product={p} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.shopify_tiktok} product={p} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.ebay_ie} product={p} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.libre_market} product={p} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ChannelPriceCell platform={p.platforms.xmr_bazaar} product={p} />
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{p.updatedAt?.slice(0, 10) ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ChannelPriceCell({ platform, product }: { platform?: PlatformData; product: any }) {
  if (!platform || platform.status === 'missing') {
    return <span className="text-muted-foreground">-</span>
  }

  const totalStock = (product.stock?.ireland ?? 0) + (product.stock?.poland ?? 0) + (product.stock?.acer_store ?? 0)
  const hasStock = totalStock > 0
  const colorClass = hasStock ? 'text-green-600' : 'text-red-600'

  const price = Number(platform.price)
  const compareAt = Number(platform.compareAt)

  if (!Number.isFinite(price)) {
    return <span className="text-muted-foreground">-</span>
  }

  if (Number.isFinite(compareAt) && compareAt > price) {
    return (
      <span className={colorClass}>
        <span className="line-through opacity-80 mr-1">EUR {compareAt.toFixed(2)}</span>
        <span>EUR {price.toFixed(2)}</span>
      </span>
    )
  }

  return <span className={colorClass}>EUR {price.toFixed(2)}</span>
}
