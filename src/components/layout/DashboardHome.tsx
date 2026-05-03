'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'
import { requireBrowserRunnerRunning } from '@/lib/browser-runner-control'
import { BackgroundPaths } from '@/components/ui/background-paths'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
  syncedAt?: string
  queued?: boolean
  message?: string
}

interface ChannelSyncResult {
  platform: string
  statusUpdated: number
  newProductsCreated: number
  zeroedOutOfStock: number
  errors: string[]
  incomplete?: Array<{ sku: string; missing: string[] }>
}

interface PushBarState {
  label: string
  progress: number
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  total?: number
  processed?: number
  failed?: number
}

interface DashboardSummary {
  warehouses: Array<{ id: string; label: string; refsInStock: number; refsTotal: number }>
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
  lastPush: string | null
}

interface RunnerLogRow {
  createdAt?: string
  status?: 'success' | 'error'
  message?: string | null
}

interface AcerRunSummary {
  startedAt?: string
  finishedAt?: string
  scrapedProducts?: number
  inStockProducts?: number
  outOfStockProducts?: number
  snapshotCount?: number
  productsConsidered?: number
  collectionOnlyProducts?: number
  browserProducts?: number
  imagesUploaded?: number
  errors?: number
  error?: string
}

const WAREHOUSES = [
  { id: 'ireland', label: 'Ireland', sub: 'Auto-synced - read only', href: '/warehouses/ireland' },
  { id: 'poland', label: 'Poland', sub: 'API sync - read only', href: '/warehouses/poland' },
  { id: 'acer_store', label: 'ACER Store', sub: 'Scraper - read only', href: '/warehouses/acer_store' },
  { id: 'dropshipping', label: 'Dropshipping', sub: 'Manual - scan skipped', href: '/warehouses/dropshipping' },
] as const

const CHANNELS = [
  { id: 'coincart2', label: 'COINCART2', sub: 'coincart.store', href: '/channels/coincart2' },
  { id: 'shopify_komputerzz', label: 'KOMPUTERZZ', sub: 'komputerzz.com', href: '/channels/shopify_komputerzz' },
  { id: 'shopify_tiktok', label: 'TIKTOK TECH STORE', sub: 'shopify_tiktok', href: '/channels/shopify_tiktok' },
  { id: 'ebay_ie', label: 'EBAY IRELAND', sub: 'ebay.ie', href: '/channels/ebay_ie' },
  { id: 'amazon', label: 'AMAZON', sub: 'amazon.ie', href: '/channels/amazon' },
  { id: 'libre_market', label: 'LIBRE MARKET', sub: 'browser runner', href: '/channels/libre_market' },
  { id: 'xmr_bazaar', label: 'XMR BAZAAR', sub: 'browser runner', href: '/channels/xmr_bazaar' },
] as const

const INCOMING: Record<string, number> = { ireland: 18, poland: 12, acer_store: 15, dropshipping: 0 }

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getProgress(stock: number, maxStock: number, id: string) {
  const inc = clamp(INCOMING[id] ?? 12, 0, 35)
  if (maxStock <= 0) return { occ: clamp(45 - inc, 10, 85), inc }
  const scaled = Math.round((stock / maxStock) * 72) + 18
  return { occ: clamp(scaled, 10, 88 - inc), inc }
}

function formatRevenue(cents: number | null | undefined) {
  const eur = cents != null ? Math.round(cents / 100) : 0
  return `${clamp(eur, 0, 999999)} EUR`
}

function parseAcerRunSummary(message?: string | null): AcerRunSummary | null {
  if (!message) return null
  try {
    return JSON.parse(message) as AcerRunSummary
  } catch {
    return null
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8FA0C7]">{children}</p>
}

function WarehouseCard({
  label,
  sub,
  href,
  refsInStock,
  refsTotal,
  occ,
  inc,
}: {
  label: string
  sub: string
  href: string
  refsInStock: number | null
  refsTotal: number | null
  occ: number
  inc: number
}) {
  return (
    <Link
      href={href}
      className="block rounded-[10px] bg-[#0B1328] p-4 transition duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35A7FF]"
      style={{ border: '1px solid #1E2A44' }}
    >
      <p className="text-sm font-semibold text-[#E6ECFF]">{label}</p>
      <p className="mt-0.5 text-xs text-[#8FA0C7]">{sub}</p>
      <div className="relative mt-4 h-2 w-full overflow-hidden rounded-full bg-[#1E2A44]">
        <div className="absolute inset-y-0 left-0 bg-[#0A0A0A]" style={{ width: `${occ}%` }} />
        <div className="absolute inset-y-0 bg-[#7A7F87]" style={{ left: `${occ}%`, width: `${inc}%` }} />
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-[#8FA0C7]">occupied {occ}% - incoming {inc}%</p>
      {refsInStock != null && (
        <p className="mt-1.5 font-mono text-xs font-bold text-[#35A7FF]">{refsInStock} refs in stock</p>
      )}
      {refsTotal != null && (
        <p className="mt-1 font-mono text-[10px] text-[#8FA0C7]">{refsTotal} refs scraped/listed</p>
      )}
    </Link>
  )
}

function AdChip({ label, tone }: { label: string; tone: 'blue' | 'yellow' | 'green' }) {
  const classes =
    tone === 'blue'
      ? 'border-[#35A7FF] bg-[rgba(53,167,255,0.12)] text-[#35A7FF] chip-blue'
      : tone === 'green'
        ? 'border-[#35F2A1] bg-[rgba(53,242,161,0.12)] text-[#35F2A1] chip-green'
        : 'border-[#FFD84D] bg-[rgba(255,216,77,0.12)] text-[#FFD84D] chip-yellow'

  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] border ${classes}`}>{label}</span>
}

function campaignChip(channelId: string, scheduledCount: number) {
  if (scheduledCount <= 0) return null
  if (channelId === 'shopify_komputerzz') return <AdChip label={`G ADS ${scheduledCount}`} tone="blue" />
  if (channelId === 'shopify_tiktok') return <AdChip label={`T ADS ${scheduledCount}`} tone="yellow" />
  return <AdChip label={`ADS ${scheduledCount}`} tone="green" />
}

function ChannelCard({
  id,
  label,
  sub,
  href,
  sales24hCents,
  scheduledAds,
}: {
  id: string
  label: string
  sub: string
  href: string
  sales24hCents: number | null
  scheduledAds: number
}) {
  const borderColor =
    id === 'shopify_komputerzz' ? '#35A7FF' : id === 'shopify_tiktok' ? '#FFD84D' : scheduledAds > 0 ? '#35F2A1' : '#1E2A44'

  return (
    <Link
      href={href}
      className="flex min-h-[88px] items-center justify-between rounded-lg bg-[#0B1328] px-5 py-3 transition duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(53,167,255,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35A7FF]"
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-[#E6ECFF]">{label}</p>
        <p className="text-[11px] text-[#8FA0C7]">{sub}</p>
        {campaignChip(id, scheduledAds)}
      </div>
      <p className="font-mono text-xl font-bold text-[#35F2A1]">{formatRevenue(sales24hCents)}</p>
    </Link>
  )
}

export function DashboardHome() {
  const qc = useQueryClient()

  const { data: summaryRes, isError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<{ data: DashboardSummary }>('/api/dashboard/summary'),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const summary = summaryRes?.data
  const warehouseData = useMemo(() => summary?.warehouses ?? [], [summary])
  const channelData = useMemo(() => summary?.channels ?? [], [summary])

  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [scanResult, setScanResult] = useState<WarehouseSyncResult[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<ChannelSyncResult[] | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushBars, setPushBars] = useState<Record<string, PushBarState>>({})
  const [activePushPlatform, setActivePushPlatform] = useState<string | null>(null)

  const [acerStock, setAcerStock] = useState<'idle' | 'sent'>('idle')
  const [acerFill,  setAcerFill]  = useState<'idle' | 'sent'>('idle')
  const [pendingAcerStockRunAt, setPendingAcerStockRunAt] = useState<string | null>(null)
  const [pendingAcerFillRunAt, setPendingAcerFillRunAt] = useState<string | null>(null)
  const [acerStockNotice, setAcerStockNotice] = useState<string | null>(null)
  const [acerFillNotice, setAcerFillNotice] = useState<string | null>(null)

  const [lastScan, setLastScan] = useState<string | null>(null)
  const [lastPush, setLastPush] = useState<string | null>(null)

  useEffect(() => {
    setLastScan(localStorage.getItem('lastStockScan'))
  }, [])

  useEffect(() => {
    setLastPush(summary?.lastPush ?? null)
  }, [summary?.lastPush])

  useEffect(() => {
    if (!pendingAcerStockRunAt && !pendingAcerFillRunAt) return

    let cancelled = false

    const pollRunnerCompletion = async () => {
      try {
        if (pendingAcerStockRunAt) {
          const stockRes = await apiFetch<{ data: RunnerLogRow[] }>(
            `/api/sync/logs?platform=acer_store&action=acer_stock_run&page=1&perPage=20`
          )
          const stockRow = (stockRes.data ?? []).find((row) => !!row.createdAt && row.createdAt >= pendingAcerStockRunAt)
          if (stockRow && !cancelled) {
            const payload = parseAcerRunSummary(stockRow.message)
            const message = stockRow.status === 'error'
              ? `ACER stock scan failed: ${payload?.error ?? 'unknown error'}`
              : `ACER stock scan complete - ${payload?.scrapedProducts ?? payload?.snapshotCount ?? 0} scraped, ${payload?.inStockProducts ?? 0} in stock`
            setAcerStockNotice(message)
            setPendingAcerStockRunAt(null)
            setScanResult((current) => current?.map((row) => (
              row.warehouseId === 'acer_store'
                ? { ...row, queued: false, message, productsUpdated: payload?.inStockProducts ?? row.productsUpdated }
                : row
            )) ?? current)
            qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
          }
        }

        if (pendingAcerFillRunAt) {
          const fillRes = await apiFetch<{ data: RunnerLogRow[] }>(
            `/api/sync/logs?platform=acer_store&action=acer_fill_run&page=1&perPage=20`
          )
          const fillRow = (fillRes.data ?? []).find((row) => !!row.createdAt && row.createdAt >= pendingAcerFillRunAt)
          if (fillRow && !cancelled) {
            const payload = parseAcerRunSummary(fillRow.message)
            const message = fillRow.status === 'error'
              ? `ACER fill failed: ${payload?.error ?? 'unknown error'}`
              : `ACER fill complete - ${payload?.productsConsidered ?? 0} products, ${payload?.imagesUploaded ?? 0} images, ${payload?.errors ?? 0} errors`
            setAcerFillNotice(message)
            setPendingAcerFillRunAt(null)
            qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
          }
        }
      } catch {
        // Keep polling on transient API errors.
      }
    }

    void pollRunnerCompletion()
    const interval = window.setInterval(() => { void pollRunnerCompletion() }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [pendingAcerStockRunAt, pendingAcerFillRunAt, qc])

  async function handleScan() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    setScanProgress('Starting...')
    try {
      const headers: HeadersInit = {}
      const token = process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch('/api/warehouses/sync-all/stream', {
        method: 'GET',
        headers,
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let final: WarehouseSyncResult[] | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let b = buf.indexOf('\n\n')
        while (b >= 0) {
          const chunk = buf.slice(0, b)
          buf = buf.slice(b + 2)
          b = buf.indexOf('\n\n')
          let name = 'message'
          let data = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          const parsed = JSON.parse(data) as { message?: string; results?: WarehouseSyncResult[] }
          if (name === 'progress') setScanProgress(parsed.message ?? '')
          if (name === 'scan_done') final = parsed.results ?? []
        }
      }
      setScanResult(final ?? [])
      const queuedAcer = (final ?? []).find((row) => row.warehouseId === 'acer_store' && row.queued)
      if (queuedAcer?.syncedAt) {
        setPendingAcerStockRunAt(queuedAcer.syncedAt)
        setAcerStockNotice('ACER stock scan queued - waiting for local runner completion...')
      }
      const now = new Date().toISOString()
      localStorage.setItem('lastStockScan', now)
      setLastScan(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setScanning(false)
      setScanProgress('')
    }
  }

  async function handlePush() {
    setPushing(true)
    setPushResult(null)
    setPushError(null)
    const startedAt = new Date().toISOString()
    const allPlatforms = ['shopify_komputerzz', 'coincart2', 'shopify_tiktok', 'ebay_ie', 'libre_market', 'xmr_bazaar'] as const
    const apiPlatforms = ['shopify_komputerzz', 'coincart2', 'shopify_tiktok', 'ebay_ie'] as const
    const token = process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    const labels = Object.fromEntries(CHANNELS.map((channel) => [channel.id, channel.label]))
    try {
      await requireBrowserRunnerRunning()
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Browser runner is not available')
      setPushBars({})
      setPushing(false)
      return
    }

    const browserTotalsEntries = await Promise.all(
      (['libre_market', 'xmr_bazaar'] as const).map(async (platform) => {
        const res = await fetch(`/api/products?pushedPlatform=${platform}&perPage=1000`, { headers })
        if (!res.ok) return [platform, 0] as const
        const body = await res.json() as { data?: Array<{ id: string }> }
        return [platform, body.data?.length ?? 0] as const
      })
    )
    const browserTotals = Object.fromEntries(browserTotalsEntries) as Record<'libre_market' | 'xmr_bazaar', number>
    setActivePushPlatform(null)
    setPushBars(
      Object.fromEntries(
        allPlatforms.map((platform) => [
          platform,
          {
            label: labels[platform] ?? platform,
            progress: 0,
            status: 'idle' as const,
            message: platform === 'libre_market' || platform === 'xmr_bazaar' ? 'Queued for runner' : 'Queued',
            total: platform === 'libre_market' || platform === 'xmr_bazaar' ? browserTotals[platform] : undefined,
            processed: 0,
            failed: 0,
          },
        ])
      )
    )
    setLastPush(startedAt)
    let timeout: number | null = null
    let currentActivePlatform: string | null = null

    const fetchPushLogs = async (platform: string) => {
      const res = await fetch(`/api/sync/logs?platform=${platform}&page=1&perPage=500`, { headers })
      if (!res.ok) return []
      const body = await res.json() as {
        data?: Array<{ action?: string; status?: string; message?: string; createdAt?: string; productId?: string }>
      }
      return (body.data ?? []).filter((row) =>
        row.action === 'push_product'
        && !!row.createdAt
        && row.createdAt >= startedAt
      )
    }

    const pollBackendPlatform = async (platform: (typeof apiPlatforms)[number]) => {
      let lastCount = 0
      let idlePolls = 0
      let hadActivity = false

      for (let attempt = 0; attempt < 180; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
        const rows = await fetchPushLogs(platform)
        const processed = rows.length
        const errorCount = rows.filter((row) => row.status === 'error').length
        const latest = rows[0]

        if (processed > 0) {
          hadActivity = true
          if (processed === lastCount) idlePolls += 1
          else idlePolls = 0
          lastCount = processed

          setPushBars((prev) => {
            const total = prev[platform]?.total ?? 0
            const progress = total > 0 ? Math.round((processed / total) * 100) : (processed > 0 ? 1 : 0)
            return {
              ...prev,
              [platform]: {
                ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
                label: prev[platform]?.label ?? labels[platform],
                progress,
                status: 'running',
                message: latest?.message
                  ? `${latest.message} (${processed}/${total || '?'})`
                  : `Processing from logs (${processed}/${total || '?'})`,
                total,
                processed,
                failed: errorCount,
              },
            }
          })
        }

        if (hadActivity && idlePolls >= 6) {
          setPushBars((prev) => ({
            ...prev,
            [platform]: {
              ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
              label: prev[platform]?.label ?? labels[platform],
              progress: 100,
              status: errorCount > 0 ? 'error' : 'success',
              message: `${processed} processed${errorCount ? `, ${errorCount} errors` : ''}`,
              total: prev[platform]?.total,
              processed,
              failed: errorCount,
            },
          }))
          return
        }
      }

      if (hadActivity) {
        const rows = await fetchPushLogs(platform)
        const errorCount = rows.filter((row) => row.status === 'error').length
        setPushBars((prev) => ({
          ...prev,
          [platform]: {
            ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
            label: prev[platform]?.label ?? labels[platform],
            progress: 100,
            status: errorCount > 0 ? 'error' : 'success',
            message: `${rows.length} processed${errorCount ? `, ${errorCount} errors` : ''}`,
            total: prev[platform]?.total,
            processed: rows.length,
            failed: errorCount,
          },
        }))
        return
      }

      setPushBars((prev) => ({
        ...prev,
        [platform]: {
          ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
          label: prev[platform]?.label ?? labels[platform],
          progress: 100,
          status: 'error',
          message: 'No backend push logs found',
          total: prev[platform]?.total,
          processed: prev[platform]?.processed,
          failed: prev[platform]?.failed,
        },
      }))
    }
    try {
      const controller = new AbortController()
      timeout = window.setTimeout(() => controller.abort('Push timed out'), 60 * 60 * 1000)

      const pollBrowserPlatform = async (platform: 'libre_market' | 'xmr_bazaar') => {
        const token = process.env.NEXT_PUBLIC_AGENT_BEARER_TOKEN
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
        const total = browserTotals[platform] ?? 0

        for (let attempt = 0; attempt < 120; attempt++) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000))
          const res = await fetch(`/api/sync/logs?platform=${platform}&page=1&perPage=500`, { headers })
          if (!res.ok) continue
          const body = await res.json() as { data?: Array<{ action?: string; status?: string; message?: string; createdAt?: string }> }
          const rows = (body.data ?? []).filter((row) =>
            row.action === 'push_product'
            && !!row.createdAt
            && row.createdAt >= startedAt
          )
          const processed = rows.length
          const errorCount = rows.filter((row) => row.status === 'error').length
          const latest = rows[0]
          setPushBars((prev) => ({
            ...prev,
            [platform]: {
              ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
              label: prev[platform]?.label ?? labels[platform],
              progress: total > 0 ? Math.round((processed / total) * 100) : 0,
              status: 'running',
              message: latest?.message
                ? `${latest.message} (${processed}/${total || '?'})`
                : `Runner processing... (${processed}/${total || '?'})`,
              total,
              processed,
              failed: errorCount,
            },
          }))
          const hit = (body.data ?? []).find((row) =>
            row.action === 'browser_push_run'
            && !!row.createdAt
            && row.createdAt >= startedAt
          )
          if (!hit) continue

          const isError = hit.status === 'error' || /failed=(?!0)\d+/.test(hit.message ?? '')
          setPushBars((prev) => ({
            ...prev,
            [platform]: {
              ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
              label: prev[platform]?.label ?? labels[platform],
              progress: 100,
              status: isError ? 'error' : 'success',
              message: hit.message ?? (isError ? 'Browser push failed' : 'Browser push complete'),
              total,
              processed,
              failed: errorCount,
            },
          }))
          return
        }

        setPushBars((prev) => ({
          ...prev,
          [platform]: {
            ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
            label: prev[platform]?.label ?? labels[platform],
            progress: 100,
            status: 'error',
            message: 'No browser runner result found',
            total,
            processed: prev[platform]?.processed,
            failed: prev[platform]?.failed,
          },
        }))
      }

      const allResults: ChannelSyncResult[] = []
      let browserPollingStarted = false

      for (const apiPlatform of apiPlatforms) {
      const res = await fetch('/api/sync/channel-availability/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        signal: controller.signal,
        body: JSON.stringify({
          platforms: [apiPlatform],
          triggeredBy: 'human',
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let platformDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let b = buf.indexOf('\n\n')
        while (b >= 0) {
          const chunk = buf.slice(0, b)
          buf = buf.slice(b + 2)
          b = buf.indexOf('\n\n')
          let name = 'message'
          let data = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          const parsed = JSON.parse(data) as {
            platform?: string
            processedTargets?: number
            totalTargets?: number
            lastStatus?: 'success' | 'error'
            result?: ChannelSyncResult
            results?: ChannelSyncResult[]
            message?: string
          }

          if (name === 'push_start') {
            setPushBars((prev) => Object.fromEntries(
              Object.entries(prev).map(([platform, bar]) => [
                platform,
                {
                  ...bar,
                  status: bar.status === 'success' ? 'success' : 'running',
                  message: platform === 'libre_market' || platform === 'xmr_bazaar'
                    ? 'Queued for runner'
                    : 'Preparing push...',
                },
              ])
            ))
          }

          if (name === 'platform_start' && parsed.platform) {
            currentActivePlatform = parsed.platform
            setActivePushPlatform(parsed.platform)
            setPushBars((prev) => ({
              ...prev,
              [parsed.platform!]: {
                ...(prev[parsed.platform!] ?? { label: parsed.platform!, progress: 0 }),
                label: prev[parsed.platform!]?.label ?? labels[parsed.platform!] ?? parsed.platform!,
                progress: prev[parsed.platform!]?.progress ?? 0,
                status: 'running',
                message: 'Pushing...',
                total: prev[parsed.platform!]?.total,
                processed: prev[parsed.platform!]?.processed ?? 0,
                failed: prev[parsed.platform!]?.failed ?? 0,
              },
            }))
          }

          if (name === 'platform_result' && parsed.platform && parsed.result) {
            const result = parsed.result
            const hasError = result.errors.length > 0 || (result.incomplete?.length ?? 0) > 0
            const message = result.errors[0]
              ?? (result.incomplete?.[0]
                ? `Incomplete: ${result.incomplete[0].sku}`
                : `${result.statusUpdated} upd - ${result.newProductsCreated} new - ${result.zeroedOutOfStock} zeroed`)
            setPushBars((prev) => ({
              ...prev,
              [parsed.platform!]: {
                ...(prev[parsed.platform!] ?? { label: parsed.platform!, progress: 0 }),
                label: prev[parsed.platform!]?.label ?? labels[parsed.platform!] ?? parsed.platform!,
                progress: 100,
                status: hasError ? 'error' : 'success',
                message,
                total: prev[parsed.platform!]?.total,
                processed: prev[parsed.platform!]?.processed,
                failed: result.errors.length + (result.incomplete?.length ?? 0),
              },
            }))
            currentActivePlatform = currentActivePlatform === parsed.platform ? null : currentActivePlatform
            setActivePushPlatform((current) => (current === parsed.platform ? null : current))
          }

          if (name === 'platform_progress' && parsed.platform) {
            const processedTargets = parsed.processedTargets ?? 0
            const totalTargets = parsed.totalTargets ?? 0
            const computedProgress = totalTargets > 0 ? Math.round((processedTargets / totalTargets) * 100) : 0
            const suffix = totalTargets > 0 ? `(${processedTargets}/${totalTargets})` : ''
            setPushBars((prev) => ({
              ...prev,
              [parsed.platform!]: {
                ...(prev[parsed.platform!] ?? { label: parsed.platform!, progress: 0 }),
                label: prev[parsed.platform!]?.label ?? labels[parsed.platform!] ?? parsed.platform!,
                progress: computedProgress,
                status: 'running',
                message: parsed.message ? `${parsed.message} ${suffix}`.trim() : `Pushing... ${suffix}`.trim(),
                total: totalTargets,
                processed: processedTargets,
                failed: prev[parsed.platform!]?.failed ?? 0,
              },
            }))
          }

          if (name === 'runner_wake' && !browserPollingStarted) {
            browserPollingStarted = true
            for (const platform of ['libre_market', 'xmr_bazaar'] as const) {
              setPushBars((prev) => ({
                ...prev,
                [platform]: {
                  ...(prev[platform] ?? { label: labels[platform], progress: 0 }),
                  label: prev[platform]?.label ?? labels[platform],
                  progress: prev[platform]?.progress ?? 0,
                  status: 'running',
                  message: 'Runner processing...',
                  total: prev[platform]?.total ?? browserTotals[platform],
                  processed: prev[platform]?.processed ?? 0,
                  failed: prev[platform]?.failed ?? 0,
                },
              }))
              void pollBrowserPlatform(platform)
            }
          }

          if (name === 'push_done') { allResults.push(...(parsed.results ?? [])); platformDone = true }
          if (name === 'stream_error') throw new Error(parsed.message ?? 'Unknown error')
        }
      }

      if (!platformDone) {
        throw new Error(currentActivePlatform
          ? `Push stream ended unexpectedly while processing ${currentActivePlatform}`
          : `Push stream ended unexpectedly for ${apiPlatform}`)
      }
      } // end apiPlatforms loop

      if (timeout != null) window.clearTimeout(timeout)
      setPushResult(allResults)
      const now = new Date().toISOString()
      localStorage.setItem('lastChannelPush', now)
      setLastPush(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const shouldFallbackToLogs =
        message.includes('BodyStreamBuffer')
        || message.includes('stream ended unexpectedly')
        || message.includes('aborted')

      if (shouldFallbackToLogs) {
        setPushError('Live stream disconnected. Tracking progress from logs...')
        await Promise.all([
          ...apiPlatforms.map((platform) => pollBackendPlatform(platform)),
        ])
      } else {
        setPushError(message)
        setPushBars((prev) => Object.fromEntries(
          Object.entries(prev).map(([platform, bar]) => [
            platform,
            {
              ...bar,
              status: bar.status === 'success' ? 'success' : 'error',
              message: bar.status === 'success' ? bar.message : message,
            },
          ])
        ))
      }
    } finally {
      if (timeout != null) window.clearTimeout(timeout)
      setActivePushPlatform(null)
      setPushing(false)
    }
  }

  async function wakeAcerRunner(runner: 'acer-stock' | 'acer-fill', reason: string) {
    const set = runner === 'acer-stock' ? setAcerStock : setAcerFill
    const startedAt = new Date().toISOString()
    set('sent')
    try {
      await apiPost('/api/runner/wake', { runner, reason })
      if (runner === 'acer-stock') {
        setPendingAcerStockRunAt(startedAt)
        setAcerStockNotice('ACER stock scan queued - waiting for local runner completion...')
      } else {
        setPendingAcerFillRunAt(startedAt)
        setAcerFillNotice('ACER fill queued - waiting for local runner completion...')
      }
    } catch { /* ignore */ }
    setTimeout(() => set('idle'), 4000)
  }

  const maxStock = useMemo(() => Math.max(...warehouseData.map((w) => w.refsInStock), 0), [warehouseData])

  const warehouses = useMemo(
    () =>
      WAREHOUSES.map((w) => {
        const found = warehouseData.find((x) => x.id === w.id)
        const refsInStock = found?.refsInStock ?? null
        const refsTotal = found?.refsTotal ?? null
        const { occ, inc } = getProgress(refsInStock ?? 0, maxStock, w.id)
        return { ...w, label: found?.label ?? w.label, refsInStock, refsTotal, occ, inc }
      }),
    [warehouseData, maxStock],
  )

  const channelMap = useMemo(() => new Map(channelData.map((c) => [c.id, c])), [channelData])

  const channels = useMemo(
    () =>
      CHANNELS.map((c) => {
        const found = channelMap.get(c.id)
        return {
          ...c,
          label: found?.label ?? c.label,
          sales24hCents: found?.sales24hCents ?? 0,
          scheduledAds: found?.googleAdsCampaignsProgrammed ?? 0,
        }
      }),
    [channelMap],
  )

  return (
    <div className="relative -mx-4 -mb-6 -mt-4 min-h-screen bg-[#060D1F] px-6 py-6 md:-mx-6 md:-mb-6 md:-mt-6">
      <BackgroundPaths />
      {isError && (
        <div className="mb-4 rounded-lg border border-[rgba(255,92,122,0.4)] bg-[rgba(255,92,122,0.07)] px-4 py-2 text-xs text-[#FF5C7A]">
          Summary unavailable - check API / database
        </div>
      )}

      <div className="grid grid-cols-[1fr_410px_1fr] items-start gap-6">
        <div>
          <SectionLabel>Warehouses</SectionLabel>
          <div className="space-y-3">
            {warehouses.map((w) => (
              <WarehouseCard key={w.id} {...w} />
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>&nbsp;</SectionLabel>
          <div
            className="relative overflow-hidden rounded-[20px] bg-[#0B1328]"
            style={{ border: '1.5px solid #35A7FF', boxShadow: '0 0 40px rgba(53,167,255,0.15)' }}
          >
            <div className="absolute left-0 right-0 top-0 h-[3px] bg-[#35A7FF]" />
            <div className="absolute left-1/2 top-8 h-[200px] w-[200px] -translate-x-1/2 rounded-full bg-[#0D1830]" />

            <div className="relative px-8 pb-4 pt-7 text-center">
              <p className="text-3xl leading-none text-[#35A7FF]">O</p>
              <p className="font-heading mt-2 text-[28px] font-bold leading-none tracking-wide text-[#E6ECFF]">WIZHARD</p>
              <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#8FA0C7]">Master Catalogue</p>
              {summary && (
                <p className="mt-1 font-mono text-[10px] text-[#8FA0C7]">
                  {summary.wizhard.productsToFill} to fill - {summary.readyToPush.count} to push
                </p>
              )}
            </div>

            <div className="relative space-y-4 px-8 pb-8">
              <div className="h-px bg-[#1E2A44]" />

              <div>
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="w-full rounded-[10px] border border-[#35A7FF] bg-[#0D1830] px-4 py-3 text-[13px] font-semibold text-[#35A7FF] transition duration-200 hover:-translate-y-px hover:shadow-[0_0_16px_rgba(53,167,255,0.3)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35A7FF]"
                >
                  {scanning ? (scanProgress || 'Scanning...') : 'Scan Warehouses'}
                </button>
                {(scanResult || scanError) && (
                  <div className="mt-2 space-y-0.5">
                    {scanError && <p className="font-mono text-[10px] text-[#FF5C7A]">{scanError}</p>}
                    {scanResult?.map((r) => (
                      <p
                        key={r.warehouseId}
                        className={`font-mono text-[10px] ${r.errors.length ? 'text-[#FF5C7A]' : r.queued ? 'text-[#F2A135]' : 'text-[#35F2A1]'}`}
                      >
                        {r.warehouseId}: {r.errors[0] ?? r.message ?? `${r.productsUpdated} updated`}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={handlePush}
                  disabled={pushing}
                  className="w-full rounded-[10px] border border-[#35F2A1] bg-[#0D1830] px-4 py-3 text-[13px] font-semibold text-[#35F2A1] transition duration-200 hover:-translate-y-px hover:shadow-[0_0_16px_rgba(53,242,161,0.3)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35A7FF]"
                >
                  {pushing ? 'Pushing...' : 'Push To Channels'}
                </button>
                {(pushResult || pushError) && (
                  <div className="mt-2 space-y-0.5">
                    {pushError && <p className="font-mono text-[10px] text-[#FF5C7A]">{pushError}</p>}
                    {pushResult?.map((r) => (
                      <p key={r.platform} className={`font-mono text-[10px] ${r.errors.length ? 'text-[#FF5C7A]' : 'text-[#35F2A1]'}`}>
                        {r.platform}: {r.errors[0] ?? `${r.statusUpdated} upd - ${r.newProductsCreated} new - ${r.zeroedOutOfStock} zeroed`}
                      </p>
                    ))}
                  </div>
                )}
                {Object.keys(pushBars).length > 0 && (
                  <div className="mt-3 space-y-2">
                    {Object.entries(pushBars).map(([platform, bar]) => (
                      <div key={platform}>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <p className="font-mono text-[10px] text-[#E6ECFF]">{bar.label}</p>
                          <p className={`font-mono text-[10px] ${
                            bar.status === 'error'
                              ? 'text-[#FF5C7A]'
                              : bar.status === 'success'
                                ? 'text-[#35F2A1]'
                                : 'text-[#8FA0C7]'
                          }`}>
                            {bar.message}
                          </p>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#1E2A44]">
                          <div
                            className={`h-full transition-[width] duration-500 ${
                              bar.status === 'error'
                                ? 'bg-[#FF5C7A]'
                                : bar.status === 'success'
                                  ? 'bg-[#35F2A1]'
                                  : 'bg-[#35A7FF]'
                            }`}
                            style={{ width: `${bar.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-px bg-[#1E2A44]" />

              <div>
                <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-widest text-[#8FA0C7]">Acer Store Runner</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => wakeAcerRunner('acer-stock', 'manual')}
                    disabled={acerStock === 'sent'}
                    className="flex-1 rounded-[10px] border border-[#F2A135] bg-[#0D1830] px-3 py-2.5 text-[12px] font-semibold text-[#F2A135] transition duration-200 hover:-translate-y-px hover:shadow-[0_0_16px_rgba(242,161,53,0.3)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none"
                  >
                    {acerStock === 'sent' ? 'Signal sent ✓' : 'Scan Stock'}
                  </button>
                  <button
                    onClick={() => wakeAcerRunner('acer-fill', 'manual')}
                    disabled={acerFill === 'sent'}
                    className="flex-1 rounded-[10px] border border-[#F2A135] bg-[#0D1830] px-3 py-2.5 text-[12px] font-semibold text-[#F2A135] transition duration-200 hover:-translate-y-px hover:shadow-[0_0_16px_rgba(242,161,53,0.3)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none"
                  >
                    {acerFill === 'sent' ? 'Signal sent ✓' : 'Fill Product Data'}
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[9px] text-[#8FA0C7]">Requires <span className="text-[#E6ECFF]">npm run runner:acer</span> running locally. Fills descriptions, attributes, collections, images, and tags.</p>
                {(acerStockNotice || acerFillNotice) && (
                  <div className="mt-2 space-y-0.5">
                    {acerStockNotice && <p className="font-mono text-[10px] text-[#F2A135]">{acerStockNotice}</p>}
                    {acerFillNotice && <p className="font-mono text-[10px] text-[#F2A135]">{acerFillNotice}</p>}
                  </div>
                )}
              </div>

              <div className="h-px bg-[#1E2A44]" />

              <div className="space-y-1">
                <p className="font-mono text-[10px] text-[#8FA0C7]">Last scan - <span className="text-[#E6ECFF]">{fmtDate(lastScan)}</span></p>
                <p className="font-mono text-[10px] text-[#8FA0C7]">Last push - <span className="text-[#E6ECFF]">{fmtDate(lastPush)}</span></p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>Sale Channels</SectionLabel>
          <div className="space-y-2">
            {channels.map((c) => (
              <ChannelCard key={c.id} id={c.id} label={c.label} sub={c.sub} href={c.href} sales24hCents={c.sales24hCents} scheduledAds={c.scheduledAds} />
            ))}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .font-heading {
          font-family: var(--font-heading), 'Playfair Display', serif;
        }
        @keyframes chipBlue {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.08); filter: brightness(1.35); }
        }
        @keyframes chipYellow {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          55% { transform: scale(1.07); filter: brightness(1.25); }
        }
        @keyframes chipGreen {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.06); filter: brightness(1.2); }
        }
        .chip-blue { animation: chipBlue 1.2s ease-in-out infinite; }
        .chip-yellow { animation: chipYellow 1.2s ease-in-out infinite; }
        .chip-green { animation: chipGreen 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .chip-blue, .chip-yellow, .chip-green { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
