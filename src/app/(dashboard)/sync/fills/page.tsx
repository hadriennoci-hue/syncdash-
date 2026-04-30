'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/utils/api-fetch'

type FillEntry = {
  id: string
  createdAt: string | null
  productId: string | null
  status: 'success' | 'error'
  triggeredBy: string
  fields: string[]
  phase: 'collection-only' | 'browser-fill' | null
  sourceUrl: string | null
  sourceLocale: string | null
  fetchLocale: string | null
  needsTranslation: boolean
  details: Record<string, unknown>
  errors: string[]
}

type FillSummaryResponse = {
  data: {
    entries: FillEntry[]
    summary: {
      total: number
      success: number
      error: number
      fieldCounts: Record<string, number>
    }
  }
}

function renderFieldCount(details: Record<string, unknown>, key: string): string | null {
  const value = details[key]
  if (typeof value === 'number') return String(value)
  return null
}

export default function AcerFillsPage() {
  const [sinceHours, setSinceHours] = useState('24')
  const [status, setStatus] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['acer-fills', sinceHours, status],
    queryFn: () => apiFetch<FillSummaryResponse>(`/api/fills/recent?sinceHours=${encodeURIComponent(sinceHours)}&status=${encodeURIComponent(status)}&limit=200`),
  })

  const entries = data?.data.entries ?? []
  const summary = data?.data.summary

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">ACER Fill Audit</h1>
          <p className="text-xs text-muted-foreground">Recent ACER fill runs by SKU, including which fields were updated.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/sync/logs?action=acer_fill" className="text-xs border border-border px-2 py-1 rounded hover:bg-accent">Raw fill logs</Link>
          <Link href="/sync" className="text-xs border border-border px-2 py-1 rounded hover:bg-accent">Back to sync</Link>
        </div>
      </div>

      <div className="flex gap-2">
        <select
          value={sinceHours}
          onChange={(e) => setSinceHours(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="6">Last 6h</option>
          <option value="24">Last 24h</option>
          <option value="72">Last 72h</option>
          <option value="168">Last 7d</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      {summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Entries</div>
            <div className="text-lg font-semibold">{summary.total}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Success</div>
            <div className="text-lg font-semibold text-green-600">{summary.success}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Errors</div>
            <div className="text-lg font-semibold text-destructive">{summary.error}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Fields Touched</div>
            <div className="text-xs text-muted-foreground">
              {Object.entries(summary.fieldCounts).length === 0
                ? 'No field updates logged'
                : Object.entries(summary.fieldCounts).map(([field, count]) => `${field} ${count}`).join(' · ')}
            </div>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Time</th>
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Status</th>
              <th className="text-left py-1.5 pr-3 font-medium">Fields</th>
              <th className="text-left py-1.5 pr-3 font-medium">Details</th>
              <th className="text-left py-1.5 font-medium">Errors</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border align-top hover:bg-accent/50">
                <td className="py-1 pr-3 text-muted-foreground">{entry.createdAt?.slice(0, 16).replace('T', ' ') ?? '-'}</td>
                <td className="py-1 pr-3 font-mono">
                  {entry.productId ? <Link href={`/products/${entry.productId}`} className="text-primary hover:underline">{entry.productId}</Link> : '-'}
                </td>
                <td className="py-1 pr-3">
                  <span className={entry.status === 'success' ? 'text-green-600' : 'text-destructive'}>{entry.status}</span>
                  {entry.phase ? <div className="text-[11px] text-muted-foreground">{entry.phase}</div> : null}
                </td>
                <td className="py-1 pr-3">
                  {entry.fields.length > 0 ? entry.fields.join(', ') : <span className="text-muted-foreground">none</span>}
                </td>
                <td className="py-1 pr-3 text-muted-foreground">
                  {[
                    renderFieldCount(entry.details, 'attributesCount') ? `attributes ${renderFieldCount(entry.details, 'attributesCount')}` : null,
                    renderFieldCount(entry.details, 'imagesUploaded') ? `images ${renderFieldCount(entry.details, 'imagesUploaded')}` : null,
                    renderFieldCount(entry.details, 'tagCount') ? `tags ${renderFieldCount(entry.details, 'tagCount')}` : null,
                    typeof entry.details.status === 'string' ? `status ${entry.details.status}` : null,
                    typeof entry.details.category === 'string' ? `category ${entry.details.category}` : null,
                  ].filter(Boolean).join(' · ') || '-'}
                </td>
                <td className="py-1 text-muted-foreground">
                  {entry.errors.length > 0 ? entry.errors.join(' | ') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
