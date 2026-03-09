'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'

type CampaignStatus = 'draft' | 'approved' | 'scheduled' | 'live' | 'paused' | 'completed' | 'canceled'
type ProviderId = 'google_ads' | 'meta_ads' | 'tiktok_ads'
type DestinationType = 'shopify_komputerzz_product' | 'tiktok_shop_product'

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
  destinationType?: DestinationType | null
  productSku?: string | null
  productImageUrl?: string | null
  creativePrimaryText?: string | null
  creativeHeadline?: string | null
  creativeDescription?: string | null
  creativeCta?: string | null
  destinationUrl?: string | null
  destinationPending: number
  targetingJson?: string | null
  trackingJson?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

interface EditFormState {
  name: string
  objective: string
  startAt: string
  endAt: string
  budgetMode: 'daily' | 'lifetime'
  budgetAmountCents: string
  currencyCode: string
  destinationType: DestinationType
  productSku: string
  destinationUrl: string
  targetingJson: string
  trackingJson: string
  notes: string
  creativeHeadline: string
  creativePrimaryText: string
  creativeDescription: string
  creativeCta: string
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

function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

function initEditForm(c: CampaignRow): EditFormState {
  return {
    name: c.name,
    objective: c.objective,
    startAt: toDatetimeLocal(c.startAt),
    endAt: toDatetimeLocal(c.endAt),
    budgetMode: c.budgetMode,
    budgetAmountCents: c.budgetAmountCents == null ? '' : String(c.budgetAmountCents),
    currencyCode: c.currencyCode ?? 'EUR',
    destinationType: c.destinationType ?? 'shopify_komputerzz_product',
    productSku: c.productSku ?? '',
    destinationUrl: c.destinationUrl ?? '',
    targetingJson: c.targetingJson ?? '',
    trackingJson: c.trackingJson ?? '',
    notes: c.notes ?? '',
    creativeHeadline: c.creativeHeadline ?? '',
    creativePrimaryText: c.creativePrimaryText ?? '',
    creativeDescription: c.creativeDescription ?? '',
    creativeCta: c.creativeCta ?? '',
  }
}

export default function AdsPage() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [scheduleAt, setScheduleAt] = useState<Record<number, string>>({})
  const [editingCampaign, setEditingCampaign] = useState<CampaignRow | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['ads-campaigns'],
    queryFn: () => apiFetch<{ data: CampaignRow[] }>('/api/ads/campaigns'),
  })

  const campaigns = data?.data

  const byProvider = useMemo(() => {
    const map = new Map<ProviderId, CampaignRow[]>()
    const keys: ProviderId[] = ['google_ads', 'meta_ads', 'tiktok_ads']
    for (const k of keys) map.set(k, [])
    for (const c of campaigns ?? []) {
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

  const mutateCampaign = useMutation({
    mutationFn: ({ campaignPk, payload }: { campaignPk: number; payload: Record<string, unknown> }) =>
      apiPatch(`/api/ads/campaigns/${campaignPk}`, payload),
  })

  function toggle(campaignPk: number) {
    setExpanded((prev) => ({ ...prev, [campaignPk]: !prev[campaignPk] }))
  }

  function openEdit(campaign: CampaignRow) {
    setEditingCampaign(campaign)
    setEditForm(initEditForm(campaign))
  }

  function closeEdit() {
    setEditingCampaign(null)
    setEditForm(null)
  }

  async function saveFromEditor(nextStatus: 'draft' | 'approved' | 'scheduled') {
    if (!editingCampaign || !editForm) return

    if (!editForm.productSku.trim()) {
      alert('Product SKU is required.')
      return
    }

    if (nextStatus === 'approved' && (editForm.startAt || editForm.endAt)) {
      alert('Approved is only allowed when no period is selected.')
      return
    }

    if (nextStatus === 'scheduled' && !editForm.startAt) {
      alert('Scheduled requires a start date/time.')
      return
    }

    let targeting: Record<string, unknown> | null = null
    let tracking: Record<string, unknown> | null = null

    try {
      targeting = editForm.targetingJson.trim() ? JSON.parse(editForm.targetingJson) : null
    } catch {
      alert('Targeting must be valid JSON.')
      return
    }

    try {
      tracking = editForm.trackingJson.trim() ? JSON.parse(editForm.trackingJson) : null
    } catch {
      alert('Tracking must be valid JSON.')
      return
    }

    const payload = {
      name: editForm.name.trim(),
      objective: editForm.objective.trim(),
      startAt: fromDatetimeLocal(editForm.startAt),
      endAt: fromDatetimeLocal(editForm.endAt),
      budgetMode: editForm.budgetMode,
      budgetAmountCents: editForm.budgetAmountCents.trim() ? Number(editForm.budgetAmountCents) : null,
      currencyCode: editForm.currencyCode.trim().toUpperCase() || 'EUR',
      destinationType: editForm.destinationType,
      productSku: editForm.productSku.trim(),
      destinationUrl: editForm.destinationUrl.trim() || null,
      targeting,
      tracking,
      notes: editForm.notes.trim() || null,
      creativeHeadline: editForm.creativeHeadline.trim() || null,
      creativePrimaryText: editForm.creativePrimaryText.trim() || null,
      creativeDescription: editForm.creativeDescription.trim() || null,
      creativeCta: editForm.creativeCta.trim() || null,
    }

    if (payload.name.length === 0 || payload.objective.length === 0) {
      alert('Name and objective are required.')
      return
    }

    if (payload.budgetAmountCents != null && (!Number.isFinite(payload.budgetAmountCents) || payload.budgetAmountCents < 0)) {
      alert('Budget amount must be a valid positive number (in cents).')
      return
    }

    await mutateCampaign.mutateAsync({ campaignPk: editingCampaign.campaignPk, payload })

    const scheduledFor = nextStatus === 'scheduled' ? editForm.startAt : undefined
    await mutateStatus.mutateAsync({ campaignPk: editingCampaign.campaignPk, status: nextStatus, scheduledFor })

    await qc.invalidateQueries({ queryKey: ['ads-campaigns'] })
    closeEdit()
  }

  const isSaving = mutateCampaign.isPending || mutateStatus.isPending

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
                            <div className="text-[10px]">Budget: {c.budgetMode} | {fmtMoney(c.budgetAmountCents, c.currencyCode)}</div>
                            <div className="text-[10px]">
                              Dest: {c.destinationType ?? '-'} | {c.productSku ?? '-'} | {c.destinationPending ? 'pending' : 'ready'}
                            </div>
                            {c.status !== 'live' && (
                              <button
                                className="mt-1 text-[10px] px-1.5 py-0.5 rounded border border-slate-400 bg-white"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEdit(c)
                                }}
                              >
                                Edit
                              </button>
                            )}

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
                            {c.status !== 'live' && (
                              <button
                                className="mt-1 text-[10px] px-1.5 py-0.5 rounded border border-slate-400 bg-white"
                                onClick={() => openEdit(c)}
                              >
                                Edit
                              </button>
                            )}
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

      {editingCampaign && editForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Edit Campaign #{editingCampaign.campaignPk}</h2>
              <button className="text-xs border border-border rounded px-2 py-1" onClick={closeEdit}>Close</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Campaign name" value={editForm.name} onChange={(e) => setEditForm((prev) => prev ? { ...prev, name: e.target.value } : prev)} />
              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Objective" value={editForm.objective} onChange={(e) => setEditForm((prev) => prev ? { ...prev, objective: e.target.value } : prev)} />

              <input type="datetime-local" className="text-xs border border-border rounded px-2 py-1" value={editForm.startAt} onChange={(e) => setEditForm((prev) => prev ? { ...prev, startAt: e.target.value } : prev)} />
              <input type="datetime-local" className="text-xs border border-border rounded px-2 py-1" value={editForm.endAt} onChange={(e) => setEditForm((prev) => prev ? { ...prev, endAt: e.target.value } : prev)} />

              <select className="text-xs border border-border rounded px-2 py-1 bg-background" value={editForm.budgetMode} onChange={(e) => setEditForm((prev) => prev ? { ...prev, budgetMode: e.target.value as 'daily' | 'lifetime' } : prev)}>
                <option value="daily">daily</option>
                <option value="lifetime">lifetime</option>
              </select>
              <input type="number" min="0" className="text-xs border border-border rounded px-2 py-1" placeholder="Budget (cents)" value={editForm.budgetAmountCents} onChange={(e) => setEditForm((prev) => prev ? { ...prev, budgetAmountCents: e.target.value } : prev)} />

              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Currency (EUR)" value={editForm.currencyCode} onChange={(e) => setEditForm((prev) => prev ? { ...prev, currencyCode: e.target.value } : prev)} />
              <select className="text-xs border border-border rounded px-2 py-1 bg-background" value={editForm.destinationType} onChange={(e) => setEditForm((prev) => prev ? { ...prev, destinationType: e.target.value as DestinationType } : prev)}>
                <option value="shopify_komputerzz_product">shopify_komputerzz_product</option>
                <option value="tiktok_shop_product">tiktok_shop_product</option>
              </select>

              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Product SKU" value={editForm.productSku} onChange={(e) => setEditForm((prev) => prev ? { ...prev, productSku: e.target.value } : prev)} />
              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Destination URL" value={editForm.destinationUrl} onChange={(e) => setEditForm((prev) => prev ? { ...prev, destinationUrl: e.target.value } : prev)} />
            </div>

            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Ad headline" value={editForm.creativeHeadline} onChange={(e) => setEditForm((prev) => prev ? { ...prev, creativeHeadline: e.target.value } : prev)} />
            <textarea className="w-full min-h-[90px] text-xs border border-border rounded px-2 py-1" placeholder="Ad text" value={editForm.creativePrimaryText} onChange={(e) => setEditForm((prev) => prev ? { ...prev, creativePrimaryText: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Ad description" value={editForm.creativeDescription} onChange={(e) => setEditForm((prev) => prev ? { ...prev, creativeDescription: e.target.value } : prev)} />
            <input className="w-full text-xs border border-border rounded px-2 py-1" placeholder="CTA" value={editForm.creativeCta} onChange={(e) => setEditForm((prev) => prev ? { ...prev, creativeCta: e.target.value } : prev)} />

            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1 font-mono" placeholder="Targeting JSON" value={editForm.targetingJson} onChange={(e) => setEditForm((prev) => prev ? { ...prev, targetingJson: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1 font-mono" placeholder="Tracking JSON" value={editForm.trackingJson} onChange={(e) => setEditForm((prev) => prev ? { ...prev, trackingJson: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Notes" value={editForm.notes} onChange={(e) => setEditForm((prev) => prev ? { ...prev, notes: e.target.value } : prev)} />

            <div className="flex flex-wrap gap-2 pt-2">
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-slate-400" onClick={() => saveFromEditor('draft')}>
                Save as draft
              </button>
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-green-400 bg-green-200" onClick={() => saveFromEditor('approved')}>
                Save as approved
              </button>
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-blue-400 bg-blue-200" onClick={() => saveFromEditor('scheduled')}>
                Save as scheduled
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
