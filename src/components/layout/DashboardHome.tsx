'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

interface WarehouseSyncResult {
  warehouseId:     string
  productsUpdated: number
  errors:          string[]
  syncedAt:        string
}

interface ChannelSyncResult {
  platform:           string
  statusUpdated:      number
  newProductsCreated: number
  newSkus:            string[]
  errors:             string[]
}

export function DashboardHome() {
  const { data: health }  = useQuery({ queryKey: ['health'],            queryFn: () => apiFetch('/api/health') })
  const { data: summary } = useQuery({ queryKey: ['dashboard-summary'], queryFn: () => apiFetch('/api/dashboard/summary') })
  const { data: pending }   = useQuery({ queryKey: ['pending-review'], queryFn: () => apiFetch('/api/products?pendingReview=1&perPage=50') })

  const [scanning, setScanning]       = useState(false)
  const [scanResult, setScanResult]   = useState<WarehouseSyncResult[] | null>(null)
  const [scanError, setScanError]     = useState<string | null>(null)

  const [pushing, setPushing]               = useState(false)
  const [pushResult, setPushResult]         = useState<ChannelSyncResult[] | null>(null)
  const [pushError, setPushError]           = useState<string | null>(null)
  const [lastListingsUpdate, setLastListingsUpdate] = useState<string | null>(null)
  const [lastStockScan, setLastStockScan]           = useState<string | null>(null)

  useEffect(() => {
    setLastListingsUpdate(localStorage.getItem('lastListingsUpdate'))
    setLastStockScan(localStorage.getItem('lastStockScan'))
  }, [])

  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState<Record<string, { ok: boolean; latencyMs: number | null; error?: string }> | null>(null)

  async function handleScanStocks() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    try {
      const res = await apiPost('/api/warehouses/sync-all', {})
      setScanResult(res.data)
      const now = new Date().toISOString()
      localStorage.setItem('lastStockScan', now)
      setLastStockScan(now)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setScanning(false)
    }
  }

  async function handleTestConnections() {
    setTesting(true)
    try {
      const res = await apiPost('/api/health', {})
      setTestResult(res.data?.results ?? null)
    } catch {
      setTestResult(null)
    } finally {
      setTesting(false)
    }
  }

  async function handleUpdateChannels() {
    setPushing(true)
    setPushResult(null)
    setPushError(null)
    try {
      const res = await apiPost('/api/sync/channel-availability', {
        platforms:   ['shopify_komputerzz', 'woocommerce'],
        triggeredBy: 'human',
      })
      setPushResult(res.data)
      const now = new Date().toISOString()
      localStorage.setItem('lastListingsUpdate', now)
      setLastListingsUpdate(now)
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  const healthData    = health?.data
  const healthResults = healthData?.results ?? null
  const summaryData   = summary?.data

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-sm font-semibold">Dashboard</h1>

      <StatCard label="Last Listings Update" value={lastListingsUpdate ? lastListingsUpdate.slice(0, 16).replace('T', ' ') : '—'} href="/sync" />

      {/* Stock & listings overview */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground" colSpan={2}>
                  References in stock
                </th>
              </tr>
            </thead>
            <tbody>
              {summaryData?.warehouses?.map((w: any) => (
                <tr key={w.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 flex items-center gap-2">
                    <ConnDot status={healthResults?.[w.id]} />
                    <Link href={`/warehouses/${w.id}`} className="hover:underline">{w.label}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{w.refsInStock}</td>
                </tr>
              )) ?? (
                <tr><td colSpan={2} className="px-3 py-2 text-muted-foreground">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground" colSpan={2}>
                  References listed for sale
                </th>
              </tr>
            </thead>
            <tbody>
              {summaryData?.channels?.map((c: any) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 flex items-center gap-2">
                    <ConnDot status={healthResults?.[c.id]} />
                    <Link href={`/channels/${c.id}`} className="hover:underline">{c.label}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{c.refsForSale}</td>
                </tr>
              )) ?? (
                <tr><td colSpan={2} className="px-3 py-2 text-muted-foreground">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Scan Stocks */}
        <div className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Warehouse Stock</h2>
            <button
              onClick={handleScanStocks}
              disabled={scanning}
              className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanning ? 'Scanning…' : 'Scan stocks'}
            </button>
          </div>
          {scanError && (
            <p className="text-xs text-destructive">{scanError}</p>
          )}
          {scanResult && (
            <div className="space-y-1">
              {scanResult.map((r) => (
                <div key={r.warehouseId} className="flex items-center justify-between text-xs">
                  <Link href={`/warehouses/${r.warehouseId}`} className="font-mono hover:underline">
                    {r.warehouseId}
                  </Link>
                  {r.errors.length > 0
                    ? <span className="text-destructive">{r.errors[0]}</span>
                    : <span className="text-green-600">{r.productsUpdated} refs updated</span>
                  }
                </div>
              ))}
            </div>
          )}
          {!scanResult && !scanError && (
            <p className="text-xs text-muted-foreground">
              {lastStockScan ? `Last scan: ${lastStockScan.slice(0, 16).replace('T', ' ')}` : 'Never scanned'}
            </p>
          )}
        </div>

        {/* Update Sale Channels */}
        <div className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sale Channels</h2>
            <button
              onClick={handleUpdateChannels}
              disabled={pushing}
              className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pushing ? 'Updating…' : 'Update Products'}
            </button>
          </div>
          {pushError && (
            <p className="text-xs text-destructive">{pushError}</p>
          )}
          {pushResult && (
            <div className="space-y-1">
              {pushResult.map((r) => (
                <div key={r.platform} className="flex items-center justify-between text-xs">
                  <Link href={`/channels/${r.platform}`} className="font-mono hover:underline">
                    {r.platform}
                  </Link>
                  <span className={r.errors.length > 0 ? 'text-destructive' : 'text-green-600'}>
                    {r.errors.length > 0
                      ? r.errors[0]
                      : `${r.newProductsCreated} new · ${r.statusUpdated} updated`
                    }
                  </span>
                </div>
              ))}
            </div>
          )}
          {!pushResult && !pushError && (
            <p className="text-xs text-muted-foreground">
              {lastListingsUpdate ? `Last push: ${lastListingsUpdate.slice(0, 16).replace('T', ' ')}` : 'Never pushed'}
            </p>
          )}
        </div>
      </div>

      {(pending as any)?.data?.length > 0 && (
        <section className="border border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            ⚠ {(pending as any).data.length} new product{(pending as any).data.length > 1 ? 's' : ''} pending review
          </h2>
          <p className="text-xs text-muted-foreground">
            These SKUs were automatically created from ACER Store and pushed to channels. Please verify title, description, images and category before publishing.
          </p>
          <div className="flex flex-wrap gap-1">
            {(pending as any).data.map((p: any) => (
              <Link key={p.id} href={`/products/${p.id}`}
                className="text-xs font-mono bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded hover:underline">
                {p.id}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <section className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Health</h2>
            <button
              onClick={handleTestConnections}
              disabled={testing}
              className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? 'Testing…' : 'Test API connections'}
            </button>
          </div>
          <ConnSummary results={testResult ?? healthData?.results ?? null} />
        </section>

        <section className="border border-border rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sync Logs</h2>
          <p className="text-xs text-muted-foreground">Full history of automated and manual syncs.</p>
          <Link href="/sync" className="text-xs text-primary hover:underline">View all logs →</Link>
        </section>
      </div>
    </div>
  )
}

const CONN_LABELS: Record<string, string> = {
  woocommerce:        'Coincart',
  shopify_komputerzz: 'Komputerzz',
  shopify_tiktok:     'TikTok Shop',
  ireland:            'Ireland',
  acer_store:         'ACER Store',
}

function ConnSummary({ results }: { results: Record<string, { ok: boolean; latencyMs: number | null; error?: string }> | null }) {
  if (!results) return <p className="text-xs text-muted-foreground">No data yet — click Test to check.</p>

  const entries  = Object.entries(results)
  const total    = entries.length
  const offline  = entries.filter(([, v]) => !v.ok)
  const onlineCount = total - offline.length

  return (
    <div className="space-y-1.5">
      {offline.length === 0
        ? <p className="text-xs font-medium text-green-600">{total} / {total} online</p>
        : (
          <p className="text-xs font-medium text-destructive">
            {onlineCount} / {total} online — {offline.map(([k]) => CONN_LABELS[k] ?? k).join(', ')} offline
          </p>
        )
      }
      {offline.map(([key, val]) => (
        <div key={key} className="flex items-center justify-between text-xs text-destructive">
          <span className="font-mono">{CONN_LABELS[key] ?? key}</span>
          <span>{val.error ?? 'error'}</span>
        </div>
      ))}
    </div>
  )
}

function ConnDot({ status }: { status?: { ok: boolean } | null }) {
  if (status === undefined || status === null) {
    return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" title="Untested" />
  }
  return status.ok
    ? <span className="inline-block h-2 w-2 rounded-full bg-green-500 shrink-0" title="Live" />
    : <span className="inline-block h-2 w-2 rounded-full bg-red-500 shrink-0" title="Offline" />
}

function StatCard({ label, value, href }: { label: string; value: string | number; href: string }) {
  return (
    <Link href={href} className="border border-border rounded p-3 hover:bg-accent transition-colors">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </Link>
  )
}
