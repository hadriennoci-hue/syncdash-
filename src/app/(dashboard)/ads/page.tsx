'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'

type CampaignStatus = 'draft' | 'approved' | 'scheduled' | 'live' | 'paused' | 'completed' | 'canceled'
type ProviderId = 'google_ads' | 'meta_ads' | 'tiktok_ads'

interface CampaignRow {
  campaignPk: number
  accountPk: number
  providerId: ProviderId
  accountName: string
  name: string
  objective: string
  status: CampaignStatus
  providerCampaignId?: string | null
  startAt?: string | null
  endAt?: string | null
  budgetMode: 'daily' | 'lifetime'
  budgetAmountCents?: number | null
  currencyCode?: string | null
  destinationType?: 'shopify_komputerzz_product' | 'tiktok_shop_product' | null
  productSku?: string | null
  productImageUrl?: string | null
  creativePrimaryText?: string | null
  creativeHeadline?: string | null
  destinationUrl?: string | null
  destinationPending: number
  targetingJson?: string | null
  trackingJson?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  tiktok_ads: 'TikTok Ads',
}

const UPCOMING_STATUSES = new Set<CampaignStatus>(['draft', 'approved', 'scheduled'])
const HISTORY_STATUSES = new Set<CampaignStatus>(['live', 'paused', 'completed', 'canceled'])

function fmtDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtMoney(cents?: number | null, ccy?: string | null): string {
  if (cents == null) return '-'
  return `${ccy ?? 'EUR'} ${(cents / 100).toFixed(2)}`
}

export default function AdsPage() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [scheduleAt, setScheduleAt] = useState<Record<number, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['ads-campaigns'],
    queryFn: () => apiFetch<{ data: CampaignRow[] }>('/api/ads/campaigns'),
  })

  const campaigns = data?.data ?? []

  const byProvider = useMemo(() => {
    const map = new Map<ProviderId, CampaignRow[]>()
    const keys: ProviderId[] = ['google_ads', 'meta_ads', 'tiktok_ads']
    for (const k of keys) map.set(k, [])
    for (const c of campaigns) {
      const arr = map.get(c.providerId) ?? []
      arr.push(c)
      map.set(c.providerId, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.startAt ?? a.createdAt).getTime() - new Date(b.startAt ?? b.createdAt).getTime())
    }
    return map
  }, [campaigns])

  const mutateStatus = useMutation({
    mutationFn: ({ campaignPk, status, scheduledFor }: { campaignPk: number; status: CampaignStatus; scheduledFor?: string }) =>
      apiPatch(`/api/ads/campaigns/${campaignPk}/status`, {
        status,
        ...(scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
        triggeredBy: 'human',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads-campaigns'] }),
  })

  function toggle(campaignPk: number) {
    setExpanded((prev) => ({ ...prev, [campaignPk]: !prev[campaignPk] }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Ads Campaigns</h1>
        <span className="text-xs text-muted-foreground">Compact cards. Click a card to show full details.</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading campaigns...</p>
      ) : (
        <div className="space-y-4">
          {(['google_ads', 'meta_ads', 'tiktok_ads'] as ProviderId[]).map((providerId) => {
            const rows = byProvider.get(providerId) ?? []
            const upcoming = rows.filter((r) => UPCOMING_STATUSES.has(r.status)).slice(0, 6)
            const history = rows
              .filter((r) => HISTORY_STATUSES.has(r.status))
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .slice(0, 2)

            return (
              <div key={providerId} className="border border-border rounded p-3 space-y-2">
                <div className="text-xs font-medium">{PROVIDER_LABELS[providerId]}</div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">Upcoming</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {upcoming.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No upcoming campaigns</span>
                      ) : (
                        upcoming.map((c) => (
                          <article
                            key={c.campaignPk}
                            className="min-w-[220px] max-w-[220px] border rounded p-2 bg-slate-50 border-slate-200 cursor-pointer"
                            onClick={() => toggle(c.campaignPk)}
                          >
                            {c.productImageUrl && (
                              <div className="w-full h-24 mb-2 rounded overflow-hidden bg-white/70">
                                <img src={c.productImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                              </div>
                            )}
                            <div className="text-[11px] font-medium truncate" title={c.name}>{c.name}</div>
                            <div className="text-[10px] text-muted-foreground">{c.accountName}</div>
                            <div className="text-[10px] mt-1">Status: {c.status}</div>
                            <div className="text-[10px]">Objective: {c.objective}</div>
                            <div className="text-[10px]">Start: {fmtDate(c.startAt)}</div>
                            <div className="text-[10px]">Budget: {c.budgetMode} • {fmtMoney(c.budgetAmountCents, c.currencyCode)}</div>
                            <div className="text-[10px]">
                              Dest: {c.destinationType ?? '-'} • {c.productSku ?? '-'} • {c.destinationPending ? 'pending' : 'ready'}
                            </div>

                            {expanded[c.campaignPk] && (
                              <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                                <div className="text-[10px]">End: {fmtDate(c.endAt)}</div>
                                <div className="text-[10px] break-all">URL: {c.destinationUrl ?? 'not set'}</div>
                                <div className="text-[10px] break-all">Targeting: {c.targetingJson ?? '-'}</div>
                                <div className="text-[10px] break-all">Tracking: {c.trackingJson ?? '-'}</div>
                                <div className="text-[10px] break-all">Notes: {c.notes ?? '-'}</div>
                                <div className="text-[10px] break-all">Ad headline: {c.creativeHeadline ?? '-'}</div>
                                <div className="text-[10px] break-all">Ad text: {c.creativePrimaryText ?? '-'}</div>

                                <div className="pt-1 flex flex-wrap gap-1">
                                  <button
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-green-400 bg-green-200"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      mutateStatus.mutate({ campaignPk: c.campaignPk, status: 'approved' })
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 bg-red-200"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      mutateStatus.mutate({ campaignPk: c.campaignPk, status: 'canceled' })
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>

                                <div className="pt-1 flex gap-1 items-center">
                                  <input
                                    type="datetime-local"
                                    className="text-[10px] border border-border rounded px-1 py-0.5 bg-background"
                                    value={scheduleAt[c.campaignPk] ?? ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setScheduleAt((prev) => ({ ...prev, [c.campaignPk]: e.target.value }))}
                                  />
                                  <button
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400 bg-blue-200"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const when = scheduleAt[c.campaignPk]
                                      if (!when) return
                                      mutateStatus.mutate({ campaignPk: c.campaignPk, status: 'scheduled', scheduledFor: when })
                                    }}
                                  >
                                    Schedule
                                  </button>
                                </div>
                              </div>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="h-full flex items-center">
                    <div className="text-[10px] text-muted-foreground px-2 py-1 rounded border border-border">NOW</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">Latest launched/completed</div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {history.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No campaign history</span>
                      ) : (
                        history.map((c) => (
                          <article key={c.campaignPk} className="min-w-[220px] max-w-[220px] border border-blue-300 bg-blue-100 rounded p-2">
                            {c.productImageUrl && (
                              <div className="w-full h-24 mb-2 rounded overflow-hidden bg-white/70">
                                <img src={c.productImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                              </div>
                            )}
                            <div className="text-[11px] font-medium truncate" title={c.name}>{c.name}</div>
                            <div className="text-[10px] text-muted-foreground">{c.accountName}</div>
                            <div className="text-[10px] mt-1">Status: {c.status}</div>
                            <div className="text-[10px]">Provider ID: {c.providerCampaignId ?? '-'}</div>
                            <div className="text-[10px]">Updated: {fmtDate(c.updatedAt)}</div>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
