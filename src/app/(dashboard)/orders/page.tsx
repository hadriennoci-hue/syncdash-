'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function OrdersPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['orders', page],
    queryFn:  () => apiFetch(`/api/orders?page=${page}&perPage=50`),
  })

  const orders = data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Purchase Orders</h1>
        <Link href="/orders/new" className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90">+ New order</Link>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Invoice #</th>
              <th className="text-left py-1.5 pr-3 font-medium">Date</th>
              <th className="text-left py-1.5 pr-3 font-medium">Supplier</th>
              <th className="text-left py-1.5 pr-3 font-medium">Warehouse</th>
              <th className="text-left py-1.5 pr-3 font-medium">Items</th>
              <th className="text-left py-1.5 pr-3 font-medium">Paid</th>
              <th className="text-left py-1.5 font-medium">Arrival</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: any) => (
              <tr key={o.id} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3">
                  <Link href={`/orders/${o.id}`} className="text-primary hover:underline">{o.invoiceNumber ?? o.id.slice(0, 8)}</Link>
                </td>
                <td className="py-1 pr-3">{o.orderDate?.slice(0, 10) ?? '—'}</td>
                <td className="py-1 pr-3">
                  {o.supplier
                    ? <Link href={`/suppliers/${o.supplier.id}`} className="text-primary hover:underline">{o.supplier.name}</Link>
                    : '—'
                  }
                </td>
                <td className="py-1 pr-3">
                  <Link href={`/warehouses/${o.warehouseId}`} className="text-primary hover:underline">{o.warehouseId}</Link>
                </td>
                <td className="py-1 pr-3">{o.items?.length ?? 0}</td>
                <td className="py-1 pr-3">{o.paid ? <span className="text-green-600">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                <td className="py-1">
                  <span className={
                    o.arrivalStatus === 'arrived'  ? 'text-green-600' :
                    o.arrivalStatus === 'partial'  ? 'text-amber-500' : 'text-muted-foreground'
                  }>{o.arrivalStatus ?? 'pending'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex gap-2 text-xs">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
          className="px-2 py-1 border border-border rounded disabled:opacity-40">Prev</button>
        <span className="text-muted-foreground py-1">Page {page}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={orders.length < 50}
          className="px-2 py-1 border border-border rounded disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
