'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function SyncLogsPage() {
  const [page, setPage]       = useState(1)
  const [productId, setProductId] = useState('')
  const [platform, setPlatform]   = useState('')
  const [status, setStatus]       = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['sync-logs', page, productId, platform, status],
    queryFn:  () => apiFetch(
      `/api/sync/logs?page=${page}&perPage=100&productId=${encodeURIComponent(productId)}&platform=${platform}&status=${status}`
    ),
  })

  const logs = data?.data ?? []

  return (
    <div className="space-y-3 max-w-5xl">
      <h1 className="text-sm font-semibold">Sync Logs</h1>

      <div className="flex gap-2">
        <input value={productId} onChange={(e) => { setProductId(e.target.value); setPage(1) }}
          placeholder="SKU..." className="text-xs border border-border rounded px-2 py-1 bg-background w-40" />
        <input value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1) }}
          placeholder="Platform..." className="text-xs border border-border rounded px-2 py-1 bg-background w-40" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          className="text-xs border border-border rounded px-2 py-1 bg-background">
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Time</th>
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Platform</th>
              <th className="text-left py-1.5 pr-3 font-medium">Action</th>
              <th className="text-left py-1.5 pr-3 font-medium">Status</th>
              <th className="text-left py-1.5 pr-3 font-medium">By</th>
              <th className="text-left py-1.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l: any) => (
              <tr key={l.id} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3 text-muted-foreground">{l.createdAt?.slice(0, 16).replace('T', ' ')}</td>
                <td className="py-1 pr-3 font-mono">
                  {l.productId
                    ? <Link href={`/products/${l.productId}`} className="text-primary hover:underline">{l.productId}</Link>
                    : '—'}
                </td>
                <td className="py-1 pr-3">{l.platform ?? '—'}</td>
                <td className="py-1 pr-3">{l.action}</td>
                <td className="py-1 pr-3">
                  <span className={l.status === 'success' ? 'text-green-600' : 'text-destructive'}>{l.status}</span>
                </td>
                <td className="py-1 pr-3">{l.triggeredBy}</td>
                <td className="py-1 text-muted-foreground max-w-xs truncate">{l.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex gap-2 text-xs">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
          className="px-2 py-1 border border-border rounded disabled:opacity-40">Prev</button>
        <span className="text-muted-foreground py-1">Page {page}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={logs.length < 100}
          className="px-2 py-1 border border-border rounded disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
