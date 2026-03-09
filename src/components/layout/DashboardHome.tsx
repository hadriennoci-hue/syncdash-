'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
  syncedAt: string
}

interface WarehouseScanProgress {
  stage: 'start' | 'url_started' | 'page_done' | 'url_done' | 'fetch_done'
  warehouseId: string
  warehouseIndex: number
  warehouseTotal: number
  message: string
  current: number
  total: number
}

interface ChannelSyncResult {
  platform: string
  statusUpdated: number
  newProductsCreated: number
  zeroedOutOfStock: number
  errors: string[]
}

interface DashboardSummary {
  warehouses: Array<{ id: string; label: string; refsInStock: number }>
  channels: Array<{
    id: string
    label: string
    refsForSale: number
    googleAdsCampaignsProgrammed: number
    sales24hCents: number
  }>
  readyToPush: { count: number }
  wizhard: { productsToFill: number }
  suppliers: { lastInvoiceDate: string | null }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtMoney(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

function NodeCard({
  title,
  children,
  tone = 'default',
}: {
  title: string
  children: React.ReactNode
  tone?: 'default' | 'warehouse' | 'channel'
}) {
  const toneClass =
    tone === 'warehouse'
      ? 'border-blue-200 bg-blue-50/55'
      : tone === 'channel'
        ? 'border-emerald-200 bg-emerald-50/55'
        : 'border-border bg-card'

  return (
    <div className={`min-h-[88px] rounded-lg border p-3 transition-shadow hover:shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="mt-2 text-xs text-muted-foreground space-y-1">{children}</div>
    </div>
  )
}

function Block({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[88px] rounded-lg border border-border bg-slate-100 animate-pulse" />
      ))}
    </div>
  )
}

export function DashboardHome() {
  const qc = useQueryClient()
  const { data: summaryRes, isLoading, isError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<{ data: DashboardSummary }>('/api/dashboard/summary'),
  })

  const summary = summaryRes?.data

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<WarehouseSyncResult[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanProgressText, setScanProgressText] = useState<string>('')

  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<ChannelSyncResult[] | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)

  const [lastStockScan, setLastStockScan] = useState<string | null>(null)

  useEffect(() => {
    setLastStockScan(localStorage.getItem('lastStockScan'))
  }, [])

  async function handleScanStocks() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    setScanProgressText('Starting warehouse scan...')
    try {
      const res = await fetch('/api/warehouses/sync-all/stream', {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN ?? ''}` },
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResults: WarehouseSyncResult[] | null = null

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

        if (eventName === 'progress') {
          const progress = data as WarehouseScanProgress
          setScanProgressText(progress.message)
          return
        }
        if (eventName === 'scan_done') {
          finalResults = (data.results ?? []) as WarehouseSyncResult[]
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          parseEvent(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }
      }

      setScanResult(finalResults ?? [])
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

  async function handleUpdateChannels() {
    setPushing(true)
    setPushResult(null)
    setPushError(null)
    try {
      const res = await apiPost('/api/sync/channel-availability', {
        platforms: ['shopify_komputerzz', 'woocommerce', 'ebay_ie'],
        triggeredBy: 'human',
      })
      setPushResult(res.data)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>Dashboard</h1>
          <p className="text-sm text-muted-foreground">Operational overview of warehouses, channel sync, and suppliers.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Block
            title="Warehouses"
            action={
              <button
                onClick={handleScanStocks}
                disabled={scanning}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Scan Warehouses'}
              </button>
            }
          >
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Last scan:{' '}
                {lastStockScan ? <time dateTime={lastStockScan}>{fmtDate(lastStockScan)}</time> : 'never'}
              </span>
              {scanProgressText ? <span>{scanProgressText}</span> : null}
            </div>

            {isLoading ? <SkeletonCards count={3} /> : null}
            {isError ? <p className="text-xs text-destructive">Failed to load warehouse summary.</p> : null}
            {!isLoading && !isError && summary?.warehouses.length === 0 ? (
              <p className="text-xs text-muted-foreground">No warehouses found.</p>
            ) : null}
            {!isLoading && !isError && (summary?.warehouses.length ?? 0) > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {summary?.warehouses.map((w) => (
                  <Link key={w.id} href={`/warehouses/${w.id}`} className="no-underline">
                    <NodeCard title={w.label} tone="warehouse">
                      <div className="text-foreground font-semibold">{w.refsInStock}</div>
                      <div>refs in stock</div>
                    </NodeCard>
                  </Link>
                ))}
              </div>
            ) : null}

            {scanError ? <p className="text-xs text-destructive">{scanError}</p> : null}
            {scanResult?.length ? (
              <div className="text-xs text-muted-foreground space-y-1">
                {scanResult.map((r) => (
                  <p key={r.warehouseId} className={r.errors.length > 0 ? 'text-destructive' : 'text-emerald-700'}>
                    {r.warehouseId}: {r.errors[0] ?? `${r.productsUpdated} refs updated`}
                  </p>
                ))}
              </div>
            ) : null}
          </Block>
        </div>

        <div className="lg:col-span-4">
          <Block title="Wizhard">
            {isLoading ? (
              <div className="h-24 rounded-lg border border-border bg-slate-100 animate-pulse" />
            ) : isError ? (
              <p className="text-xs text-destructive">Failed to load queue metrics.</p>
            ) : !summary ? (
              <p className="text-xs text-muted-foreground">No data.</p>
            ) : (
              <div className="rounded-lg border border-blue-200 bg-blue-50/45 p-4 space-y-3">
                <div>
                  <p className="text-2xl font-bold text-foreground">{summary.wizhard.productsToFill}</p>
                  <p className="text-xs text-muted-foreground">products to fill</p>
                </div>
                <button
                  onClick={handleUpdateChannels}
                  disabled={pushing}
                  className="w-full text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {pushing
                    ? 'Pushing...'
                    : `Push products to warehouses (${summary.readyToPush.count} to push)`}
                </button>
                {pushError ? <p className="text-xs text-destructive">{pushError}</p> : null}
                {pushResult?.length ? (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {pushResult.map((r) => (
                      <p key={r.platform}>
                        {r.platform}: {r.errors[0] ?? `${r.statusUpdated} updated | ${r.newProductsCreated} new | ${r.zeroedOutOfStock} zeroed`}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </Block>
        </div>

        <div className="lg:col-span-8">
          <Block title="Sale Channels">
            {isLoading ? <SkeletonCards count={3} /> : null}
            {isError ? <p className="text-xs text-destructive">Failed to load channel metrics.</p> : null}
            {!isLoading && !isError && summary?.channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sale channels configured.</p>
            ) : null}
            {!isLoading && !isError && (summary?.channels.length ?? 0) > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {summary?.channels.map((c) => (
                  <Link key={c.id} href={`/channels/${c.id}`} className="no-underline">
                    <NodeCard title={c.label} tone="channel">
                      <div>{c.googleAdsCampaignsProgrammed} Google Ads campaigns programmed</div>
                      <div>Sales 24h: <span className="font-semibold text-foreground">{fmtMoney(c.sales24hCents)}</span></div>
                    </NodeCard>
                  </Link>
                ))}
              </div>
            ) : null}
          </Block>
        </div>

        <div className="lg:col-span-4">
          <Block title="Suppliers">
            {isLoading ? (
              <div className="h-24 rounded-lg border border-border bg-slate-100 animate-pulse" />
            ) : isError ? (
              <p className="text-xs text-destructive">Failed to load supplier metadata.</p>
            ) : !summary ? (
              <p className="text-xs text-muted-foreground">No data.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Last invoice:{' '}
                  {summary.suppliers.lastInvoiceDate
                    ? <time dateTime={summary.suppliers.lastInvoiceDate}>{fmtDate(summary.suppliers.lastInvoiceDate)}</time>
                    : '—'}
                </p>
                <Link
                  href="/suppliers"
                  className="inline-flex text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent"
                >
                  Go to Suppliers
                </Link>
              </div>
            )}
          </Block>
        </div>
      </div>
    </div>
  )
}
