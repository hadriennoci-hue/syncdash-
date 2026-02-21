'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export function DashboardHome() {
  const { data: health }    = useQuery({ queryKey: ['health'],    queryFn: () => apiFetch('/api/health') })
  const { data: syncDaily } = useQuery({ queryKey: ['syncDaily'], queryFn: () => apiFetch('/api/sync/daily?limit=5') })
  const { data: products }  = useQuery({ queryKey: ['products-count'], queryFn: () => apiFetch('/api/products?perPage=1') })

  const lastSync   = syncDaily?.data?.[0]
  const healthData = health?.data

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-sm font-semibold">Dashboard</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Products" value={products?.meta?.total ?? '—'} href="/products" />
        <StatCard label="Last Sync" value={lastSync ? lastSync.status : '—'} href="/sync" />
        <StatCard label="API Health" value={healthData ? 'checked' : '—'} href="/sync" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <section className="border border-border rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Health</h2>
          {healthData?.results
            ? Object.entries(healthData.results).map(([key, val]: [string, any]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{key}</span>
                  <span className={val.ok ? 'text-green-600' : 'text-destructive'}>
                    {val.ok ? `${val.latencyMs}ms` : val.error ?? 'error'}
                  </span>
                </div>
              ))
            : <p className="text-xs text-muted-foreground">No health data yet</p>
          }
        </section>

        <section className="border border-border rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Syncs</h2>
          {syncDaily?.data?.length
            ? syncDaily.data.map((s: any) => (
                <div key={s.id} className="text-xs flex justify-between">
                  <span className="text-muted-foreground">{s.syncedAt?.slice(0, 10)}</span>
                  <span className={s.status === 'success' ? 'text-green-600' : 'text-amber-500'}>{s.status}</span>
                </div>
              ))
            : <p className="text-xs text-muted-foreground">No sync logs yet</p>
          }
          <Link href="/sync" className="text-xs text-primary hover:underline">View all logs</Link>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, href }: { label: string; value: string | number; href: string }) {
  return (
    <Link href={href} className="border border-border rounded p-3 hover:bg-accent transition-colors">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </Link>
  )
}
