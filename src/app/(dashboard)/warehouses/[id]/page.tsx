'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function WarehousePage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouse', params.id],
    queryFn:  () => apiFetch(`/api/warehouses/${params.id}`),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  const w = data?.data
  if (!w) return <p className="text-xs text-destructive">Warehouse not found</p>

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold">{w.displayName}</h1>
          <p className="text-xs text-muted-foreground">{w.address ?? '—'}</p>
        </div>
        <div className="text-xs space-y-0.5 text-right">
          <div>{w.canModifyStock ? <span className="text-green-600">writable</span> : <span className="text-muted-foreground">read-only</span>}</div>
          <div className="text-muted-foreground">Last sync: {w.lastSynced?.slice(0, 10) ?? 'never'}</div>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
            <th className="text-left py-1.5 pr-3 font-medium">Title</th>
            <th className="text-left py-1.5 pr-3 font-medium">Status</th>
            <th className="text-left py-1.5 pr-3 font-medium">Qty</th>
            <th className="text-left py-1.5 pr-3 font-medium">Ordered</th>
            <th className="text-left py-1.5 font-medium">Purchase €</th>
          </tr>
        </thead>
        <tbody>
          {w.stock?.map((s: any) => (
            <tr key={s.productId} className="border-b border-border hover:bg-accent/50">
              <td className="py-1 pr-3 font-mono">
                <Link href={`/products/${s.productId}`} className="text-primary hover:underline">{s.productId}</Link>
              </td>
              <td className="py-1 pr-3 max-w-xs truncate">{s.productTitle ?? '—'}</td>
              <td className="py-1 pr-3">
                <span className={s.productStatus === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{s.productStatus}</span>
              </td>
              <td className="py-1 pr-3">{s.quantity ?? '—'}</td>
              <td className="py-1 pr-3">{s.quantityOrdered ?? '—'}</td>
              <td className="py-1">{s.purchasePrice != null ? `€${s.purchasePrice}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
