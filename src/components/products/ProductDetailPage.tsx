'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS, WAREHOUSE_LABELS, PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'


export function ProductDetailPage({ sku }: { sku: string }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', sku],
    queryFn:  () => apiFetch(`/api/products/${sku}`),
  })

  async function setPushStatus(platform: Platform, status: 'N' | '2push' | 'done') {
    await apiPatch(`/api/products/${sku}/push-status`, { platform, status })
    qc.invalidateQueries({ queryKey: ['product', sku] })
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  if (error || !data?.data) return <p className="text-xs text-destructive">Product not found</p>

  const p = data.data

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold">{p.title}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{sku}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/products/${sku}/edit`} className="text-xs border border-border rounded px-2 py-1 hover:bg-accent">Edit</Link>
          <span className={`text-xs px-2 py-1 rounded ${
            p.status === 'active'   ? 'bg-green-100 text-green-700' :
            p.status === 'info'     ? 'bg-red-100 text-red-600 font-semibold' :
            'bg-muted text-muted-foreground'
          }`}>
            {p.status}
          </span>
        </div>
      </div>

      {/* Row 1 — Meta + Images */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <section className="border border-border rounded p-3 space-y-1.5 col-span-1">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Meta</h2>
          <Row label="Vendor"     value={p.vendor      ?? '—'} />
          <Row label="Type"       value={p.productType ?? '—'} />
          <Row label="Tax code"   value={p.taxCode     ?? '—'} />
          <Row label="EAN"        value={p.ean         ?? '—'} />
          <Row label="Commodity"  value={p.commodityCode ?? '—'} />
          <Row label="Origin"     value={p.countryOfManufacture ?? '—'} />
          <Row label="Weight"     value={p.weight != null ? `${p.weight} ${p.weightUnit ?? 'kg'}` : '—'} />
          <Row label="Featured"   value={p.isFeatured ? 'Yes' : 'No'} />
          <Row label="Supplier"
            value={p.supplier
              ? <Link href={`/suppliers/${p.supplier.id}`} className="text-primary hover:underline">{p.supplier.name}</Link>
              : '—'}
          />
          <Row label="Localization" value={p.localization ?? '—'} />
          <Row label="Updated"    value={p.updatedAt?.slice(0, 10) ?? '—'} />
        </section>

        <section className="border border-border rounded p-3 space-y-2 text-xs col-span-2">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
            Images ({p.images?.length ?? 0}{(p.images?.length ?? 0) < 5 ? ' — needs 5+' : ''})
          </h2>
          {p.images?.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {p.images.map((img: any, i: number) => {
                const h = img.url ? (new URL(img.url).searchParams.get('height') ?? null) : null
                const w = img.url ? (new URL(img.url).searchParams.get('width')  ?? null) : null
                const dims = h && w ? `${w}×${h}px` : null
                return (
                  <div key={i} className="flex flex-col gap-0.5">
                    <a href={img.url} target="_blank" rel="noreferrer">
                      <img
                        src={img.url}
                        alt={img.alt ?? ''}
                        className="h-36 w-36 object-contain rounded border border-border bg-muted/30 hover:opacity-80 transition-opacity"
                      />
                    </a>
                    {dims && <span className="text-[10px] text-muted-foreground text-center">{dims}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-muted-foreground italic">No images</p>
          )}
        </section>
      </div>

      {/* Row 2 — Description */}
      <section className="border border-border rounded p-3 space-y-1 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Description</h2>
        {p.description
          ? <div className="whitespace-pre-wrap prose-none" dangerouslySetInnerHTML={{ __html: p.description }} />
          : <p className="text-muted-foreground italic">—</p>
        }
      </section>

      {/* Row 3 — Categories & Collections */}
      <section className="border border-border rounded p-3 text-xs space-y-2">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Categories &amp; Collections</h2>
        {p.categories?.length > 0 ? (
          <CategoryGroups categories={p.categories} />
        ) : (
          <p className="text-muted-foreground italic">No categories</p>
        )}
      </section>

      {/* Row 4 — Channels */}
      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Channels</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Channel</th>
              <th className="text-left font-medium py-0.5 pr-2">Platform ID</th>
              <th className="text-left font-medium py-0.5 pr-2">Sync</th>
              <th className="text-left font-medium py-0.5 pr-2">Price</th>
              <th className="text-left font-medium py-0.5 pr-2">Promo</th>
              <th className="text-left font-medium py-0.5">Listing</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.platforms ?? {}).map(([pl, m]: [string, any]) => (
              <tr key={pl} className="border-t border-border">
                <td className="py-1 pr-2">
                  <Link href={`/channels/${pl}`} className="text-primary hover:underline">{PLATFORM_LABELS[pl] ?? pl}</Link>
                </td>
                <td className="py-1 pr-2 font-mono text-muted-foreground">{m.platformId ?? '—'}</td>
                <td className="py-1 pr-2">
                  <span className={m.syncStatus === 'synced' ? 'text-green-600' : 'text-amber-500'}>{m.syncStatus ?? '—'}</span>
                </td>
                <td className="py-1 pr-2">{p.prices?.[pl]?.price != null ? `€${p.prices[pl].price}` : '—'}</td>
                <td className="py-1 pr-2">{p.prices?.[pl]?.compareAt != null ? `€${p.prices[pl].compareAt}` : '—'}</td>
                <td className="py-1">
                  {m.listingUrl
                    ? <a href={m.listingUrl} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline">view ↗</a>
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Row 5 — Stock */}
      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Warehouse Stock</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Warehouse</th>
              <th className="text-left font-medium py-0.5 pr-2">Qty</th>
              <th className="text-left font-medium py-0.5 pr-2">Ordered</th>
              <th className="text-left font-medium py-0.5 pr-2">Purchase price</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.stock ?? {}).map(([wh, s]: [string, any]) => (
              <tr key={wh} className="border-t border-border">
                <td className="py-1 pr-2">
                  <Link href={`/warehouses/${wh}`} className="text-primary hover:underline">{WAREHOUSE_LABELS[wh] ?? wh}</Link>
                </td>
                <td className="py-1 pr-2">{s.quantity ?? '—'}</td>
                <td className="py-1 pr-2">{s.quantityOrdered ?? '—'}</td>
                <td className="py-1">{s.purchasePrice != null ? `€${s.purchasePrice}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Row 6 — Push to channels */}
      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Push to channels</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Channel</th>
              <th className="text-left font-medium py-0.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((pl) => {
              const current = p.pushStatus?.[pl] ?? 'N'
              return (
                <tr key={pl} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <Link href={`/channels/${pl}`} className="text-primary hover:underline">{PLATFORM_LABELS[pl]}</Link>
                  </td>
                  <td className="py-1">
                    <div className="flex gap-1">
                      {(['N', '2push', 'done'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setPushStatus(pl, s)}
                          className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                            current === s
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-accent'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Variants */}
      {p.variants?.length > 0 && (
        <section className="border border-border rounded p-3 text-xs space-y-1.5">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Variants ({p.variants.length})</h2>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-0.5 pr-2">SKU</th>
                <th className="text-left font-medium py-0.5 pr-2">Title</th>
                <th className="text-left font-medium py-0.5 pr-2">Price</th>
                <th className="text-left font-medium py-0.5 pr-2">Stock</th>
                <th className="text-left font-medium py-0.5">Options</th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v: any) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="py-1 pr-2 font-mono">{v.sku ?? '—'}</td>
                  <td className="py-1 pr-2">{v.title ?? '—'}</td>
                  <td className="py-1 pr-2">{v.price != null ? `€${v.price}` : '—'}</td>
                  <td className="py-1 pr-2">{v.stock ?? '—'}</td>
                  <td className="py-1">{[v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const PLATFORM_GROUP_LABELS: Record<string, string> = {
  shopify_komputerzz: 'Komputerzz collections',
  shopify_tiktok:     'TikTok collections',
  woocommerce:        'WooCommerce categories',
}

const PLATFORM_GROUP_STYLES: Record<string, string> = {
  shopify_komputerzz: 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300',
  shopify_tiktok:     'border-pink-300 bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-300',
  woocommerce:        'border-purple-300 bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
}

function CategoryGroups({ categories }: { categories: Array<{ id: string; name: string; platform: string; type: string }> }) {
  const groups = categories.reduce<Record<string, typeof categories>>((acc, c) => {
    const key = c.platform || 'unknown'
    ;(acc[key] = acc[key] ?? []).push(c)
    return acc
  }, {})

  return (
    <div className="space-y-2">
      {Object.entries(groups).map(([platform, cats]) => (
        <div key={platform}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            {PLATFORM_GROUP_LABELS[platform] ?? platform}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <span key={c.id}
                className={`px-2 py-0.5 rounded text-xs border ${PLATFORM_GROUP_STYLES[platform] ?? 'border-border bg-muted/40 text-foreground'}`}
                title={c.id}
              >
                {c.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
