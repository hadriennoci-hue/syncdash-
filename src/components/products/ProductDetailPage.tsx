'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS, WAREHOUSE_LABELS } from '@/types/platform'

export function ProductDetailPage({ sku }: { sku: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', sku],
    queryFn:  () => apiFetch(`/api/products/${sku}`),
  })

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
          <span className={`text-xs px-2 py-1 rounded ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
            {p.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        {/* Meta */}
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

        {/* Platforms */}
        <section className="border border-border rounded p-3 space-y-1.5 col-span-2">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Channels</h2>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-0.5 pr-2">Channel</th>
                <th className="text-left font-medium py-0.5 pr-2">Platform ID</th>
                <th className="text-left font-medium py-0.5 pr-2">Sync</th>
                <th className="text-left font-medium py-0.5 pr-2">Price</th>
                <th className="text-left font-medium py-0.5">Promo</th>
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
                  <td className="py-1">{p.prices?.[pl]?.compareAt != null ? `€${p.prices[pl].compareAt}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Stock */}
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

      {/* Images */}
      {p.images?.length > 0 && (
        <section className="border border-border rounded p-3 space-y-2 text-xs">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
            Images ({p.images.length}{p.images.length < 5 ? ' — needs 5+' : ''})
          </h2>
          <div className="flex gap-2 flex-wrap">
            {p.images.map((img: any, i: number) => (
              <img key={i} src={img.url} alt={img.alt ?? ''} className="h-16 w-16 object-cover rounded border border-border" />
            ))}
          </div>
        </section>
      )}

      {/* Description */}
      <section className="border border-border rounded p-3 text-xs space-y-1">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Description</h2>
        {p.description
          ? <p className="whitespace-pre-wrap">{p.description}</p>
          : <p className="text-muted-foreground italic">No description</p>
        }
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
