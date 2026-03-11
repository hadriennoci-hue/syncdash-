'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'
import { BackgroundPaths } from '@/components/ui/background-paths'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
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

const WAREHOUSES = [
  { id: 'ireland', label: 'Ireland', sub: 'Auto-synced - read only', href: '/warehouses/ireland' },
  { id: 'poland', label: 'Poland', sub: 'API sync - read only', href: '/warehouses/poland' },
  { id: 'acer_store', label: 'ACER Store', sub: 'Scraper - read only', href: '/warehouses/acer_store' },
] as const

const CHANNELS = [
  { id: 'woocommerce', label: 'COINCART2', sub: 'coincart.store', href: '/channels/woocommerce' },
  { id: 'shopify_komputerzz', label: 'KOMPUTERZZ', sub: 'komputerzz.com', href: '/channels/shopify_komputerzz' },
  { id: 'shopify_tiktok', label: 'TIKTOK TECH STORE', sub: 'shopify_tiktok', href: '/channels/shopify_tiktok' },
  { id: 'ebay_ie', label: 'EBAY IRELAND', sub: 'ebay.ie', href: '/channels/ebay_ie' },
  { id: 'amazon', label: 'AMAZON', sub: 'amazon.ie', href: '/channels/amazon' },
  { id: 'libre_market', label: 'LIBRE MARKET', sub: 'browser runner', href: '/channels/libre_market' },
  { id: 'xmr_bazaar', label: 'XMR BAZAAR', sub: 'browser runner', href: '/channels/xmr_bazaar' },
] as const

const INCOMING: Record<string, number> = { ireland: 18, poland: 12, acer_store: 15 }

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8FA0C7]">{children}</p>
}

function WarehouseCard({
  label,
  sub,
  href,
  refsInStock,
  occ,
  inc,
}: {
  label: string
  sub: string
  href: string
  refsInStock: number | null
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

  const [lastScan, setLastScan] = useState<string | null>(null)
  const [lastPush, setLastPush] = useState<string | null>(null)

  useEffect(() => {
    setLastScan(localStorage.getItem('lastStockScan'))
    setLastPush(localStorage.getItem('lastChannelPush'))
  }, [])

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
    try {
      const res = await apiPost('/api/sync/channel-availability', {
        platforms: ['shopify_komputerzz', 'woocommerce', 'ebay_ie'],
        triggeredBy: 'human',
      })
      setPushResult((res as { data: ChannelSyncResult[] }).data)
      const now = new Date().toISOString()
      localStorage.setItem('lastChannelPush', now)
      setLastPush(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  const maxStock = useMemo(() => Math.max(...warehouseData.map((w) => w.refsInStock), 0), [warehouseData])

  const warehouses = useMemo(
    () =>
      WAREHOUSES.map((w) => {
        const found = warehouseData.find((x) => x.id === w.id)
        const refsInStock = found?.refsInStock ?? null
        const { occ, inc } = getProgress(refsInStock ?? 0, maxStock, w.id)
        return { ...w, label: found?.label ?? w.label, refsInStock, occ, inc }
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
    <div className="relative -mx-4 -mt-4 min-h-screen bg-[#060D1F] px-6 py-6 md:-mx-6 md:-mt-6">
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
                      <p key={r.warehouseId} className={`font-mono text-[10px] ${r.errors.length ? 'text-[#FF5C7A]' : 'text-[#35F2A1]'}`}>
                        {r.warehouseId}: {r.errors[0] ?? `${r.productsUpdated} updated`}
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
