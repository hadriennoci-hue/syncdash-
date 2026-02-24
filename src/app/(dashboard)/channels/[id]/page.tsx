'use client'

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'

interface ChannelConfig {
  shopDomain?:    string
  loginUrl?:      string
  newListingUrl?: string | null
  [key: string]:  unknown
}

interface Channel {
  id:            string
  name:          string
  url:           string
  connectorType: string
  enabled:       number
  config:        ChannelConfig | null
  lastPush:      string | null
  counts:        { synced: number; pending: number; failed: number; total: number }
  products:      Product[]
}

interface Product {
  sku:              string
  title:            string
  pushStatus:       string
  price:            number | null
  compareAt:        number | null
  importPrice:      number | null
  importPromoPrice: number | null
  stock: {
    ireland:    number | null
    acer_store: number | null
    poland:     number | null
  }
  platformId:  string | null
  syncStatus:  string | null
}

export default function ChannelPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['channel', params.id],
    queryFn:  () => apiFetch(`/api/channels/${params.id}`),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>
  const c: Channel | undefined = data?.data
  if (!c) return <p className="text-xs text-destructive">Channel not found</p>

  const products: Product[] = c.products ?? []

  function refresh() {
    qc.invalidateQueries({ queryKey: ['channel', params.id] })
  }

  // Browser channels with push columns (xmr_bazaar, libre_market) show the product table
  const isBrowser       = c.connectorType === 'browser'
  const hasProductTable = !isBrowser || products.length > 0

  return (
    <div className="space-y-3 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-semibold">{c.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{c.id}</p>
          <a href={c.url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-mono">{c.url}</a>
        </div>

        <div className="flex gap-6 items-start">
          {/* Counts (API channels only) */}
          {!isBrowser && (
            <div className="flex gap-4 text-xs pt-1">
              <span className="text-amber-500">{c.counts?.pending ?? 0} pending</span>
              <span className="text-green-600">{c.counts?.synced ?? 0} synced</span>
              <span className="text-destructive">{c.counts?.failed ?? 0} failed</span>
              <span className="text-muted-foreground">{c.counts?.total ?? 0} total</span>
            </div>
          )}

          {/* Config panel */}
          <div className="border border-border rounded p-2.5 text-xs space-y-1 min-w-[200px]">
            <p className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Channel config</p>
            <ConfigRow label="Type" value={c.connectorType} />
            {c.config?.shopDomain    && <ConfigRow label="Shop"      value={String(c.config.shopDomain)} />}
            {c.config?.loginUrl      && <ConfigRow label="Login URL" value={String(c.config.loginUrl)} link />}
            {c.config?.newListingUrl && <ConfigRow label="New listing" value={String(c.config.newListingUrl)} link />}
            <ConfigRow label="Last push" value={c.lastPush ? c.lastPush.slice(0, 16).replace('T', ' ') : '—'} />
          </div>
        </div>
      </div>

      {/* Browser channel placeholder — shown only when no products queued yet */}
      {isBrowser && !hasProductTable && (
        <div className="border border-dashed border-border rounded p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Browser-automated channel</p>
          <p>Set products to <span className="font-mono">2push</span> to queue them for browser automation.</p>
        </div>
      )}

      {/* Product table (API channels + browser channels with push columns) */}
      {hasProductTable && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
                <th className="text-left py-1.5 pr-3 font-medium">Title</th>
                <th className="text-left py-1.5 pr-3 font-medium">Push</th>
                <th className="text-left py-1.5 pr-3 font-medium">Price €</th>
                <th className="text-left py-1.5 pr-3 font-medium">Promo €</th>
                <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground/60">Import €</th>
                <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground/60">Import promo</th>
                <th className="text-right py-1.5 pr-3 font-medium">IE</th>
                <th className="text-right py-1.5 pr-3 font-medium">ACER</th>
                <th className="text-right py-1.5 font-medium">PL</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isTwoPush  = p.pushStatus === '2push'
                const isFail     = p.pushStatus.startsWith('FAIL:')
                const hasStock   = (p.stock.ireland ?? 0) + (p.stock.acer_store ?? 0) + (p.stock.poland ?? 0) > 0
                const isPriority = isTwoPush && hasStock

                return (
                  <tr
                    key={p.sku}
                    className={`border-b border-border hover:bg-accent/50
                      ${isPriority ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}
                      ${isFail     ? 'bg-red-50/60 dark:bg-red-900/10' : ''}`}
                  >
                    <td className="py-1 pr-3 font-mono">
                      <Link href={`/products/${p.sku}`} className="text-primary hover:underline">{p.sku}</Link>
                    </td>
                    <td className="py-1 pr-3 max-w-[180px] truncate">{p.title}</td>
                    <td className="py-1 pr-3">
                      <PushBadge value={p.pushStatus} />
                    </td>
                    <td className="py-1 pr-3">
                      <PriceCell
                        value={p.price}
                        sku={p.sku}
                        field="price"
                        platform={params.id}
                        onSaved={refresh}
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <PriceCell
                        value={p.compareAt}
                        sku={p.sku}
                        field="compareAt"
                        platform={params.id}
                        onSaved={refresh}
                      />
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground/70">
                      {p.importPrice != null ? `€${p.importPrice}` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground/70">
                      {p.importPromoPrice != null ? `€${p.importPromoPrice}` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">
                      <StockQty qty={p.stock.ireland} />
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">
                      <StockQty qty={p.stock.acer_store} />
                    </td>
                    <td className="py-1 text-right font-mono">
                      <StockQty qty={p.stock.poland} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config row
// ---------------------------------------------------------------------------

function ConfigRow({ label, value, link }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      {link
        ? <a href={value} target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline truncate max-w-[180px]" title={value}>{value}</a>
        : <span className="font-mono truncate max-w-[180px]" title={value}>{value}</span>
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Push status badge
// ---------------------------------------------------------------------------

function PushBadge({ value }: { value: string }) {
  if (value === 'done')    return <span className="text-green-600">done</span>
  if (value === '2push')   return <span className="text-amber-500 font-medium">2push</span>
  if (value.startsWith('FAIL:')) {
    return (
      <span className="text-destructive font-medium cursor-help" title={value}>
        FAIL
      </span>
    )
  }
  return <span className="text-muted-foreground">{value}</span>
}

// ---------------------------------------------------------------------------
// Inline-editable price cell
// ---------------------------------------------------------------------------

function PriceCell({
  value, sku, field, platform, onSaved,
}: {
  value: number | null
  sku: string
  field: 'price' | 'compareAt'
  platform: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    const num = parseFloat(draft)
    if (isNaN(num) || num <= 0) { setEditing(false); return }
    if (num === value)           { setEditing(false); return }
    setSaving(true)
    try {
      await apiPatch(`/api/products/${sku}/prices`, {
        [field]:     num,
        platforms:   [platform],
        triggeredBy: 'human',
      })
      onSaved()
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        disabled={saving}
        className="w-20 text-xs border border-primary rounded px-1 py-0.5 bg-background outline-none"
        autoFocus
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="text-left hover:underline decoration-dotted cursor-text"
      title="Click to edit"
    >
      {value != null ? `€${value}` : <span className="text-muted-foreground/50">—</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Stock quantity display
// ---------------------------------------------------------------------------

function StockQty({ qty }: { qty: number | null }) {
  if (qty == null || qty === 0) return <span className="text-muted-foreground/40">—</span>
  return <span className={qty > 0 ? 'text-foreground' : 'text-muted-foreground'}>{qty}</span>
}
