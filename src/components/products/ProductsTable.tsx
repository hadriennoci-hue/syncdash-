'use client'

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS } from '@/types/platform'

const PLATFORMS = ['coincart2', 'shopify_komputerzz', 'ebay_ie', 'libre_market', 'xmr_bazaar'] as const

interface FillResult {
  sku:     string
  status:  'complete' | 'filled' | 'info' | 'queued'
  filled:  string[]
  missing: string[]
  sources: string[]
}

interface ProductsTableProps {
  mode?: 'default' | 'warehouse_overview'
}

export function ProductsTable({ mode = 'default' }: ProductsTableProps) {
  const qc = useQueryClient()
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const [filling, setFilling]       = useState(false)
  const [fillProgress, setProgress] = useState<{ done: number; total: number; results: FillResult[] } | null>(null)
  const abortRef = useRef(false)

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, search, status],
    queryFn:  () => apiFetch(`/api/products?page=${page}&perPage=50&search=${encodeURIComponent(search)}&status=${status}`),
  })

  const prods = data?.data ?? []
  const total = data?.meta?.total ?? 0

  async function handleFillMissing() {
    setFilling(true)
    abortRef.current = false
    setProgress({ done: 0, total: 0, results: [] })

    const list = await apiFetch('/api/products?missingFields=1&hasStock=1&perPage=200&page=1')
    const skus: string[] = (list?.data ?? []).map((p: { id: string }) => p.id)

    if (skus.length === 0) {
      setProgress({ done: 0, total: 0, results: [] })
      setFilling(false)
      return
    }

    setProgress({ done: 0, total: skus.length, results: [] })

    const results: FillResult[] = []
    for (const sku of skus) {
      if (abortRef.current) break
      try {
        const res = await apiPost(`/api/products/${sku}/fill-missing`, { triggeredBy: 'human' })
        results.push(res.data as FillResult)
      } catch {
        results.push({ sku, status: 'info', filled: [], missing: ['error'], sources: [] })
      }
      setProgress({ done: results.length, total: skus.length, results: [...results] })
    }

    setFilling(false)
    qc.invalidateQueries({ queryKey: ['products'] })
  }

  function handleAbort() {
    abortRef.current = true
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Products ({total})</h2>
        <div className="flex gap-2">
          {filling ? (
            <button onClick={handleAbort}
              className="text-xs px-2.5 py-1 rounded border border-destructive text-destructive hover:bg-destructive/10">
              Stop
            </button>
          ) : (
            <button onClick={handleFillMissing}
              className="text-xs px-2.5 py-1 rounded bg-amber-500 text-white hover:bg-amber-600">
              Fill missing info
            </button>
          )}
          <Link href="/products/new"
            className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90">
            + New product
          </Link>
        </div>
      </div>

      {fillProgress && (
        <div className="border border-border rounded p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
              Fill missing info - {fillProgress.done} / {fillProgress.total}
            </span>
            {!filling && fillProgress.done > 0 && (
              <button onClick={() => setProgress(null)} className="text-muted-foreground hover:text-foreground">x</button>
            )}
          </div>
          {fillProgress.total > 0 && (
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(fillProgress.done / fillProgress.total) * 100}%` }}
              />
            </div>
          )}
          {fillProgress.total === 0 && !filling && (
            <p className="text-green-600">All products already have the required fields.</p>
          )}
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {fillProgress.results.map((r) => (
              <div key={r.sku} className="flex items-center gap-2">
                <span className={
                  r.status === 'info'     ? 'text-destructive font-medium w-12' :
                  r.status === 'queued'   ? 'text-amber-500 w-12' :
                  r.status === 'filled'   ? 'text-green-600 w-12' :
                  'text-muted-foreground w-12'
                }>
                  {r.status === 'info' ? 'INFO' : r.status === 'queued' ? 'queued' : r.status === 'filled' ? 'filled' : 'ok'}
                </span>
                <Link href={`/products/${r.sku}`} className="font-mono hover:underline">{r.sku}</Link>
                {r.filled.length > 0 && <span className="text-muted-foreground">+{r.filled.join(', ')}</span>}
                {r.missing.length > 0 && <span className="text-destructive">missing: {r.missing.join(', ')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search SKU or title..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="text-xs border border-border rounded px-2 py-1 bg-background w-56"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="info">Info (incomplete)</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-3 font-medium w-28">SKU</th>
                <th className="text-left py-1.5 pr-3 font-medium">Title</th>
                <th className="text-left py-1.5 pr-3 font-medium">Supplier</th>
                <th className="text-left py-1.5 pr-3 font-medium">Status</th>
                {mode === 'default' && PLATFORMS.map((p) => (
                  <th key={p} className="text-left py-1.5 pr-3 font-medium">{PLATFORM_LABELS[p]}</th>
                ))}
                <th className="text-left py-1.5 pr-3 font-medium">IE</th>
                <th className="text-left py-1.5 pr-3 font-medium">PL</th>
                <th className="text-left py-1.5 pr-3 font-medium">ACER</th>
                <th className="text-left py-1.5 pr-3 font-medium">DS</th>
                {mode === 'warehouse_overview' && (
                  <>
                    <th className="text-left py-1.5 pr-3 font-medium">Import EUR</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Import promo EUR</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Purchase EUR</th>
                  </>
                )}
                <th className="text-left py-1.5 pr-3 font-medium">Imgs</th>
              </tr>
            </thead>
            <tbody>
              {prods.map((p: any) => (
                <tr key={p.id} className="border-b border-border hover:bg-accent/50">
                  <td className="py-1 pr-3 font-mono">
                    <Link href={`/products/${p.id}`} className="text-primary hover:underline">{p.id}</Link>
                  </td>
                  <td className="py-1 pr-3 max-w-xs truncate">{p.title}</td>
                  <td className="py-1 pr-3">
                    {p.supplier
                      ? <Link href={`/suppliers/${p.supplier.id}`} className="text-primary hover:underline">{p.supplier.name}</Link>
                      : <span className="text-muted-foreground">-</span>
                    }
                  </td>
                  <td className="py-1 pr-3">
                    <StatusBadge status={p.status} />
                  </td>
                  {mode === 'default' && PLATFORMS.map((pl) => {
                    const d = p.platforms?.[pl]
                    return (
                      <td key={pl} className="py-1 pr-3">
                        <Link href={`/channels/${pl}`} className="hover:underline">
                          <StatusDot status={d?.status} />
                        </Link>
                        {d?.price != null && <span className="ml-1 text-muted-foreground">EUR {d.price}</span>}
                      </td>
                    )
                  })}
                  <td className="py-1 pr-3">{p.stock?.ireland ?? '-'}</td>
                  <td className="py-1 pr-3">{p.stock?.poland ?? '-'}</td>
                  <td className="py-1 pr-3">{p.stock?.acer_store ?? '-'}</td>
                  <td className="py-1 pr-3">{p.stock?.dropshipping ?? '-'}</td>
                  {mode === 'warehouse_overview' && (
                    <>
                      <td className="py-1 pr-3">{p.stock?.importPrice != null ? `EUR ${p.stock.importPrice}` : '-'}</td>
                      <td className="py-1 pr-3">{p.stock?.importPromoPrice != null ? `EUR ${p.stock.importPromoPrice}` : '-'}</td>
                      <td className="py-1 pr-3">{p.stock?.purchasePrice != null ? `EUR ${p.stock.purchasePrice}` : '-'}</td>
                    </>
                  )}
                  <td className="py-1 pr-3">
                    {mode === 'warehouse_overview'
                      ? <StockHealthDot product={p} />
                      : <span className={p.hasMinImages ? 'text-green-600' : 'text-amber-500'}>{p.imageCount}</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2 text-xs items-center">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-2 py-1 border border-border rounded disabled:opacity-40"
        >Prev</button>
        <span className="text-muted-foreground">Page {page} - {total} refs</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={prods.length < 50}
          className="px-2 py-1 border border-border rounded disabled:opacity-40"
        >Next</button>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'info') return <span className="text-muted-foreground font-semibold">INFO</span>
  if (status === 'active') return <span className="text-green-600">{status}</span>
  return <span className="text-muted-foreground">{status ?? '-'}</span>
}

function StatusDot({ status }: { status?: string }) {
  const color = status === 'synced' ? 'bg-green-500' : status === 'differences' ? 'bg-amber-500' : 'bg-muted-foreground/40'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status} />
}

function StockHealthDot({ product }: { product: any }) {
  const totalStock = (product.stock?.ireland ?? 0) + (product.stock?.poland ?? 0) + (product.stock?.acer_store ?? 0) + (product.stock?.dropshipping ?? 0)
  const incomplete = product.status === 'info' || !product.hasDescription || !product.hasMinImages
  const color = totalStock > 0 ? 'bg-green-500' : (incomplete ? 'bg-muted-foreground/50' : 'bg-red-500')
  const title = totalStock > 0 ? 'In stock' : (incomplete ? 'Incomplete' : 'Out of stock')
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} title={title} />
}

