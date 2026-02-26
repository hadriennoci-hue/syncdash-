'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS, type Platform } from '@/types/platform'

export default function MappingsPage() {
  const [productId, setProductId] = useState('')
  const [platform, setPlatform]   = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['mappings', productId, platform],
    queryFn:  () => apiFetch(`/api/mappings?productId=${encodeURIComponent(productId)}&platform=${platform}`),
  })

  const mappings = data?.data ?? []

  return (
    <div className="space-y-3 max-w-4xl">
      <h1 className="text-sm font-semibold">Platform Mappings</h1>

      <div className="flex gap-2">
        <input
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          placeholder="Filter by SKU..."
          className="text-xs border border-border rounded px-2 py-1 bg-background w-48"
        />
        <input
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          placeholder="Filter by platform..."
          className="text-xs border border-border rounded px-2 py-1 bg-background w-48"
        />
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Platform</th>
              <th className="text-left py-1.5 pr-3 font-medium">Platform ID</th>
              <th className="text-left py-1.5 pr-3 font-medium">Type</th>
              <th className="text-left py-1.5 font-medium">Sync status</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m: any) => (
              <tr key={`${m.productId}-${m.platform}`} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3 font-mono">
                  <Link href={`/products/${m.productId}`} className="text-primary hover:underline">{m.productId}</Link>
                </td>
                <td className="py-1 pr-3">
                  <Link href={`/channels/${m.platform}`} className="text-primary hover:underline">{PLATFORM_LABELS[m.platform as Platform] ?? m.platform}</Link>
                </td>
                <td className="py-1 pr-3 font-mono text-muted-foreground text-[10px]">{m.platformId}</td>
                <td className="py-1 pr-3">{m.recordType}</td>
                <td className="py-1">
                  <span className={m.syncStatus === 'synced' ? 'text-green-600' : 'text-amber-500'}>{m.syncStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
