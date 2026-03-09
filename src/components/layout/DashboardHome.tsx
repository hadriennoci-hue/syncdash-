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
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtMoney(cents: number): string {
  return `${(cents / 100).toFixed(2)}EUR`
}

function NodeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-card p-2 min-w-[180px]">
      <div className="text-[11px] font-medium">{title}</div>
      <div className="mt-1 text-[11px] text-muted-foreground space-y-1">{children}</div>
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
    <div className="space-y-4 max-w-7xl">
      <h1 className="text-sm font-semibold">Dashboard</h1>

      {isLoading ? <p className="text-xs text-muted-foreground">Loading...</p> : null}
      {isError ? <p className="text-xs text-destructive">Failed to load - check DB migrations</p> : null}

      {summary && (
        <div className="space-y-4">
          <section className="rounded border border-border p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide">Warehouses</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleScanStocks}
                disabled={scanning}
                className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Scan Warehouses'}
              </button>
              <span className="text-xs text-muted-foreground">LAST SCAN: {lastStockScan ? fmtDate(lastStockScan) : 'Never'}</span>
              {scanProgressText && <span className="text-xs text-muted-foreground">{scanProgressText}</span>}
            </div>
            {(scanError || scanResult) && (
              <div className="text-xs">
                {scanError ? <p className="text-destructive">{scanError}</p> : null}
                {scanResult?.map((r) => (
                  <p key={r.warehouseId} className={r.errors.length ? 'text-destructive' : 'text-green-600'}>
                    {r.warehouseId}: {r.errors[0] ?? `${r.productsUpdated} refs updated`}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {summary.warehouses.map((w) => (
                <Link key={w.id} href={`/warehouses/${w.id}`} className="no-underline">
                  <NodeCard title={w.label}>
                    <div>{w.refsInStock} refs in stock</div>
                  </NodeCard>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded border border-border p-3">
            <div className="text-xs font-semibold uppercase tracking-wide mb-2">Wizhard</div>
            <div className="rounded border border-border bg-accent/30 p-3 space-y-2">
              <div className="text-sm font-medium">{summary.wizhard.productsToFill} products to Fill</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleUpdateChannels}
                  disabled={pushing}
                  className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {pushing ? 'Pushing...' : `Push products to warehouses (${summary.readyToPush.count} products to push)`}
                </button>
              </div>
              {pushError ? <p className="text-xs text-destructive">{pushError}</p> : null}
              {pushResult?.length ? (
                <div className="text-xs text-muted-foreground space-y-1">
                  {pushResult.map((r) => (
                    <div key={r.platform}>
                      {r.platform}: {r.errors[0] ?? `${r.statusUpdated} updated | ${r.newProductsCreated} new | ${r.zeroedOutOfStock} zeroed`}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{'->'}</span>
              <span>Last invoice: {summary.suppliers.lastInvoiceDate ? fmtDate(summary.suppliers.lastInvoiceDate) : '-'}</span>
              <span>{'->'}</span>
              <Link href="/suppliers" className="underline">SUPPLIERS</Link>
            </div>
          </section>

          <section className="rounded border border-border p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide">Sale Channels</div>
            <div className="flex flex-wrap gap-2">
              {summary.channels.map((c) => (
                <Link key={c.id} href={`/channels/${c.id}`} className="no-underline">
                  <NodeCard title={c.label}>
                    <div>{c.googleAdsCampaignsProgrammed} Google Ads campaigns programmed</div>
                    <div>Sales 24h: {fmtMoney(c.sales24hCents)}</div>
                  </NodeCard>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
