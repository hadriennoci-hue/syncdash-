'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function ChannelPage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useQuery({
    queryKey: ['channel', params.id],
    queryFn:  () => apiFetch(`/api/channels/${params.id}`),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  const c = data?.data
  if (!c) return <p className="text-xs text-destructive">Channel not found</p>

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">{c.label}</h1>
          <p className="text-xs text-muted-foreground font-mono">{c.id}</p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-green-600">{c.syncStatus?.synced} synced</span>
          <span className="text-amber-500">{c.syncStatus?.stale} stale</span>
          <span className="text-destructive">{c.syncStatus?.errored} error</span>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
            <th className="text-left py-1.5 pr-3 font-medium">Title</th>
            <th className="text-left py-1.5 pr-3 font-medium">Status</th>
            {c.sourceWarehouse && (
              <th className="text-left py-1.5 pr-3 font-medium">IE Qty</th>
            )}
            <th className="text-left py-1.5 pr-3 font-medium">Sync</th>
            <th className="text-left py-1.5 pr-3 font-medium">Price</th>
            <th className="text-left py-1.5 pr-3 font-medium">Promo</th>
            <th className="text-left py-1.5 font-medium">Platform ID</th>
          </tr>
        </thead>
        <tbody>
          {c.products?.map((p: any) => (
            <tr key={p.sku} className="border-b border-border hover:bg-accent/50">
              <td className="py-1 pr-3 font-mono">
                <Link href={`/products/${p.sku}`} className="text-primary hover:underline">{p.sku}</Link>
              </td>
              <td className="py-1 pr-3 max-w-xs truncate">{p.title}</td>
              <td className="py-1 pr-3">
                <span className={p.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{p.status}</span>
              </td>
              {c.sourceWarehouse && (
                <td className="py-1 pr-3">{p.irelandQty ?? '—'}</td>
              )}
              <td className="py-1 pr-3">
                <span className={
                  p.syncStatus === 'synced'  ? 'text-green-600' :
                  p.syncStatus === 'missing' ? 'text-muted-foreground' :
                  'text-amber-500'
                }>{p.syncStatus}</span>
              </td>
              <td className="py-1 pr-3">{p.price != null ? `€${p.price}` : '—'}</td>
              <td className="py-1 pr-3">{p.compareAt != null ? `€${p.compareAt}` : '—'}</td>
              <td className="py-1 font-mono text-muted-foreground text-[10px]">{p.platformId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
