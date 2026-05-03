'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch, apiPatch, apiPost } from '@/lib/utils/api-fetch'
import { requireBrowserRunnerRunning } from '@/lib/browser-runner-control'

interface ChannelConfig {
  shopDomain?:    string
  loginUrl?:      string
  newListingUrl?: string | null
  [key: string]:  unknown
}

interface Channel {
  id:            string
  name:          string
  url:           string
  connectorType: string
  enabled:       number
  config:        ChannelConfig | null
  lastPush:      string | null
  pushJob:       ChannelPushJob | null
  counts:        { synced: number; pending: number; failed: number; total: number }
  products:      Product[]
}

interface ChannelPushJob {
  id: string
  status: 'running' | 'success' | 'error' | string
  startedAt: string
  finishedAt: string | null
  touched: number
  errorsCount: number
  detail: string | null
  processedTargets: number
  totalTargets: number | null
  lastProductIds: string[]
  lastStatus: 'success' | 'error' | null
  blockedOnSku: string | null
}

interface Product {
  sku:              string
  title:            string
  pushStatus:       string
  price:            number | null
  compareAt:        number | null
  importPrice:      number | null
  importPromoPrice: number | null
  stock: {
    ireland:    number | null
    acer_store: number | null
    poland:     number | null
    dropshipping: number | null
  }
  platformId:  string | null
  syncStatus:  string | null
}

// dirty[sku] = { price?: string, compareAt?: string } — string because input values
type DirtyPrices = Record<string, { price?: string; compareAt?: string }>

const BROWSER_RUNNER_CMD = 'cd C:\\syncdash && npx tsx scripts/local-browser-runner.ts --prod --headed'

export default function ChannelPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient()
  const [dirty,       setDirty]       = useState<DirtyPrices>({})
  const [saving,      setSaving]      = useState(false)
  const [errors,      setErrors]      = useState<string[]>([])
  const [showCmd,     setShowCmd]     = useState(false)
  const [cmdCopied,   setCmdCopied]   = useState(false)
  const [browserPushNotice, setBrowserPushNotice] = useState<string | null>(null)

function handleCopyCmd() {
    navigator.clipboard.writeText(BROWSER_RUNNER_CMD).then(() => {
      setCmdCopied(true)
      setTimeout(() => setCmdCopied(false), 2000)
    })
  }

  async function handleBrowserPushClick() {
    setBrowserPushNotice(null)
    try {
      await requireBrowserRunnerRunning()
    } catch (err) {
      setShowCmd(false)
      setBrowserPushNotice(err instanceof Error ? err.message : 'Browser runner is not available')
      return
    }

    setShowCmd((v) => !v)
    try {
      await apiPost('/api/runner/wake', { runner: 'browser', reason: `channel page push (${params.id})` })
      setBrowserPushNotice('Runner wake signal sent. Push will start in the local browser runner window.')
    } catch {
      setBrowserPushNotice('Runner is up, but the wake signal could not be sent to Wizhard. Try again in a few seconds.')
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['channel', params.id],
    queryFn:  () => apiFetch(`/api/channels/${params.id}?page=1&perPage=1000`),
    refetchInterval: (query) => {
      const channel = query.state.data?.data as Channel | undefined
      return channel?.pushJob?.status === 'running' ? 5000 : false
    },
  })

  const products: Product[] = useMemo(
    () => (data?.data as Channel | undefined)?.products ?? [],
    [data]
  )

  // Pre-fill dirty state with import prices for products that have no saved channel price.
  // Promo price is channel-specific, so imported promo stays informational only.
  useEffect(() => {
    if (!products.length) return
    setDirty((prev) => {
      const next = { ...prev }
      let changed = false
      for (const p of products) {
        if ((next[p.sku]?.price === undefined) && p.price === null && p.importPrice !== null) {
          next[p.sku] = { ...next[p.sku], price: String(p.importPrice) }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [products]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyCount = Object.values(dirty).reduce((n, m) =>
    n + (m.price !== undefined ? 1 : 0) + (m.compareAt !== undefined ? 1 : 0), 0)

  const normalizeDecimalInput = (value: string) =>
    value.replace(',', '.')

  const handleChange = useCallback((sku: string, field: 'price' | 'compareAt', value: string) => {
    setDirty((prev) => ({ ...prev, [sku]: { ...prev[sku], [field]: normalizeDecimalInput(value) } }))
  }, [])

  const handleFieldDiscard = useCallback((sku: string, field: 'price' | 'compareAt') => {
    setDirty((prev) => {
      const next = { ...prev }
      if (next[sku]) {
        const row = { ...next[sku] }
        delete row[field]
        if (Object.keys(row).length === 0) delete next[sku]
        else next[sku] = row
      }
      return next
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setErrors([])
    const calls: Promise<void>[] = []
    const errs: string[] = []

    for (const [sku, fields] of Object.entries(dirty)) {
      const body: Record<string, unknown> = { platforms: [params.id], triggeredBy: 'human' }
      if (fields.price !== undefined) {
        const n = parseFloat(fields.price); if (!isNaN(n) && n > 0) body.price = n
      }
      if (fields.compareAt !== undefined) {
        const raw = fields.compareAt.trim()
        if (raw === '') {
          body.compareAt = null
        } else {
          const n = parseFloat(raw)
          if (!isNaN(n) && n > 0) body.compareAt = n
        }
      }
      if (body.price !== undefined || body.compareAt !== undefined) {
        calls.push(apiPatch(`/api/products/${sku}/prices`, body).catch(() => { errs.push(sku) }))
      }
    }

    await Promise.all(calls)
    setSaving(false)

    if (errs.length === 0) {
      setDirty({})
      qc.invalidateQueries({ queryKey: ['channel', params.id] })
    } else {
      setErrors([...new Set(errs)])
    }
  }

  function handleDiscard() { setDirty({}); setErrors([]) }

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>
  const c: Channel | undefined = data?.data
  if (!c) return <p className="text-xs text-destructive">Channel not found</p>

  const isBrowser       = c.connectorType === 'browser'
  const hasProductTable = !isBrowser || products.length > 0
  const pushJob = c.pushJob
  const pushJobStarted = pushJob?.startedAt ? new Date(pushJob.startedAt) : null
  const pushJobElapsedMinutes = pushJobStarted
    ? Math.max(0, Math.round((Date.now() - pushJobStarted.getTime()) / 60000))
    : null

  return (
    <div className="space-y-3 w-full max-w-none pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-semibold">{c.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{c.id}</p>
          <a href={c.url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-mono">{c.url}</a>
        </div>

        <div className="flex gap-6 items-start">
          {!isBrowser && (
            <div className="flex gap-4 text-xs pt-1">
              <span className="text-amber-500">{c.counts?.pending ?? 0} pending</span>
              <span className="text-green-600">{c.counts?.synced ?? 0} synced</span>
              <span className="text-destructive">{c.counts?.failed ?? 0} failed</span>
              <span className="text-muted-foreground">{c.counts?.total ?? 0} total</span>
            </div>
          )}
          {isBrowser && (
            <div className="flex gap-4 text-xs pt-1 items-center">
              <span className="text-amber-500">{c.counts?.pending ?? 0} queued</span>
              <button
                onClick={handleBrowserPushClick}
                className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs hover:opacity-90"
              >
                Push
              </button>
            </div>
          )}
          <div className="border border-border rounded p-2.5 text-xs space-y-1 min-w-[200px]">
            <p className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Channel config</p>
            <ConfigRow label="Type" value={c.connectorType} />
            {c.config?.shopDomain    && <ConfigRow label="Shop"        value={String(c.config.shopDomain)} />}
            {c.config?.loginUrl      && <ConfigRow label="Login URL"   value={String(c.config.loginUrl)} link />}
            {c.config?.newListingUrl && <ConfigRow label="New listing" value={String(c.config.newListingUrl)} link />}
            <ConfigRow label="Last push" value={c.lastPush ? c.lastPush.slice(0, 16).replace('T', ' ') : '—'} />
          </div>
        </div>
      </div>

      {pushJob && (
        <div className={`border rounded p-3 text-xs space-y-2 ${
          pushJob.status === 'running'
            ? 'border-amber-400/60 bg-amber-50/40 dark:bg-amber-900/10'
            : pushJob.status === 'error'
              ? 'border-red-400/60 bg-red-50/40 dark:bg-red-900/10'
              : 'border-emerald-400/60 bg-emerald-50/40 dark:bg-emerald-900/10'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">
              Push job:{' '}
              <span className={
                pushJob.status === 'running'
                  ? 'text-amber-600'
                  : pushJob.status === 'error'
                    ? 'text-destructive'
                    : 'text-emerald-600'
              }>
                {pushJob.status}
              </span>
            </p>
            <p className="font-mono text-muted-foreground">
              {pushJobStarted ? pushJobStarted.toLocaleString() : 'â€”'}
            </p>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <p className="text-muted-foreground">
              Progress: <span className="font-mono text-foreground">{pushJob.processedTargets}/{pushJob.totalTargets ?? '?'}</span>
            </p>
            <p className="text-muted-foreground">
              Errors: <span className="font-mono text-foreground">{pushJob.errorsCount}</span>
            </p>
            <p className="text-muted-foreground">
              Current SKU: <span className="font-mono text-foreground">{pushJob.blockedOnSku ?? pushJob.lastProductIds[0] ?? 'â€”'}</span>
            </p>
            <p className="text-muted-foreground">
              Elapsed: <span className="font-mono text-foreground">{pushJobElapsedMinutes != null ? `${pushJobElapsedMinutes} min` : 'â€”'}</span>
            </p>
          </div>
          <p className="text-muted-foreground">
            {pushJob.status === 'running'
              ? 'Still running.'
              : pushJob.status === 'error'
                ? 'Blocked or finished with errors.'
                : 'Finished.'}
            {' '}
            <span className="text-foreground">{pushJob.detail ?? 'No detail available.'}</span>
          </p>
        </div>
      )}

      {isBrowser && browserPushNotice && (
        <div className={`border rounded p-3 text-xs ${
          browserPushNotice.includes('not running') || browserPushNotice.includes('not available')
            ? 'border-red-400/60 bg-red-50/40 dark:bg-red-900/10 text-destructive'
            : 'border-emerald-400/60 bg-emerald-50/40 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
        }`}>
          {browserPushNotice}
        </div>
      )}

      {/* Browser push command */}
      {isBrowser && showCmd && (
        <div className="border border-amber-400/60 bg-amber-50/40 dark:bg-amber-900/10 rounded p-3 text-xs space-y-2">
          <p className="font-medium text-amber-700 dark:text-amber-400">If the browser runner is not running yet, start it locally with:</p>
          <div className="flex items-center gap-2">
            <code className="font-mono bg-background border border-border rounded px-2 py-1 flex-1 select-all">
              {BROWSER_RUNNER_CMD}
            </code>
            <button
              onClick={handleCopyCmd}
              className="px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent whitespace-nowrap"
            >
              {cmdCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Browser channel placeholder */}
      {isBrowser && !hasProductTable && (
        <div className="border border-dashed border-border rounded p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Browser-automated channel</p>
          <p>Set products to <span className="font-mono">2push</span> to queue them for browser automation.</p>
        </div>
      )}

      {/* Product table */}
      {hasProductTable && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
                <th className="text-left py-1.5 pr-3 font-medium">Title</th>
                <th className="text-left py-1.5 pr-3 font-medium">Push</th>
                <th className="text-left py-1.5 pr-3 font-medium">Price €</th>
                <th className="text-left py-1.5 pr-3 font-medium">Promo €</th>
                <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground/60">Import €</th>
                <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground/60">Import promo</th>
                <th className="text-right py-1.5 pr-3 font-medium">IE</th>
                <th className="text-right py-1.5 pr-3 font-medium">ACER</th>
                <th className="text-right py-1.5 pr-3 font-medium">PL</th>
                <th className="text-right py-1.5 font-medium">DS</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isTwoPush  = p.pushStatus === '2push'
                const isFail     = p.pushStatus.startsWith('FAIL:')
                const hasStock   = (p.stock.ireland ?? 0) + (p.stock.acer_store ?? 0) + (p.stock.poland ?? 0) + (p.stock.dropshipping ?? 0) > 0
                const isPriority = isTwoPush && hasStock
                const rowDirty   = dirty[p.sku]

                return (
                  <tr
                    key={p.sku}
                    className={`border-b border-border hover:bg-accent/50
                      ${isPriority                          ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}
                      ${isFail                              ? 'bg-red-50/60 dark:bg-red-900/10' : ''}
                      ${errors.includes(p.sku)              ? 'bg-red-50/60 dark:bg-red-900/10' : ''}`}
                  >
                    <td className="py-1 pr-3 font-mono">
                      <Link href={`/products/${p.sku}`} className="text-primary hover:underline">{p.sku}</Link>
                    </td>
                    <td className="py-1 pr-3 max-w-[180px] truncate">{p.title}</td>
                    <td className="py-1 pr-3"><PushBadge value={p.pushStatus} /></td>
                    <td className="py-1 pr-3">
                      <PriceCell
                        value={p.price}
                        importDefault={p.importPrice}
                        draft={rowDirty?.price}
                        disabled={saving}
                        onChange={(v) => handleChange(p.sku, 'price', v)}
                        onDiscard={() => handleFieldDiscard(p.sku, 'price')}
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <PriceCell
                        value={p.compareAt}
                        importDefault={p.importPromoPrice}
                        draft={rowDirty?.compareAt}
                        disabled={saving}
                        onChange={(v) => handleChange(p.sku, 'compareAt', v)}
                        onDiscard={() => handleFieldDiscard(p.sku, 'compareAt')}
                      />
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground/70">
                      {p.importPrice != null ? `€${p.importPrice}` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground/70">
                      {p.importPromoPrice != null ? `€${p.importPromoPrice}` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono"><StockQty qty={p.stock.ireland} /></td>
                    <td className="py-1 pr-3 text-right font-mono"><StockQty qty={p.stock.acer_store} /></td>
                    <td className="py-1 pr-3 text-right font-mono"><StockQty qty={p.stock.poland} /></td>
                    <td className="py-1 text-right font-mono"><StockQty qty={p.stock.dropshipping} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky save banner */}
      {dirtyCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-background border border-border shadow-lg rounded-lg px-4 py-2.5 text-xs">
          <span className="text-amber-600 font-medium">
            {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}
          </span>
          {errors.length > 0 && (
            <span className="text-destructive">Errors on: {errors.join(', ')}</span>
          )}
          <button
            onClick={handleDiscard}
            disabled={saving}
            className="px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2.5 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving && <span className="inline-block h-3 w-3 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />}
            Save
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config row
// ---------------------------------------------------------------------------

function ConfigRow({ label, value, link }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      {link
        ? <a href={value} target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline truncate max-w-[180px]" title={value}>{value}</a>
        : <span className="font-mono truncate max-w-[180px]" title={value}>{value}</span>
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Push status badge
// ---------------------------------------------------------------------------

function PushBadge({ value }: { value: string }) {
  if (value === 'done')    return <span className="text-green-600">done</span>
  if (value === '2push')   return <span className="text-amber-500 font-medium">2push</span>
  if (value.startsWith('FAIL:')) {
    return <span className="text-destructive font-medium cursor-help" title={value}>FAIL</span>
  }
  return <span className="text-muted-foreground">{value}</span>
}

// ---------------------------------------------------------------------------
// Price cell — controlled, reports changes to parent, no internal save logic
// ---------------------------------------------------------------------------

function PriceCell({
  value, importDefault, draft, disabled, onChange, onDiscard,
}: {
  value:         number | null
  importDefault: number | null
  draft:         string | undefined
  disabled:      boolean
  onChange:      (v: string) => void
  onDiscard:     () => void
}) {
  const resolve = (v: number | null) =>
    v != null ? String(v) : importDefault != null ? String(importDefault) : ''

  const displayed        = draft ?? resolve(value)
  const isDirty          = draft !== undefined
  const isImportDefault  = draft === undefined && value == null && importDefault != null

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={displayed}
      placeholder="—"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onDiscard() }
      }}
      title={isImportDefault ? 'Import price (not yet saved for this channel)' : undefined}
      className={`w-20 text-xs border rounded px-1 py-0.5 bg-background outline-none
        ${isDirty          ? 'border-amber-400' : 'border-border'}
        ${disabled         ? 'opacity-50' : 'focus:border-primary'}
        ${isImportDefault  ? 'text-muted-foreground/60 italic' : ''}
        [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
    />
  )
}

// ---------------------------------------------------------------------------
// Stock quantity display
// ---------------------------------------------------------------------------

function StockQty({ qty }: { qty: number | null }) {
  if (qty == null || qty === 0) return <span className="text-muted-foreground/40">—</span>
  return <span className={qty > 0 ? 'text-foreground' : 'text-muted-foreground'}>{qty}</span>
}
