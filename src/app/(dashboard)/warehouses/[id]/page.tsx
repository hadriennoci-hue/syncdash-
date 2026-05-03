'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'

type PushStatus = string   // 'N' | '2push' | 'done' | 'FAIL: <reason>'

const PUSH_PLATFORMS = [
  { key: 'coincart2',        field: 'pushedCoincart2',       label: 'Coincart2' },
  { key: 'shopify_komputerzz', field: 'pushedShopifyKomputerzz', label: 'Komp.' },
  { key: 'ebay_ie',            field: 'pushedEbayIe',            label: 'eBay' },
  { key: 'libre_market',       field: 'pushedLibreMarket',       label: 'Libre' },
  { key: 'xmr_bazaar',         field: 'pushedXmrBazaar',         label: 'XMR' },
] as const

type PlatformKey = typeof PUSH_PLATFORMS[number]['key']
type PushField = typeof PUSH_PLATFORMS[number]['field']

type DirtyMap = Record<string, Partial<Record<PlatformKey, PushStatus>>>
type StockDirtyMap = Record<string, number>

export default function WarehousePage({ params }: { params: { id: string } }) {
  const qc = useQueryClient()
  const [dirty, setDirty]   = useState<DirtyMap>({})
  const [stockDirty, setStockDirty] = useState<StockDirtyMap>({})
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse', params.id],
    queryFn:  () => apiFetch(`/api/warehouses/${params.id}`),
  })

  const dirtyCount =
    Object.values(dirty).reduce((n, m) => n + Object.keys(m).length, 0) +
    Object.keys(stockDirty).length

  const handleChange = useCallback((sku: string, platform: PlatformKey, value: PushStatus) => {
    setDirty((prev) => ({
      ...prev,
      [sku]: { ...prev[sku], [platform]: value },
    }))
  }, [])

  const handleStockChange = useCallback((sku: string, value: string, currentQty: number | null) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return

    if (currentQty !== null && parsed === currentQty) {
      setStockDirty((prev) => {
        const next = { ...prev }
        delete next[sku]
        return next
      })
      return
    }

    setStockDirty((prev) => ({ ...prev, [sku]: parsed }))
  }, [])

  const applyBulkPlatformStatus = useCallback((rows: any[], platform: PlatformKey, value: PushStatus) => {
    const field = PUSH_PLATFORMS.find((p) => p.key === platform)?.field as PushField | undefined
    if (!field || rows.length === 0) return

    setDirty((prev) => {
      const next: DirtyMap = { ...prev }
      for (const row of rows) {
        const base = String(row[field] ?? 'N')
        const existing = next[row.productId] ?? {}
        const rowNext = { ...existing }

        if (value === base) delete rowNext[platform]
        else rowNext[platform] = value

        if (Object.keys(rowNext).length === 0) delete next[row.productId]
        else next[row.productId] = rowNext
      }
      return next
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setErrors([])
    const calls: Promise<void>[] = []
    const errs: string[] = []

    for (const [sku, platforms] of Object.entries(dirty)) {
      for (const [platform, status] of Object.entries(platforms) as [PlatformKey, PushStatus][]) {
        calls.push(
          apiPatch(`/api/products/${sku}/push-status`, { platform, status })
            .catch(() => { errs.push(sku) })
        )
      }
    }

    for (const [sku, quantity] of Object.entries(stockDirty)) {
      calls.push(
        apiPatch(`/api/warehouses/${params.id}/stock`, { productId: sku, quantity })
          .catch(() => { errs.push(sku) })
      )
    }

    await Promise.all(calls)
    setSaving(false)

    if (errs.length === 0) {
      setDirty({})
      setStockDirty({})
      qc.invalidateQueries({ queryKey: ['warehouse', params.id] })
    } else {
      setErrors([...new Set(errs)])
    }
  }

  function handleDiscard() {
    setDirty({})
    setStockDirty({})
    setErrors([])
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  const w = data?.data
  if (!w) return <p className="text-xs text-destructive">Warehouse not found</p>

  return (
    <div className="space-y-4 w-full max-w-none pb-16">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold">{w.displayName}</h1>
          <p className="text-xs text-muted-foreground">{w.address ?? 'â€”'}</p>
        </div>
        <div className="text-xs space-y-0.5 text-right">
          <div><span className="text-green-600">manual stock edit enabled</span></div>
          <div className="text-muted-foreground">Last sync: {w.lastSynced?.slice(0, 10) ?? 'never'}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground align-top">
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">SKU</th>
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">Title</th>
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">Categories</th>
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">Status</th>
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">Qty</th>
              <th className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">Ordered</th>
              {PUSH_PLATFORMS.map((p) => (
                <th key={p.key} className="text-left py-2.5 pr-3 font-medium whitespace-normal leading-4">
                  <div className="flex items-center gap-1.5">
                    <span className="whitespace-normal break-words max-w-[56px] block">
                      {p.label}
                    </span>
                    <select
                      defaultValue=""
                      disabled={saving || !(w.stock?.length > 0)}
                      onChange={(e) => {
                        const v = e.target.value as PushStatus
                        if (!v) return
                        applyBulkPlatformStatus(w.stock ?? [], p.key, v)
                        e.currentTarget.value = ''
                      }}
                      className="text-[11px] border border-border rounded px-1 py-0.5 bg-background disabled:opacity-50"
                      title={`Apply ${p.label} to all`}
                    >
                      <option value="">all…</option>
                      <option value="N">N</option>
                      <option value="2push">2push</option>
                      <option value="done">done</option>
                    </select>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w.stock?.map((s: {
              productId: string
              productTitle: string | null
              productStatus: string | null
              pushedCoincart2: PushStatus
              pushedShopifyKomputerzz: PushStatus
              pushedEbayIe: PushStatus
              pushedLibreMarket: PushStatus
              pushedXmrBazaar: PushStatus
              quantity: number | null
              quantityOrdered: number
              purchasePrice: number | null
              categories: string[]
            }) => {
              const rowDirty = dirty[s.productId] ?? {}
              const stockChanged = stockDirty[s.productId] !== undefined
              const isDirtyRow = Object.keys(rowDirty).length > 0 || stockChanged
              const hasError = errors.includes(s.productId)
              const hasFail = PUSH_PLATFORMS.some((p) => (s[p.field as keyof typeof s] as string)?.startsWith('FAIL:'))
              const hasNoChannels = PUSH_PLATFORMS.every((p) => (s[p.field as keyof typeof s] as string) === 'N')

              return (
                <tr
                  key={s.productId}
                  className={`border-b border-border hover:bg-accent/50 ${hasError || hasFail ? 'bg-red-50/60 dark:bg-red-900/10' : isDirtyRow ? 'bg-amber-50/60 dark:bg-amber-900/10' : hasNoChannels ? 'bg-orange-50/80 dark:bg-orange-900/10' : ''}`}
                >
                  <td className="py-1 pr-3 font-mono">
                    <Link href={`/products/${s.productId}`} className="text-primary hover:underline">{s.productId}</Link>
                  </td>
                  <td className="py-1 pr-3 max-w-xs">
                    <span
                      className="block overflow-hidden whitespace-normal break-words leading-4"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      title={s.productTitle ?? 'â€”'}
                    >
                      {s.productTitle ?? 'â€”'}
                    </span>
                  </td>
                  <td className="py-1 pr-3 max-w-[160px]">
                    {s.categories.length > 0
                      ? <span className="text-muted-foreground">{s.categories.join(', ')}</span>
                      : <span className="text-muted-foreground/50">â€”</span>}
                  </td>
                  <td className="py-1 pr-3">
                    <span className={s.productStatus === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{s.productStatus}</span>
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      disabled={saving}
                      value={stockDirty[s.productId] ?? (s.quantity ?? 0)}
                      onChange={(e) => handleStockChange(s.productId, e.target.value, s.quantity)}
                      className={`w-20 text-xs border rounded px-1 py-0.5 bg-background
                        ${stockChanged ? 'border-amber-400' : 'border-border'}
                        disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                  </td>
                  <td className="py-1 pr-3">{s.quantityOrdered ?? 'â€”'}</td>
                  {PUSH_PLATFORMS.map((p) => {
                    const fieldValue = s[p.field as keyof typeof s] as PushStatus
                    const current = rowDirty[p.key] ?? fieldValue
                    const changed = rowDirty[p.key] !== undefined
                    return (
                      <td key={p.key} className="py-1 pr-3">
                        <PushSelect
                          value={current}
                          changed={changed}
                          disabled={saving}
                          onChange={(v) => handleChange(s.productId, p.key, v)}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky save banner */}
      {dirtyCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-background border border-border shadow-lg rounded-lg px-4 py-2.5 text-xs">
          <span className="text-amber-600 font-medium">
            {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}
          </span>
          {errors.length > 0 && (
            <span className="text-destructive">Errors on: {errors.join(', ')}</span>
          )}
          <button
            onClick={handleDiscard}
            disabled={saving}
            className="px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2.5 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving && <span className="inline-block h-3 w-3 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />}
            Save
          </button>
        </div>
      )}
    </div>
  )
}

function PushSelect({ value, changed, disabled, onChange }: {
  value: PushStatus
  changed: boolean
  disabled: boolean
  onChange: (v: PushStatus) => void
}) {
  const isFail = value.startsWith('FAIL:')

  if (isFail) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="text-xs text-destructive font-medium cursor-help"
          title={value}
        >
          FAIL
        </span>
        <select
          value=""
          disabled={disabled}
          onChange={(e) => { if (e.target.value) onChange(e.target.value as PushStatus) }}
          className="text-xs border border-destructive/40 rounded px-1 py-0.5 bg-background cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed text-muted-foreground"
        >
          <option value="" disabled>resetâ€¦</option>
          <option value="N">â†’ N</option>
          <option value="2push">â†’ 2push</option>
        </select>
      </div>
    )
  }

  const colorClass =
    value === 'done'  ? 'text-green-600' :
    value === '2push' ? 'text-amber-600' :
    'text-muted-foreground'

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as PushStatus)}
      className={`text-xs border rounded px-1 py-0.5 bg-background cursor-pointer
        ${changed ? 'border-amber-400' : 'border-border'}
        ${colorClass}
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <option value="N">N</option>
      <option value="2push">2push</option>
      <option value="done">done</option>
    </select>
  )
}


