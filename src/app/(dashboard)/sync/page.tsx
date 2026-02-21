'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

export default function SyncPage() {
  const qc = useQueryClient()
  const { data: daily, isLoading } = useQuery({
    queryKey: ['sync-daily'],
    queryFn:  () => apiFetch('/api/sync/daily?limit=30'),
  })

  const triggerSync = useMutation({
    mutationFn: () => apiPost('/api/sync/daily', { triggeredBy: 'human' }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['sync-daily'] }),
  })

  const logs = daily?.data ?? []

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Daily Sync</h1>
        <div className="flex gap-2">
          <Link href="/sync/logs" className="text-xs border border-border px-2 py-1 rounded hover:bg-accent">Sync logs</Link>
          <button
            onClick={() => triggerSync.mutate()}
            disabled={triggerSync.isPending}
            className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
          >
            {triggerSync.isPending ? 'Running...' : 'Run now'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Date</th>
              <th className="text-left py-1.5 pr-3 font-medium">Status</th>
              <th className="text-left py-1.5 pr-3 font-medium">Warehouses</th>
              <th className="text-left py-1.5 pr-3 font-medium">Orders reconciled</th>
              <th className="text-left py-1.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3">{log.syncedAt?.slice(0, 16).replace('T', ' ')}</td>
                <td className="py-1 pr-3">
                  <span className={
                    log.status === 'success' ? 'text-green-600' :
                    log.status === 'partial' ? 'text-amber-500' : 'text-destructive'
                  }>{log.status}</span>
                </td>
                <td className="py-1 pr-3">{JSON.parse(log.warehousesSynced ?? '[]').join(', ') || '—'}</td>
                <td className="py-1 pr-3">{log.ordersReconciled ?? 0}</td>
                <td className="py-1 text-muted-foreground">{log.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
