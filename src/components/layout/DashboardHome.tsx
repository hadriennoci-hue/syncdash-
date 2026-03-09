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

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: '2-digit' })
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `${Math.round(cents / 100)} €`
}

function StockNode({
  title,
  sub,
  href,
  className,
}: {
  title: string
  sub: string
  href?: string
  className?: string
}) {
  const body = (
    <div className={`rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2 shadow-sm ${className ?? ''}`}>
      <p className="text-[11px] font-semibold tracking-wide text-slate-100">{title}</p>
      <p className="text-[10px] text-slate-400">{sub}</p>
    </div>
  )
  if (!href) return body
  return <Link href={href}>{body}</Link>
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-100 hover:bg-slate-800 disabled:opacity-50"
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
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
      setPushResult(res.data)
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] })
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPushing(false)
    }
  }

  const whIreland = warehouses.find((w) => w.id === 'ireland')
  const whAcer = warehouses.find((w) => w.id === 'acer_store')
  const whPoland = warehouses.find((w) => w.id === 'poland')

  const chKomp = channels.find((c) => c.id === 'shopify_komputerzz')
  const chTikTok = channels.find((c) => c.id === 'shopify_tiktok')
  const chEbay = channels.find((c) => c.id === 'ebay_ie')
  const chXmr = channels.find((c) => c.id === 'xmr_bazaar')
  const chAmazon = channels.find((c) => c.id === 'amazon')

  const sales24h = useMemo(
    () => channels.reduce((sum, c) => sum + (c.sales24hCents ?? 0), 0),
    [channels]
  )

  return (
    <div className="space-y-3">
      <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-800 bg-[#060D1F]">
        <div className="relative h-[840px] w-[1360px]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1360 840" fill="none" aria-hidden>
            <path d="M290 190C390 190 390 360 500 360" stroke="#1E3A5F" strokeWidth="2" />
            <path d="M290 430C390 430 390 410 500 410" stroke="#163020" strokeWidth="2" />
            <path d="M800 390C860 390 860 340 920 340" stroke="#1E3A5F" strokeWidth="2" />
            <path d="M970 140L970 245" stroke="#374151" strokeWidth="1.5" />
            <path d="M1090 132L1170 56" stroke="#374151" strokeWidth="1.5" />
            <path d="M1130 310L1188 310" stroke="#FF2D55" strokeWidth="1.5" />
            <path d="M1130 205L1188 205" stroke="#374151" strokeWidth="1.5" />
            <path d="M970 430L970 520" stroke="#374151" strokeWidth="1.5" />
            <path d="M1065 430L1065 580" stroke="#374151" strokeWidth="1.5" />
            <path d="M1130 430L1210 560" stroke="#374151" strokeWidth="1.5" />
          </svg>

          <p className="absolute left-8 top-6 text-sm font-bold tracking-[0.15em] text-slate-300">WIZHARD NETWORK</p>

          <div className="absolute right-28 top-5 rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2">
            <p className="text-[10px] tracking-wide text-slate-400">SALES 24H</p>
            <p className="text-sm font-semibold text-slate-100">{fmtMoney(sales24h)}</p>
          </div>
          <div className="absolute right-8 top-5 rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2">
            <p className="text-[10px] tracking-wide text-slate-400">TIKTOK STORE 24H</p>
            <p className="text-sm font-semibold text-slate-100">{fmtMoney(chTikTok?.sales24hCents)}</p>
          </div>

          <StockNode
            className="absolute left-8 top-[76px] w-[140px]"
            title="ACER STORE"
            sub={`${whAcer?.refsInStock ?? '—'} SKUs`}
            href="/warehouses/acer_store"
          />
          <StockNode
            className="absolute left-[172px] top-[64px] w-[130px]"
            title="IRELAND"
            sub={`${whIreland?.refsInStock ?? '—'} SKUs`}
            href="/warehouses/ireland"
          />
          <StockNode
            className="absolute left-8 top-[272px] w-[130px]"
            title="POLAND"
            sub={`${whPoland?.refsInStock ?? '—'} SKUs`}
            href="/warehouses/poland"
          />

          <div className="absolute left-6 top-[136px] w-[300px] rounded-lg border border-slate-700 bg-slate-900/65 px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-300">WAREHOUSES</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Last scan: {lastStockScan ? <time dateTime={lastStockScan}>{fmtDate(lastStockScan)}</time> : '—'}
            </p>
          </div>

          <StockNode className="absolute left-8 top-[530px] w-[140px]" title="ACER" sub="EU Supplier" href="/suppliers" />
          <div className="absolute left-6 top-[430px] w-[300px] rounded-lg border border-slate-700 bg-slate-900/65 px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-300">SUPPLIERS</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Last invoice: {summary?.suppliers.lastInvoiceDate ? (
                <time dateTime={summary.suppliers.lastInvoiceDate}>{fmtDate(summary.suppliers.lastInvoiceDate)}</time>
              ) : '—'}
            </p>
          </div>

          <div className="absolute left-[528px] top-[330px] w-[310px] rounded-xl border border-blue-500/40 bg-slate-900/90 px-5 py-4 shadow-[0_0_40px_rgba(37,99,235,0.22)]">
            <p className="text-sm font-semibold tracking-wide text-blue-300">WIZHARD</p>
            <p className="mt-3 text-[13px] text-slate-100">{summary?.wizhard.productsToFill ?? '—'} products to fill</p>
            <p className="text-[12px] text-slate-300">{summary?.readyToPush.count ?? '—'} products to push</p>
          </div>

          <div className="absolute left-[350px] top-[270px]">
            <ActionButton label={scanning ? 'SCANNING' : 'SCAN'} icon="↻" onClick={handleScanStocks} disabled={scanning} />
          </div>
          <div className="absolute left-[846px] top-[368px]">
            <ActionButton label={pushing ? 'PUSHING' : 'PUSH PRODUCTS'} icon="→" onClick={handleUpdateChannels} disabled={pushing} />
          </div>

          <div className="absolute left-[906px] top-[255px] w-[246px] rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wide text-slate-300">SALE CHANNELS</p>
            <p className="mt-2 text-[11px] text-slate-200">{chKomp?.googleAdsCampaignsProgrammed ?? 0} Google Ads programmed</p>
            <p className="text-[11px] text-slate-200">{chTikTok?.googleAdsCampaignsProgrammed ?? 0} TikTok Ads programmed</p>
          </div>

          <StockNode className="absolute left-[900px] top-[92px] w-[148px]" title="COINCART" sub="WooCommerce" href="/channels/woocommerce" />
          <StockNode
            className="absolute left-[1068px] top-[78px] w-[160px]"
            title="KOMPUTERZZ"
            sub={`Shopify · ${chKomp?.googleAdsCampaignsProgrammed ?? 0} Google Ads`}
            href="/channels/shopify_komputerzz"
          />
          <StockNode
            className="absolute left-[1204px] top-[285px] w-[164px]"
            title="TIKTOK TECH STORE"
            sub={`by ACER · ${chTikTok?.googleAdsCampaignsProgrammed ?? 0} TT Ads`}
            href="/channels/shopify_tiktok"
          />
          <StockNode className="absolute left-[1232px] top-[174px] w-[96px]" title="EBAY" sub={chEbay ? 'API' : '—'} href="/channels/ebay_ie" />
          <StockNode className="absolute left-[898px] top-[570px] w-[130px]" title="AMAZON" sub={chAmazon ? 'API' : '—'} />
          <StockNode className="absolute left-[1056px] top-[624px] w-[148px]" title="LIBRE MARKET" sub="Browser" href="/channels/libre_market" />
          <StockNode className="absolute left-[1228px] top-[584px] w-[130px]" title="XMR BAZAAR" sub={chXmr ? 'Browser' : '—'} href="/channels/xmr_bazaar" />

          {(isLoading || scanProgressText || scanError || pushError || isError) && (
            <div className="absolute bottom-4 left-8 right-8 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs text-slate-300">
              {isLoading ? <p>Loading dashboard data...</p> : null}
              {scanProgressText ? <p>{scanProgressText}</p> : null}
              {scanError ? <p className="text-rose-400">Scan error: {scanError}</p> : null}
              {pushError ? <p className="text-rose-400">Push error: {pushError}</p> : null}
              {isError ? <p className="text-rose-400">Summary unavailable. Check API/database.</p> : null}
            </div>
          )}
        </div>
      </div>

      <div className="lg:hidden space-y-3">
        <div className="rounded-xl border border-slate-700 bg-[#060D1F] p-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-300">WIZHARD NETWORK</p>
          <p className="mt-2 text-sm text-slate-100">
            {summary?.wizhard.productsToFill ?? '—'} products to fill · {summary?.readyToPush.count ?? '—'} to push
          </p>
          <p className="mt-1 text-xs text-slate-400">Sales 24h: {fmtMoney(sales24h)}</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <StockNode title="Warehouses" sub={`Last scan: ${lastStockScan ? fmtDate(lastStockScan) : '—'}`} />
          <StockNode title="Suppliers" sub={`Last invoice: ${fmtDate(summary?.suppliers.lastInvoiceDate)}`} href="/suppliers" />
          <StockNode title="Sale Channels" sub={`${channels.length} channels`} href="/channels" />
        </div>

        <div className="flex flex-wrap gap-2">
          <ActionButton label={scanning ? 'SCANNING' : 'SCAN'} icon="↻" onClick={handleScanStocks} disabled={scanning} />
          <ActionButton label={pushing ? 'PUSHING' : 'PUSH PRODUCTS'} icon="→" onClick={handleUpdateChannels} disabled={pushing} />
        </div>
      </div>

      {scanResult?.length ? (
        <div className="rounded-md border border-border bg-card p-3 text-xs space-y-1">
          {scanResult.map((r) => (
            <p key={r.warehouseId} className={r.errors.length > 0 ? 'text-destructive' : 'text-emerald-700'}>
              {r.warehouseId}: {r.errors[0] ?? `${r.productsUpdated} refs updated`}
            </p>
          ))}
        </div>
      ) : null}

      {pushResult?.length ? (
        <div className="rounded-md border border-border bg-card p-3 text-xs space-y-1">
          {pushResult.map((r) => (
            <p key={r.platform}>
              {r.platform}: {r.errors[0] ?? `${r.statusUpdated} updated | ${r.newProductsCreated} new | ${r.zeroedOutOfStock} zeroed`}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
