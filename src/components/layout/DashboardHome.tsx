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
  sub: string
  subColor?: string
  href: string
}

const CHANNELS: ChannelConfig[] = [
  { id: 'woocommerce', label: 'WooCommerce', sub: 'coincart.store', href: '/channels/woocommerce' },
  { id: 'shopify_komputerzz', label: 'Shopify Komputerzz', sub: 'komputerzz.com', href: '/channels/shopify_komputerzz' },
  { id: 'shopify_tiktok', label: 'TikTok Tech Store', sub: 'shopify_tiktok', href: '/channels/shopify_tiktok' },
  { id: 'ebay_ie', label: 'eBay Ireland', sub: 'ebay.ie', href: '/channels/ebay_ie' },
  { id: 'amazon', label: 'Amazon', sub: 'amazon.ie', href: '/channels/amazon' },
  { id: 'libre_market', label: 'Libre Market', sub: 'browser runner', subColor: '#FFD84D', href: '/channels/libre_market' },
  { id: 'xmr_bazaar', label: 'XMR Bazaar', sub: 'browser runner', subColor: '#FFD84D', href: '/channels/xmr_bazaar' },
]

const CHANNEL_PLACEHOLDER_EUR: Record<string, number> = {
  woocommerce: 456,
  shopify_komputerzz: 387,
  shopify_tiktok: 218,
  ebay_ie: 296,
  amazon: 743,
  libre_market: 322,
  xmr_bazaar: 234,
}

const WAREHOUSE_ORDER = [
  { id: 'ireland', label: 'Ireland', href: '/warehouses/ireland' },
  { id: 'poland', label: 'Poland', href: '/warehouses/poland' },
  { id: 'acer_store', label: 'ACER Store', href: '/warehouses/acer_store' },
] as const

const WAREHOUSE_INCOMING: Record<string, number> = {
  ireland: 12,
  poland: 25,
  acer_store: 0,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' })
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
  borderColor,
  textColor,
  onClick,
  disabled,
}: {
  label: string
  borderColor: string
  textColor: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-[46px] w-full rounded-[10px] border bg-[#0D1830] text-[13px] font-semibold transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor, color: textColor }}
    >
      {label}
    </button>
  )
}

function MetaLine({ label, iso }: { label: string; iso: string | null }) {
  return (
    <p className="font-mono text-[10px] text-[var(--text-muted)]">
      {label} · {iso ? <time dateTime={iso}>{fmtDate(iso)}</time> : '-'}
    </p>
  )
}

function WarehouseCard({
  name,
  subtitle,
  subtitleColor,
  refsInStock,
  occupied,
  incoming,
  borderColor,
  href,
}: {
  name: string
  subtitle: string
  subtitleColor?: string
  refsInStock: number | null
  occupied: number
  incoming: number
  borderColor?: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="group flex h-[172px] flex-col rounded-[10px] border bg-[var(--panel)] px-[18px] py-4 transition duration-200 hover:-translate-y-[1px] hover:shadow-[0_0_24px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)]"
      style={{ borderColor: borderColor ?? 'var(--panel-border)' }}
    >
      <p className="text-[14px] font-semibold text-[var(--text-primary)]">{name}</p>
      <p className="mt-1 text-[11px]" style={{ color: subtitleColor ?? 'var(--text-muted)' }}>
        {subtitle}
      </p>
      <div className="h-3" />
      <p className="font-mono text-[10px] text-[var(--text-muted)]">{refsInStock != null ? `${refsInStock} SKUs` : '- SKUs'}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-[4px] bg-[var(--panel-border)]">
        <div className="h-full bg-[var(--black-fill)]" style={{ width: `${occupied}%` }} />
        <div className="relative -mt-2 h-2 bg-[var(--incoming-gray)]" style={{ width: `${incoming}%`, left: `${occupied}%` }} />
      </div>
      <p className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">occupied {occupied}% · incoming {incoming}%</p>
    </Link>
  )
}

function ChannelCard({
  name,
  sub,
  subColor,
  href,
  revenueEur,
  borderColor,
  campaignChip,
}: {
  name: string
  sub: string
  subColor?: string
  href: string
  revenueEur: number
  borderColor?: string
  campaignChip?: { label: 'G' | 'T'; tone: 'blue' | 'yellow' }
}) {
  const chipClass =
    campaignChip?.tone === 'yellow'
      ? 'border-[var(--glow-yellow)] bg-[#3A2A00] text-[var(--glow-yellow)] shadow-[0_0_22px_rgba(255,216,77,0.45)]'
      : 'border-[var(--glow-blue)] bg-[#1E3A5F] text-[var(--glow-blue)] shadow-[0_0_22px_rgba(53,167,255,0.45)]'

  return (
    <Link
      href={href}
      className="group flex h-[100px] items-center justify-between rounded-[8px] border bg-[var(--panel)] px-5 transition duration-200 hover:-translate-y-[1px] hover:shadow-[0_0_24px_rgba(53,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow-blue)]"
      style={{ borderColor: borderColor ?? 'var(--panel-border)' }}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{name}</p>
        <p className="text-[11px]" style={{ color: subColor ?? 'var(--text-muted)' }}>
          {sub}
        </p>
      </div>
      <div className="flex flex-col items-end gap-[6px]">
        <p className="font-mono text-[20px] font-bold text-[var(--glow-green)]">€{revenueEur}</p>
        {campaignChip ? (
          <span
            aria-label={`${name} ad campaign`}
            className={`campaign-chip inline-flex h-5 min-w-[48px] items-center justify-center gap-1 rounded-[10px] border px-[7px] text-[8px] font-semibold ${chipClass} ${
              campaignChip.label === 'G' ? 'campaign-chip-fast' : 'campaign-chip-fast-alt'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>{campaignChip.label} ADS</span>
          </span>
        ) : (
          <span className="h-5" />
        )}
      </div>
    </Link>
  )
}

export function DashboardHome() {
  const qc = useQueryClient()
  const { data: summaryRes, isError } = useQuery({
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

  const warehouseMaxStock = useMemo(() => Math.max(...warehouses.map((w) => w.refsInStock), 0), [warehouses])

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
      const revenueEur = found?.sales24hCents != null ? Math.round(found.sales24hCents / 100) : CHANNEL_PLACEHOLDER_EUR[channel.id]
      return {
        ...channel,
        revenueEur: clamp(revenueEur, 200, 999),
        hasCampaignG: channel.id === 'shopify_komputerzz',
        hasCampaignT: channel.id === 'shopify_tiktok',
      }
    })
  }, [channelMap])

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
        <div className="grid gap-4 lg:grid-cols-[274px_minmax(360px,426px)_440px] lg:items-start lg:justify-between">
          <div className="space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">WAREHOUSES</p>
            {orderedWarehouses.map((warehouse) => (
              <WarehouseCard
                key={warehouse.id}
                name={warehouse.label}
                subtitle={warehouse.id === 'acer_store' ? 'Scraper · writable' : 'Auto-synced · read only'}
                subtitleColor={warehouse.id === 'acer_store' ? 'var(--glow-green)' : undefined}
                refsInStock={warehouse.refsInStock}
                occupied={warehouse.occupied}
                incoming={warehouse.incoming}
                borderColor={warehouse.id === 'acer_store' ? 'var(--glow-green)' : undefined}
                href={warehouse.href}
              />
            ))}
          </div>

          <div className="flex flex-col justify-start lg:-mt-10">
            <div className="relative mx-auto h-[420px] w-full max-w-[426px] rounded-[20px] border border-[var(--glow-blue)] bg-[var(--panel)] p-7 shadow-[0_0_46px_rgba(53,167,255,0.22)]">
              <div className="absolute left-0 top-0 h-[3px] w-full bg-[var(--glow-blue)]" />
              <div className="mx-auto mt-2 flex h-[200px] w-[200px] flex-col items-center justify-center rounded-full bg-[#0D1830] text-center">
                <p className="text-[32px] text-[var(--glow-blue)]">?</p>
                <p className="font-heading text-[30px] font-bold text-[var(--text-primary)]">WIZHARD</p>
                <p className="text-[9px] font-semibold tracking-[0.12em] text-[var(--text-muted)]">MASTER CATALOGUE</p>
              </div>

              <div className="mt-3 border-t border-[var(--panel-border)] pt-5">
                <div className="space-y-3">
                  <ActionButton
                    label={scanning ? 'Scanning Warehouses' : 'Scan Warehouses'}
                    borderColor='var(--glow-blue)'
                    textColor='var(--glow-blue)'
                    onClick={handleScanStocks}
                    disabled={scanning}
                  />
                  <ActionButton
                    label={pushing ? 'Pushing To Channels' : 'Push To Channels'}
                    borderColor='var(--glow-green)'
                    textColor='var(--glow-green)'
                    onClick={handleUpdateChannels}
                    disabled={pushing}
                  />
                </div>
              </div>

              <div className="mt-5 border-t border-[var(--panel-border)] pt-4">
                <MetaLine label='Last scan' iso={lastStockScan} />
                <MetaLine label='Last push' iso={lastChannelPush} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">SALE CHANNELS</p>
            {orderedChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                name={channel.label}
                sub={channel.sub}
                subColor={channel.subColor}
                href={channel.href}
                revenueEur={channel.revenueEur}
                borderColor={
                  channel.id === 'shopify_komputerzz'
                    ? 'var(--glow-blue)'
                    : channel.id === 'shopify_tiktok'
                      ? 'var(--glow-yellow)'
                      : undefined
                }
                campaignChip={
                  channel.hasCampaignG
                    ? { label: 'G', tone: 'blue' }
                    : channel.hasCampaignT
                      ? { label: 'T', tone: 'yellow' }
                      : undefined
                }
              />
            ))}
          </div>
        </div>
      </section>

      {(scanError || pushError || isError || scanProgressText) ? (
        <div className="px-1 text-xs text-[var(--text-muted)]">
          {scanProgressText ? <p>{scanProgressText}</p> : null}
          {scanError ? <p className="text-[#FF9AAD]">Scan error: {scanError}</p> : null}
          {pushError ? <p className="text-[#FF9AAD]">Push error: {pushError}</p> : null}
          {isError ? <p className="text-[#FF9AAD]">Summary unavailable. Check API/database.</p> : null}
        </div>
      ) : null}

      {scanResult?.length ? (
        <div className="space-y-1 px-1 text-xs text-[var(--text-muted)]">
          {scanResult.map((result) => (
            <p key={result.warehouseId} className={result.errors.length > 0 ? 'text-[#FF9AAD]' : 'text-emerald-400'}>
              {result.warehouseId}: {result.errors[0] ?? `${result.productsUpdated} refs updated`}
            </p>
          ))}
        </div>
      ) : null}

      {pushResult?.length ? (
        <div className="space-y-1 px-1 text-xs text-[var(--text-muted)]">
          {pushResult.map((result) => (
            <p key={result.platform}>
              {result.platform}: {result.errors[0] ?? `${result.statusUpdated} updated | ${result.newProductsCreated} new | ${result.zeroedOutOfStock} zeroed`}
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
