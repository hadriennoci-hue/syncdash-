'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useQuery({
    queryKey: ['order', params.id],
    queryFn:  () => apiFetch(`/api/orders/${params.id}`),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  const o = data?.data
  if (!o) return <p className="text-xs text-destructive">Order not found</p>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold">Order {o.invoiceNumber ?? o.id.slice(0, 8)}</h1>
          <p className="text-xs text-muted-foreground">{o.orderDate?.slice(0, 10)}</p>
        </div>
        <div className="text-xs space-y-1 text-right">
          <div>Paid: {o.paid ? <span className="text-green-600">Yes</span> : 'No'}</div>
          <div>Sent: {o.sentToSupplier ? <span className="text-blue-500">Yes</span> : 'No'}</div>
          <div>Arrival: <span className={o.arrivalStatus === 'arrived' ? 'text-green-600' : 'text-amber-500'}>{o.arrivalStatus ?? 'pending'}</span></div>
        </div>
      </div>

      <div className="text-xs space-y-1">
        <div>Supplier: {o.supplier ? <Link href={`/suppliers/${o.supplier.id}`} className="text-primary hover:underline">{o.supplier.name}</Link> : '—'}</div>
        <div>Warehouse: <Link href={`/warehouses/${o.warehouseId}`} className="text-primary hover:underline">{o.warehouseId}</Link></div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
            <th className="text-left py-1.5 pr-3 font-medium">Product</th>
            <th className="text-left py-1.5 pr-3 font-medium">Ordered</th>
            <th className="text-left py-1.5 pr-3 font-medium">Received</th>
            <th className="text-left py-1.5 font-medium">Unit price</th>
          </tr>
        </thead>
        <tbody>
          {o.items?.map((item: any) => (
            <tr key={item.id} className="border-b border-border">
              <td className="py-1 pr-3 font-mono">
                <Link href={`/products/${item.productId}`} className="text-primary hover:underline">{item.productId}</Link>
              </td>
              <td className="py-1 pr-3 max-w-xs truncate">{item.product?.title ?? '—'}</td>
              <td className="py-1 pr-3">{item.quantity}</td>
              <td className="py-1 pr-3">{item.quantityReceived ?? 0}</td>
              <td className="py-1">{item.purchasePrice != null ? `€${item.purchasePrice}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
