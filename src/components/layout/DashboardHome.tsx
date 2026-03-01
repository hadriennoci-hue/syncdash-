'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

interface WarehouseSyncResult {
  warehouseId:     string
  productsUpdated: number
  errors:          string[]
  syncedAt:        string
}

interface WarehouseScanProgress {
  stage: 'start' | 'url_started' | 'page_done' | 'url_done' | 'fetch_done'
  warehouseId: string
  warehouseIndex: number
  warehouseTotal: number
  message: string
  current: number
  total: number
  url?: string
  pageUrl?: string
}

interface ChannelSyncResult {
  platform:           string
  statusUpdated:      number
  newProductsCreated: number
  zeroedOutOfStock:   number
  newSkus:            string[]
  errors:             string[]
  incomplete:         Array<{ sku: string; missing: string[] }>
}

export function DashboardHome() {
  const qc = useQueryClient()
  const { data: health }  = useQuery({ queryKey: ['health'],            queryFn: () => apiFetch('/api/health') })
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery({ queryKey: ['dashboard-summary'], queryFn: () => apiFetch('/api/dashboard/summary') })

  const [scanning, setScanning]       = useState(false)
  const [scanResult, setScanResult]   = useState<WarehouseSyncResult[] | null>(null)
  const [scanError, setScanError]     = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<{
    percent: number
    label: string
    detail: string
    steps: string[]
  } | null>(null)

  const [pushing, setPushing]               = useState(false)
  const [pushResult, setPushResult]         = useState<ChannelSyncResult[] | null>(null)
  const [pushError, setPushError]           = useState<string | null>(null)
  const [browserQueued, setBrowserQueued]   = useState<{ libre_market: number; xmr_bazaar: number } | null>(null)
  const [lastListingsUpdate, setLastListingsUpdate] = useState<string | null>(null)
  const [lastStockScan, setLastStockScan]           = useState<string | null>(null)

  useEffect(() => {
    setLastListingsUpdate(localStorage.getItem('lastListingsUpdate'))
    setLastStockScan(localStorage.getItem('lastStockScan'))
  }, [])

  const [testing, setTesting]               = useState(false)
  const [testResult, setTestResult]         = useState<Record<string, { ok: boolean; latencyMs: number | null; error?: string }> | null>(null)
  const [tokenStatus, setTokenStatus]       = useState<Array<{ platform: string; ok: boolean; expiresAt?: string; error?: string }> | null>(null)

  async function handleScanStocks() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    setScanProgress({
      percent: 0,
      label: 'Starting warehouse scan...',
      detail: '',
      steps: [],
    })
    try {
      const res = await fetch('/api/warehouses/sync-all/stream', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN ?? ''}`,
        },
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const decoder = new TextDecoder()
      const reader = res.body.getReader()
      let buffer = ''
      let finalResults: WarehouseSyncResult[] | null = null

      const pushStep = (step: string) => {
        setScanProgress((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            steps: [step, ...prev.steps].slice(0, 8),
          }
        })
      }

      const onProgress = (event: WarehouseScanProgress) => {
        const fraction = event.total > 0 ? Math.min(1, event.current / event.total) : 0
        const percent = Math.max(
          0,
          Math.min(100, ((event.warehouseIndex - 1 + fraction) / Math.max(event.warehouseTotal, 1)) * 100)
        )

        setScanProgress((prev) => ({
          percent,
          label: event.message,
          detail: `${event.warehouseId}: step ${event.current}/${event.total}`,
          steps: prev?.steps ?? [],
        }))

        if (event.stage === 'page_done' || event.stage === 'url_done' || event.stage === 'fetch_done') {
          pushStep(event.message)
        }
      }

      const parseEvent = (chunk: string) => {
        const lines = chunk.split('\n')
        let eventName = 'message'
        let dataText = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          if (line.startsWith('data:')) dataText += line.slice(5).trim()
        }
        if (!dataText) return

        const data = JSON.parse(dataText)

        if (eventName === 'warehouse_start') {
          setScanProgress((prev) => ({
            percent: prev?.percent ?? 0,
            label: `Scanning ${data.warehouseId} (${data.warehouseIndex}/${data.warehouseTotal})`,
            detail: prev?.detail ?? '',
            steps: prev?.steps ?? [],
          }))
          return
        }
        if (eventName === 'progress') {
          onProgress(data as WarehouseScanProgress)
          return
        }
        if (eventName === 'scan_done') {
          finalResults = (data.results ?? []) as WarehouseSyncResult[]
          return
        }
        if (eventName === 'stream_error') {
          throw new Error(data.message ?? 'Stream error')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          parseEvent(chunk)
          boundary = buffer.indexOf('\n\n')
        }
      }

      setScanResult(finalResults ?? [])
      setScanProgress((prev) => prev ? { ...prev, percent: 100, label: 'Scan completed' } : prev)
      const now = new Date().toISOString()
      localStorage.setItem('lastStockScan', now)
      setLastStockScan(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setScanning(false)
    }
  }

  async function handleTestConnections() {
    setTesting(true)
    setTokenStatus(null)
    try {
      // 1. Refresh Shopify OAuth tokens first (they last 24h)
      const tokenRes = await apiPost('/api/tokens/refresh', {})
      setTokenStatus(tokenRes.data?.results ?? null)
    } catch {
      // Token refresh failure is non-fatal â€” log and continue with env var tokens
    }
    try {
      // 2. Run health check with fresh tokens
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
    setBrowserQueued(null)
    try {
      // Wake local browser runner immediately on Push click.
      await apiPost('/api/runner/wake', { runner: 'browser', reason: 'dashboard push button' }).catch(() => null)

      const res = await apiPost('/api/sync/channel-availability', {
        platforms:   ['shopify_komputerzz', 'woocommerce'],
        triggeredBy: 'human',
      })
      setPushResult(res.data)
      const now = new Date().toISOString()
      localStorage.setItem('lastListingsUpdate', now)
      setLastListingsUpdate(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })

      // Check if any products are queued for browser-automated channels
      const [lmRes, xmrRes] = await Promise.all([
        apiFetch('/api/products?pushedPlatform=libre_market&perPage=1').catch(() => null),
        apiFetch('/api/products?pushedPlatform=xmr_bazaar&perPage=1').catch(() => null),
      ])
      const lmCount  = (lmRes?.meta?.total  ?? 0) as number
      const xmrCount = (xmrRes?.meta?.total ?? 0) as number
      if (lmCount > 0 || xmrCount > 0) setBrowserQueued({ libre_market: lmCount, xmr_bazaar: xmrCount })
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  const healthData    = health?.data
  const healthResults = testResult ?? healthData?.results ?? null
  const summaryData   = summary?.data

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-sm font-semibold">Dashboard</h1>

      <StatCard label="Last Listings Update" value={lastListingsUpdate ? lastListingsUpdate.slice(0, 16).replace('T', ' ') : 'â€”'} href="/sync" />

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
              {summaryLoading ? (
                <tr><td colSpan={2} className="px-3 py-2 text-muted-foreground">Loadingâ€¦</td></tr>
              ) : summaryError ? (
                <tr><td colSpan={2} className="px-3 py-2 text-destructive text-xs">Failed to load â€” check DB migrations</td></tr>
              ) : summaryData?.warehouses?.map((w: any) => (
                <tr key={w.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 flex items-center gap-2">
                    <ConnDot status={healthResults?.[w.id]} />
                    <Link href={`/warehouses/${w.id}`} className="hover:underline">{w.label}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{w.refsInStock}</td>
                </tr>
              ))}
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
              {summaryLoading ? (
                <tr><td colSpan={2} className="px-3 py-2 text-muted-foreground">Loadingâ€¦</td></tr>
              ) : summaryError ? (
                <tr><td colSpan={2} className="px-3 py-2 text-destructive text-xs">Failed to load â€” check DB migrations</td></tr>
              ) : summaryData?.channels?.map((c: any) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 flex items-center gap-2">
                    <ConnDot status={healthResults?.[c.id]} />
                    <Link href={`/channels/${c.id}`} className="hover:underline">{c.label}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{c.refsForSale}</td>
                </tr>
              ))}
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
              {scanning ? 'Scanning...' : 'Scan stocks'}
            </button>
          </div>
          {scanProgress && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${scanProgress.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{scanProgress.label}</p>
              {scanProgress.detail && (
                <p className="text-[11px] text-muted-foreground/80 font-mono">{scanProgress.detail}</p>
              )}
              {scanProgress.steps.length > 0 && (
                <div className="space-y-0.5">
                  {scanProgress.steps.map((step, idx) => (
                    <p key={`${step}-${idx}`} className="text-[11px] text-muted-foreground/80 truncate" title={step}>
                      {step}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
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
              {pushing ? 'Updating...' : 'Update Products'}
            </button>
          </div>
          {pushError && (
            <p className="text-xs text-destructive">{pushError}</p>
          )}
          {pushResult && <PushResultDisplay results={pushResult} />}
          {browserQueued && (
            <div className="rounded border border-red-500 bg-red-50 dark:bg-red-950/30 p-2 space-y-1">
              <p className="text-xs font-semibold text-red-600">
                âš  Browser channels still queued â€” run in terminal:
              </p>
              <p className="text-xs font-mono bg-red-100 dark:bg-red-900/40 text-red-700 px-2 py-1 rounded select-all">
                npm run push:browser
              </p>
              {browserQueued.libre_market > 0 && (
                <p className="text-xs text-red-600/80">Libre Market: {browserQueued.libre_market} product(s)</p>
              )}
              {browserQueued.xmr_bazaar > 0 && (
                <p className="text-xs text-red-600/80">XMR Bazaar: {browserQueued.xmr_bazaar} product(s)</p>
              )}
            </div>
          )}
          {!pushResult && !pushError && (
            <p className="text-xs text-muted-foreground">
              {lastListingsUpdate ? `Last push: ${lastListingsUpdate.slice(0, 16).replace('T', ' ')}` : 'Never pushed'}
            </p>
          )}
        </div>
      </div>

      {summaryData?.readyToPush?.count > 0 && (
        <section className="border border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            There are {summaryData.readyToPush.count} references in stock ready to push to sale channels
          </h2>
          <div className="flex flex-wrap gap-1">
            {(summaryData.readyToPush.skus as string[]).map((sku) => (
              <Link key={sku} href={`/products/${sku}`}
                className="text-xs font-mono bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded hover:underline">
                {sku}
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
              {testing ? 'Testing...' : 'Test API connections'}
            </button>
          </div>
          <ConnSummary results={testResult ?? healthData?.results ?? null} />
          {tokenStatus && (
            <div className="mt-1.5 space-y-0.5">
              {tokenStatus.map((t) => (
                <p key={t.platform} className={`text-xs ${t.ok ? 'text-green-600' : 'text-destructive'}`}>
                  {t.platform === 'shopify_komputerzz' ? 'Komputerzz' : 'TikTok'} token:{' '}
                  {t.ok
                    ? `refreshed, expires ${t.expiresAt ? t.expiresAt.slice(0, 16).replace('T', ' ') : '?'}`
                    : t.error ?? 'refresh failed'
                  }
                </p>
              ))}
            </div>
          )}
        </section>

        <section className="border border-border rounded p-3 space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sync Logs</h2>
          <p className="text-xs text-muted-foreground">Full history of automated and manual syncs.</p>
          <Link href="/sync" className="text-xs text-primary hover:underline">View all logs â†’</Link>
        </section>
      </div>
    </div>
  )
}

const CONN_LABELS: Record<string, string> = {
  woocommerce:        'Coincart',
  shopify_komputerzz: 'Komputerzz',
  shopify_tiktok:     'TikTok Shop',
  libre_market:       'Libre Market',
  xmr_bazaar:         'XMR Bazaar',
  ireland:            'Ireland',
  acer_store:         'ACER Store',
}

function ConnSummary({ results }: { results: Record<string, { ok: boolean; latencyMs: number | null; error?: string }> | null }) {
  if (!results) return <p className="text-xs text-muted-foreground">No data yet â€” click Test to check.</p>

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
            {onlineCount} / {total} online â€” {offline.map(([k]) => CONN_LABELS[k] ?? k).join(', ')} offline
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

function PushResultDisplay({ results }: { results: ChannelSyncResult[] }) {
  // Incomplete products are shared across all platforms in the abort case â€” deduplicate by SKU
  const incompleteList = Array.from(
    new Map(
      results.flatMap((r) => r.incomplete ?? []).map((i) => [i.sku, i])
    ).values()
  )

  if (incompleteList.length > 0) {
    return (
      <div className="space-y-1.5 text-xs">
        <p className="font-medium text-destructive">
          Push aborted â€” {incompleteList.length} incomplete product{incompleteList.length > 1 ? 's' : ''}:
        </p>
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {incompleteList.map(({ sku, missing }) => (
            <li key={sku} className="flex gap-2 items-baseline">
              <Link href={`/products/${sku}`} className="font-mono text-destructive hover:underline shrink-0">
                {sku}
              </Link>
              <span className="text-destructive/70">{missing.join(', ')}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {results.map((r) => (
        <div key={r.platform} className="flex items-center justify-between text-xs">
          <Link href={`/channels/${r.platform}`} className="font-mono hover:underline">
            {r.platform}
          </Link>
          <span className={r.errors.length > 0 ? 'text-destructive' : 'text-green-600'}>
            {r.errors.length > 0
              ? r.errors[0]
              : [
                  r.newProductsCreated > 0 && `${r.newProductsCreated} new`,
                  r.statusUpdated > 0      && `${r.statusUpdated} updated`,
                  r.zeroedOutOfStock > 0   && `${r.zeroedOutOfStock} zeroed`,
                ].filter(Boolean).join(' | ') || 'nothing to push'
            }
          </span>
        </div>
      ))}
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
