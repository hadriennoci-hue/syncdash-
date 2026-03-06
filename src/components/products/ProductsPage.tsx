'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS } from '@/types/platform'

const PLATFORMS = ['woocommerce', 'shopify_komputerzz', 'shopify_tiktok', 'ebay_ie'] as const

export function ProductsPage() {
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, search, status],
    queryFn:  () => apiFetch(`/api/products?page=${page}&perPage=50&search=${encodeURIComponent(search)}&status=${status}`),
  })

  const products = data?.data ?? []
  const total    = data?.meta?.total ?? 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Products ({total})</h1>
        <Link href="/products/new" className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90">
          + New product
        </Link>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search SKU or title..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="text-xs border border-border rounded px-2 py-1 bg-background w-56"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-3 font-medium w-28">SKU</th>
                <th className="text-left py-1.5 pr-3 font-medium">Title</th>
                <th className="text-left py-1.5 pr-3 font-medium">Supplier</th>
                <th className="text-left py-1.5 pr-3 font-medium">Status</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="text-left py-1.5 pr-3 font-medium">{PLATFORM_LABELS[p]}</th>
                ))}
                <th className="text-left py-1.5 pr-3 font-medium">IE</th>
                <th className="text-left py-1.5 pr-3 font-medium">PL</th>
                <th className="text-left py-1.5 pr-3 font-medium">ACER</th>
                <th className="text-left py-1.5 pr-3 font-medium">Imgs</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any) => (
                <tr key={p.id} className="border-b border-border hover:bg-accent/50">
                  <td className="py-1 pr-3 font-mono">
                    <Link href={`/products/${p.id}`} className="text-primary hover:underline">{p.id}</Link>
                  </td>
                  <td className="py-1 pr-3 max-w-xs truncate">{p.title}</td>
                  <td className="py-1 pr-3">
                    {p.supplier
                      ? <Link href={`/suppliers/${p.supplier.id}`} className="text-primary hover:underline">{p.supplier.name}</Link>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </td>
                  <td className="py-1 pr-3">
                    <span className={p.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{p.status}</span>
                  </td>
                  {PLATFORMS.map((pl) => {
                    const d = p.platforms?.[pl]
                    return (
                      <td key={pl} className="py-1 pr-3">
                        <Link href={`/channels/${pl}`} className="hover:underline">
                          <StatusDot status={d?.status} />
                        </Link>
                        {d?.price != null && <span className="ml-1 text-muted-foreground">€{d.price}</span>}
                      </td>
                    )
                  })}
                  <td className="py-1 pr-3">{p.stock?.ireland     ?? '—'}</td>
                  <td className="py-1 pr-3">{p.stock?.poland      ?? '—'}</td>
                  <td className="py-1 pr-3">{p.stock?.acer_store  ?? '—'}</td>
                  <td className="py-1 pr-3">
                    <span className={p.hasMinImages ? 'text-green-600' : 'text-amber-500'}>{p.imageCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2 text-xs items-center">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-2 py-1 border border-border rounded disabled:opacity-40"
        >Prev</button>
        <span className="text-muted-foreground">Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={products.length < 50}
          className="px-2 py-1 border border-border rounded disabled:opacity-40"
        >Next</button>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status?: string }) {
  const color = status === 'synced' ? 'bg-green-500' : status === 'differences' ? 'bg-amber-500' : 'bg-muted-foreground/40'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status} />
}
