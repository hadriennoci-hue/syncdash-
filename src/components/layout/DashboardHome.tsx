'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
}

interface WarehouseScanProgress {
  message: string
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

interface ChannelConfig {
  id: string
  label: string
  href: string
}

const CHANNELS: ChannelConfig[] = [
  { id: 'woocommerce', label: 'COINCART', href: '/channels/woocommerce' },
  { id: 'shopify_komputerzz', label: 'KOMPUTERZZ', href: '/channels/shopify_komputerzz' },
  { id: 'shopify_tiktok', label: 'TIKTOK TECH STORE', href: '/channels/shopify_tiktok' },
  { id: 'ebay_ie', label: 'EBAY', href: '/channels/ebay_ie' },
  { id: 'amazon', label: 'AMAZON', href: '/channels/amazon' },
  { id: 'libre_market', label: 'LIBRE MARKET', href: '/channels/libre_market' },
  { id: 'xmr_bazaar', label: 'XMR BAZAAR', href: '/channels/xmr_bazaar' },
]

const CHANNEL_PLACEHOLDER_EUR: Record<string, number> = {
  woocommerce: 338,
  shopify_komputerzz: 912,
  shopify_tiktok: 745,
  ebay_ie: 402,
  amazon: 667,
  libre_market: 289,
  xmr_bazaar: 554,
}

const WAREHOUSE_ORDER = [
  { id: 'ireland', label: 'Ireland', href: '/warehouses/ireland' },
  { id: 'poland', label: 'Poland', href: '/warehouses/poland' },
  { id: 'acer_store', label: 'ACER Store', href: '/warehouses/acer_store' },
] as const

const WAREHOUSE_INCOMING: Record<string, number> = {
  ireland: 18,
  poland: 12,
  acer_store: 15,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: '2-digit' })
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return '-'
  return `EUR ${Math.round(cents / 100)}`
}

function getWarehouseProgress(refsInStock: number, maxRefsInStock: number, warehouseId: string) {
  const incoming = clamp(WAREHOUSE_INCOMING[warehouseId] ?? 12, 0, 35)
  if (maxRefsInStock <= 0) {
    return { occupied: clamp(45 - incoming, 10, 85), incoming }
  }
  const scaled = Math.round((refsInStock / maxRefsInStock) * 72) + 18
  const occupied = clamp(scaled, 10, 88 - incoming)
  return { occupied, incoming }
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md border border-[#2F5A85] bg-[#11203A] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[0_0_24px_rgba(53,167,255,0.28)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)]"
    >
      {label}
    </button>
  )
}

function DataStamp({ label, iso }: { label: string; iso: string | null }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.09em] text-[var(--text-muted)]">
      {label}:{' '}
      {iso ? (
        <time dateTime={iso} className="font-mono text-[var(--text-primary)]">
          {fmtDate(iso)}
        </time>
      ) : (
        <span className="font-mono text-[var(--text-primary)]">-</span>
      )}
    </p>
  )
}

function WarehouseCard({
  name,
  refsInStock,
  occupied,
  incoming,
  href,
}: {
  name: string
  refsInStock: number | null
  occupied: number
  incoming: number
  href: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4 transition duration-200 hover:-translate-y-[1px] hover:shadow-[0_0_24px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)] focus-visible:ring-offset-0"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)]">{name}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {refsInStock != null ? `${refsInStock} SKUs in stock` : 'Stock unavailable'}
      </p>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full border border-[#283550] bg-[#111B33]">
        <div className="h-full bg-[var(--black-fill)]" style={{ width: `${occupied}%` }} />
        <div
          className="relative -mt-3 h-3 bg-[var(--incoming-gray)] opacity-90"
          style={{ width: `${incoming}%`, left: `${occupied}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
        occupied {occupied}% - incoming {incoming}%
      </p>
    </Link>
  )
}

function ChannelCard({
  name,
  href,
  revenueEur,
  campaignChip,
}: {
  name: string
  href: string
  revenueEur: number
  campaignChip?: { label: string; color: 'yellow' | 'green' }
}) {
  const chipClass =
    campaignChip?.color === 'yellow'
      ? 'border-[var(--glow-yellow)] bg-[rgba(255,216,77,0.14)] text-[var(--glow-yellow)] shadow-[0_0_22px_rgba(255,216,77,0.45)]'
      : 'border-[var(--glow-green)] bg-[rgba(53,242,161,0.14)] text-[var(--glow-green)] shadow-[0_0_22px_rgba(53,242,161,0.45)]'

  return (
    <Link
      href={href}
      className="group rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4 transition duration-200 hover:-translate-y-[1px] hover:shadow-[0_0_24px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)]">{name}</p>
        {campaignChip ? (
          <span
            aria-label={`${name} ad campaign`}
            className={`campaign-chip inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-xs font-bold tracking-[0.14em] ${chipClass} ${
              campaignChip.label === 'G' ? 'campaign-chip-fast' : 'campaign-chip-fast-alt'
            }`}
          >
            {campaignChip.label}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">24H Revenue</p>
      <p className="font-mono text-lg font-bold text-[var(--text-primary)]">EUR {revenueEur}</p>
    </Link>
  )
}

export function DashboardHome() {
  const qc = useQueryClient()
  const { data: summaryRes, isLoading, isError } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<{ data: DashboardSummary }>('/api/dashboard/summary'),
  })

  const summary = summaryRes?.data
  const warehouses = useMemo(() => summary?.warehouses ?? [], [summary])
  const channels = useMemo(() => summary?.channels ?? [], [summary])

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<WarehouseSyncResult[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanProgressText, setScanProgressText] = useState<string>('')
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<ChannelSyncResult[] | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [lastStockScan, setLastStockScan] = useState<string | null>(null)
  const [lastChannelPush, setLastChannelPush] = useState<string | null>(null)

  useEffect(() => {
    setLastStockScan(localStorage.getItem('lastStockScan'))
    setLastChannelPush(localStorage.getItem('lastChannelPush'))
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
        if (eventName === 'scan_done') finalResults = (data.results ?? []) as WarehouseSyncResult[]
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
      setPushResult((res as { data: ChannelSyncResult[] }).data)
      const now = new Date().toISOString()
      localStorage.setItem('lastChannelPush', now)
      setLastChannelPush(now)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  const warehouseMaxStock = useMemo(() => {
    return Math.max(...warehouses.map((w) => w.refsInStock), 0)
  }, [warehouses])

  const channelMap = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels])

  const orderedWarehouses = useMemo(() => {
    return WAREHOUSE_ORDER.map((warehouse) => {
      const found = warehouses.find((item) => item.id === warehouse.id)
      const refsInStock = found?.refsInStock ?? null
      const progress = getWarehouseProgress(refsInStock ?? 0, warehouseMaxStock, warehouse.id)
      return {
        ...warehouse,
        refsInStock,
        occupied: progress.occupied,
        incoming: progress.incoming,
      }
    })
  }, [warehouses, warehouseMaxStock])

  const orderedChannels = useMemo(() => {
    return CHANNELS.map((channel) => {
      const found = channelMap.get(channel.id)
      const revenueEur =
        found?.sales24hCents != null ? Math.round(found.sales24hCents / 100) : CHANNEL_PLACEHOLDER_EUR[channel.id]
      return {
        ...channel,
        revenueEur: clamp(revenueEur, 200, 999),
        hasCampaignG: channel.id === 'shopify_komputerzz',
        hasCampaignT: channel.id === 'shopify_tiktok',
      }
    })
  }, [channelMap])

  const sales24h = useMemo(
    () => channels.reduce((sum, c) => sum + (c.sales24hCents ?? 0), 0),
    [channels]
  )

  return (
    <div className="-ml-4 -mt-4 space-y-4 md:-ml-6 md:-mt-6">
      <section
        className="relative overflow-hidden rounded-2xl border border-[var(--panel-border)] p-4 md:p-6"
        style={
          {
            background:
              'radial-gradient(1200px 320px at 50% -10%, rgba(53,167,255,0.18), transparent 60%), radial-gradient(800px 280px at 70% 120%, rgba(53,242,161,0.08), transparent 60%), var(--bg-main)',
            '--bg-main': '#060D1F',
            '--panel': '#0B1328',
            '--panel-border': '#1E2A44',
            '--text-primary': '#E6ECFF',
            '--text-muted': '#8FA0C7',
            '--black-fill': '#0A0A0A',
            '--incoming-gray': '#7A7F87',
            '--glow-blue': '#35A7FF',
            '--glow-green': '#35F2A1',
            '--glow-yellow': '#FFD84D',
            '--danger': '#FF5C7A',
          } as React.CSSProperties
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Wizhard Network</p>
            <p className="font-heading text-2xl font-semibold text-[var(--text-primary)]">WIZHARD</p>
          </div>
          <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Sales 24H</p>
            <p className="font-mono text-sm font-bold text-[var(--text-primary)]">{fmtMoney(sales24h)}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr_1fr]">
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Warehouses</p>
              <DataStamp label="Last scan" iso={lastStockScan} />
            </div>
            {orderedWarehouses.map((warehouse) => (
              <WarehouseCard
                key={warehouse.id}
                name={warehouse.label}
                refsInStock={warehouse.refsInStock}
                occupied={warehouse.occupied}
                incoming={warehouse.incoming}
                href={warehouse.href}
              />
            ))}
          </div>

          <div className="flex flex-col justify-start lg:-mt-12">
            <div className="relative mx-auto w-full max-w-[360px] rounded-[28px] border border-[var(--panel-border)] bg-[var(--panel)] p-5 shadow-[0_0_46px_rgba(53,167,255,0.22)]">
              <div className="absolute left-1/2 top-3 h-[110px] w-[110px] -translate-x-1/2 rounded-full border border-[#335987] bg-[radial-gradient(circle_at_50%_45%,rgba(53,167,255,0.35),rgba(11,19,40,1)_75%)]" />
              <div className="pt-[130px] text-center">
                <p className="font-heading text-xl font-semibold tracking-[0.03em] text-[var(--text-primary)]">WIZHARD</p>
                <p className="mt-1 text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  {summary?.wizhard.productsToFill ?? '-'} products to fill - {summary?.readyToPush.count ?? '-'} to push
                </p>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <ActionButton
                    label={scanning ? 'Scanning Warehouses' : 'Scan Warehouses'}
                    onClick={handleScanStocks}
                    disabled={scanning}
                  />
                  <DataStamp label="Last scan" iso={lastStockScan} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <ActionButton
                    label={pushing ? 'Pushing To Channels' : 'Push To Channels'}
                    onClick={handleUpdateChannels}
                    disabled={pushing}
                  />
                  <DataStamp label="Last push" iso={lastChannelPush} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Sale Channels</p>
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">7 channels active</p>
            </div>
            {orderedChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                name={channel.label}
                href={channel.href}
                revenueEur={channel.revenueEur}
                campaignChip={
                  channel.hasCampaignG
                    ? { label: 'G', color: 'yellow' }
                    : channel.hasCampaignT
                      ? { label: 'T', color: 'green' }
                      : undefined
                }
              />
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Link
            href="/suppliers"
            className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3 transition duration-200 hover:shadow-[0_0_20px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Suppliers</p>
            <p className="mt-1 text-sm text-[var(--text-primary)]">ACER</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Last invoice:{' '}
              {summary?.suppliers.lastInvoiceDate ? (
                <time dateTime={summary.suppliers.lastInvoiceDate}>{fmtDate(summary.suppliers.lastInvoiceDate)}</time>
              ) : (
                '-'
              )}
            </p>
          </Link>
          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">System Status</p>
            <p className="mt-1 text-sm text-[var(--text-primary)]">
              {isLoading ? 'Loading summary...' : isError ? 'Summary unavailable' : 'Operational'}
            </p>
            {scanProgressText ? <p className="text-[11px] text-[var(--text-muted)]">{scanProgressText}</p> : null}
          </div>
        </div>
      </section>

      {scanError || pushError || isError ? (
        <div className="rounded-xl border border-[var(--danger)]/50 bg-[rgba(255,92,122,0.08)] p-3 text-xs text-[var(--text-primary)]">
          {scanError ? <p>Scan error: {scanError}</p> : null}
          {pushError ? <p>Push error: {pushError}</p> : null}
          {isError ? <p>Summary unavailable. Check API/database.</p> : null}
        </div>
      ) : null}

      {scanResult?.length ? (
        <div className="space-y-1 rounded-md border border-border bg-card p-3 text-xs">
          {scanResult.map((result) => (
            <p key={result.warehouseId} className={result.errors.length > 0 ? 'text-destructive' : 'text-emerald-700'}>
              {result.warehouseId}: {result.errors[0] ?? `${result.productsUpdated} refs updated`}
            </p>
          ))}
        </div>
      ) : null}

      {pushResult?.length ? (
        <div className="space-y-1 rounded-md border border-border bg-card p-3 text-xs">
          {pushResult.map((result) => (
            <p key={result.platform}>
              {result.platform}:{' '}
              {result.errors[0] ??
                `${result.statusUpdated} updated | ${result.newProductsCreated} new | ${result.zeroedOutOfStock} zeroed`}
            </p>
          ))}
        </div>
      ) : null}

      <style jsx global>{`
        .font-heading {
          font-family: var(--font-heading), serif;
        }

        .campaign-chip {
          animation: campaignPulse 1.9s ease-in-out infinite;
        }

        .campaign-chip-fast {
          animation: campaignPulseStrong 1.2s ease-in-out infinite;
        }

        .campaign-chip-fast-alt {
          animation: campaignPulseStrongAlt 1.2s ease-in-out infinite;
        }

        @keyframes campaignPulse {
          0%,
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.03);
            filter: brightness(1.2);
          }
        }

        @keyframes campaignPulseStrong {
          0%,
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.08);
            filter: brightness(1.35);
          }
        }

        @keyframes campaignPulseStrongAlt {
          0%,
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
          55% {
            transform: scale(1.07);
            filter: brightness(1.25);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .campaign-chip,
          .campaign-chip-fast,
          .campaign-chip-fast-alt {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}
