'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost, apiDelete } from '@/lib/utils/api-fetch'

export default function TikTokPage() {
  const qc = useQueryClient()
  const [newSku, setNewSku] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tiktok-selection'],
    queryFn:  () => apiFetch('/api/tiktok/selection?perPage=200'),
  })

  const add = useMutation({
    mutationFn: (sku: string) => apiPost('/api/tiktok/selection', { sku, triggeredBy: 'human' }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['tiktok-selection'] }); setNewSku('') },
  })

  const remove = useMutation({
    mutationFn: (sku: string) => apiDelete(`/api/tiktok/selection/${sku}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['tiktok-selection'] }),
  })

  const items = data?.data ?? []

  return (
    <div className="space-y-3 max-w-3xl">
      <h1 className="text-sm font-semibold">TikTok Selection ({items.length})</h1>

      <div className="flex gap-2">
        <input
          value={newSku}
          onChange={(e) => setNewSku(e.target.value)}
          placeholder="Enter SKU to add..."
          className="text-xs border border-border rounded px-2 py-1 bg-background w-48 font-mono"
          onKeyDown={(e) => { if (e.key === 'Enter' && newSku.trim()) add.mutate(newSku.trim()) }}
        />
        <button
          onClick={() => newSku.trim() && add.mutate(newSku.trim())}
          disabled={!newSku.trim() || add.isPending}
          className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
        >Add</button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Title</th>
              <th className="text-left py-1.5 pr-3 font-medium">Status</th>
              <th className="text-left py-1.5 pr-3 font-medium">Added</th>
              <th className="text-left py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.productId} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3 font-mono">
                  <Link href={`/products/${item.productId}`} className="text-primary hover:underline">{item.productId}</Link>
                </td>
                <td className="py-1 pr-3 max-w-xs truncate">{item.product?.title ?? '—'}</td>
                <td className="py-1 pr-3">
                  <span className={item.product?.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>
                    {item.product?.status ?? '—'}
                  </span>
                </td>
                <td className="py-1 pr-3 text-muted-foreground">{item.addedAt?.slice(0, 10)}</td>
                <td className="py-1">
                  <button onClick={() => remove.mutate(item.productId)}
                    className="text-destructive hover:underline text-[10px]">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
