'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost, apiPatch } from '@/lib/utils/api-fetch'

const REGIONS = ['IE', 'FR', 'ES', 'IT'] as const

interface Shop {
  price: number | null
  forSale: boolean
  livePrice: number | null
  liveStatus: string | null
  auditStatus: string | null
  tiktokProductId: string | null
  lastSeenAt: string | null
}
interface Row { productId: string; title: string | null; shopifyTiktokPrice: number | null; shops: Record<string, Shop> }
interface PushPlan {
  dryRun: boolean
  push: { productId: string; region: string; from: number | null; to: number }[]
  skipped: { productId: string; region: string; reason: string }[]
  results: { productId: string; region: string; ok: boolean; livePriceAfter?: number | null; error?: string }[]
}

const eur = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2))
const differs = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) >= 0.005

function statusTone(s: Shop | undefined) {
  if (!s?.liveStatus) return 'text-muted-foreground'
  if (s.liveStatus === 'ACTIVATE') return 'text-green-600'
  if (s.liveStatus === 'FAILED' || s.liveStatus === 'NOT_FOUND') return 'text-destructive'
  return 'text-amber-600'
}

function PriceCell({ row, region }: { row: Row; region: (typeof REGIONS)[number] }) {
  const qc = useQueryClient()
  const shop = row.shops[region]
  const [draft, setDraft] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: object) => apiPatch('/api/tiktok/listings', { sku: row.productId, region, ...body }),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['tiktok-listings'] }) },
  })
  const wanted = region === 'IE' ? row.shopifyTiktokPrice : shop?.price ?? null
  const value = draft ?? (wanted === null ? '' : String(wanted))
  const commit = () => {
    if (draft === null) return
    const n = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
    if (n !== null && !(n > 0)) { setDraft(null); return }
    save.mutate({ price: n })
  }
  const forSale = shop?.forSale ?? true

  return (
    <td className={`py-1 pr-3 align-top ${forSale ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-1">
        {region === 'IE' ? (
          <span className="font-mono w-16 inline-block" title="IE price = Shopify (shopify_tiktok)">{eur(wanted)}</span>
        ) : (
          <input
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            placeholder="—"
            className="w-16 font-mono text-xs border border-border rounded px-1 py-0.5 bg-background"
          />
        )}
        <input
          type="checkbox"
          checked={forSale}
          title="For sale on this shop"
          onChange={(e) => save.mutate({ forSale: e.target.checked })}
        />
      </div>
      <div className="text-[10px] leading-tight mt-0.5">
        <span className={differs(wanted, shop?.livePrice) ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}>
          live {eur(shop?.livePrice)}
        </span>{' '}
        <span className={statusTone(shop)}>{shop?.liveStatus ?? (shop?.tiktokProductId ? '' : 'not listed')}</span>
        {shop?.auditStatus && shop.auditStatus !== 'APPROVED' ? <span className="text-destructive"> · {shop.auditStatus}</span> : null}
      </div>
      {save.isError ? <div className="text-[10px] text-destructive">{(save.error as Error).message}</div> : null}
    </td>
  )
}

export default function TikTokPricesPage() {
  const qc = useQueryClient()
  const [plan, setPlan] = useState<PushPlan | null>(null)
  const [newSku, setNewSku] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tiktok-listings'],
    queryFn: () => apiFetch('/api/tiktok/listings'),
  })
  const rows: Row[] = data?.data?.products ?? []

  const refresh = useMutation({
    mutationFn: () => apiPost('/api/tiktok/listings/refresh', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tiktok-listings'] }),
  })
  const push = useMutation({
    mutationFn: (dryRun: boolean) => apiPost('/api/tiktok/listings/push', { dryRun }),
    onSuccess: (res: { data: PushPlan }) => { setPlan(res.data); if (!res.data.dryRun) qc.invalidateQueries({ queryKey: ['tiktok-listings'] }) },
  })
  const add = useMutation({
    mutationFn: (sku: string) => apiPatch('/api/tiktok/listings', { sku, region: 'FR', forSale: true }),
    onSuccess: () => { setNewSku(''); qc.invalidateQueries({ queryKey: ['tiktok-listings'] }) },
  })

  const refreshErrors = (refresh.data as { data?: { results?: { region: string; error?: string; unknownSkus: string[] }[] } } | undefined)
    ?.data?.results ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">TikTok prices per shop ({rows.length})</h1>
        <Link href="/tiktok" className="text-xs text-primary hover:underline">Selection</Link>
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        IE price comes from Shopify (shopify_tiktok). FR/ES/IT prices are set here and pushed to TikTok without a new
        review. &quot;live&quot; is what TikTok showed at the last refresh (amber = differs from the wanted price).
      </p>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending}
          className="text-xs border border-border px-2 py-1 rounded hover:bg-accent disabled:opacity-50">
          {refresh.isPending ? 'Reading TikTok…' : 'Refresh from TikTok'}
        </button>
        <button onClick={() => push.mutate(true)} disabled={push.isPending}
          className="text-xs border border-border px-2 py-1 rounded hover:bg-accent disabled:opacity-50">Preview price push</button>
        <input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="Add SKU…"
          className="text-xs border border-border rounded px-2 py-1 bg-background w-40 font-mono"
          onKeyDown={(e) => { if (e.key === 'Enter' && newSku.trim()) add.mutate(newSku.trim()) }} />
        {add.isError ? <span className="text-xs text-destructive">{(add.error as Error).message}</span> : null}
      </div>

      {refreshErrors.filter((r) => r.error || r.unknownSkus.length).map((r) => (
        <p key={r.region} className="text-xs text-destructive">
          {r.region}: {r.error ?? `SKUs on TikTok unknown to Wizhard: ${r.unknownSkus.join(', ')}`}
        </p>
      ))}

      {plan ? (
        <div className="border border-border rounded p-2 text-xs space-y-1 max-w-3xl">
          <div className="font-semibold">{plan.dryRun ? 'Preview — nothing sent yet' : 'Pushed'}</div>
          {plan.push.length === 0 ? <div className="text-muted-foreground">No price to change.</div> : null}
          {plan.push.map((p) => {
            const res = plan.results.find((r) => r.productId === p.productId && r.region === p.region)
            return (
              <div key={p.productId + p.region} className="font-mono">
                {p.region} {p.productId}: {eur(p.from)} → {eur(p.to)}
                {res ? (res.ok ? <span className="text-green-600"> ✓</span> : <span className="text-destructive"> ✗ {res.error}</span>) : null}
              </div>
            )
          })}
          {plan.skipped.map((s) => (
            <div key={'s' + s.productId + s.region} className="text-muted-foreground">{s.region} {s.productId}: skipped — {s.reason}</div>
          ))}
          {plan.dryRun && plan.push.length > 0 ? (
            <button onClick={() => { if (confirm(`Change ${plan.push.length} price(s) on TikTok?`)) push.mutate(false) }}
              disabled={push.isPending}
              className="mt-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 disabled:opacity-50">
              Push {plan.push.length} price(s) to TikTok
            </button>
          ) : null}
        </div>
      ) : null}
      {push.isError ? <p className="text-xs text-destructive">{(push.error as Error).message}</p> : null}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Title</th>
              {REGIONS.map((r) => <th key={r} className="text-left py-1.5 pr-3 font-medium">{r} €</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId} className="border-b border-border hover:bg-accent/30">
                <td className="py-1 pr-3 font-mono align-top">
                  <Link href={`/products/${row.productId}`} className="text-primary hover:underline">{row.productId}</Link>
                </td>
                <td className="py-1 pr-3 max-w-xs truncate align-top">{row.title ?? '—'}</td>
                {REGIONS.map((r) => <PriceCell key={r} row={row} region={r} />)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
