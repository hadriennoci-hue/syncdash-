'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'
import { ProductsTable } from '@/components/products/ProductsTable'

export default function WarehousesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  () => apiFetch('/api/warehouses'),
  })

  const warehouses = data?.data ?? []

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold">Warehouses</h1>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {warehouses.map((w: any) => (
              <Link key={w.id} href={`/warehouses/${w.id}`}
                className="border border-border rounded p-3 hover:bg-accent transition-colors text-xs space-y-1">
                <div className="font-medium">{w.displayName}</div>
                <div className="text-muted-foreground">{w.address ?? '—'}</div>
                <div className="flex gap-2 mt-2">
                  {w.canModifyStock
                    ? <span className="text-green-600">writable</span>
                    : <span className="text-muted-foreground">read-only</span>
                  }
                  {w.autoSync && <span className="text-blue-500">auto-sync</span>}
                </div>
                <div className="text-muted-foreground">Last sync: {w.lastSynced?.slice(0, 10) ?? 'never'}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <ProductsTable />
      </div>
    </div>
  )
}
