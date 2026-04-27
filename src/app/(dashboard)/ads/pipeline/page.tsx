'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiPatch, apiPost } from '@/lib/utils/api-fetch'

type CampaignStatus = 'draft' | 'approved' | 'scheduled' | 'live' | 'paused' | 'completed' | 'canceled'
type ProviderId = 'google_ads' | 'x_ads' | 'tiktok_ads'
type DestinationType = 'shopify_komputerzz_product' | 'tiktok_shop_product' | 'x_promoted_tweet'

type CampaignRow = {
  campaignPk: number
  accountPk: number
  providerId: ProviderId
  accountName: string
  accountExternalId?: string | null
  accountDummyMode?: boolean
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
  promotedTweetId?: string | null
  socialPostPk?: number | null
  destinationPending: number
  targetingJson?: string | null
  trackingJson?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

type AdsAccount = {
  accountPk: number
  providerId: ProviderId
  accountName: string
  accountExternalId?: string | null
  currencyCode?: string | null
  timezone?: string | null
  status: string
  dummyMode: boolean
}

type FormState = {
  accountPk: string
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
  promotedTweetId: string
  socialPostPk: string
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
  x_ads: 'X Ads',
  tiktok_ads: 'TikTok Ads',
}

const PROVIDER_HINTS: Record<ProviderId, string> = {
  google_ads: 'Search and commerce campaigns',
  x_ads: 'Promoted tweets using an existing tweet ID or a Wizhard social post',
  tiktok_ads: 'Campaign planning surface',
}

const PROVIDER_OBJECTIVE_HINTS: Record<ProviderId, string> = {
  google_ads: 'Examples: search, shopping, traffic',
  x_ads: 'Examples: engagement, clicks, views, followers',
  tiktok_ads: 'Examples: traffic, conversion, awareness',
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

function defaultDestinationType(providerId: ProviderId): DestinationType {
  if (providerId === 'x_ads') return 'x_promoted_tweet'
  return providerId === 'tiktok_ads' ? 'tiktok_shop_product' : 'shopify_komputerzz_product'
}

function initForm(providerId: ProviderId, accounts: AdsAccount[], campaign?: CampaignRow | null): FormState {
  const providerAccounts = accounts.filter((account) => account.providerId === providerId)
  const fallbackAccount = providerAccounts[0]
  return {
    accountPk: String(campaign?.accountPk ?? fallbackAccount?.accountPk ?? ''),
    name: campaign?.name ?? '',
    objective: campaign?.objective ?? (providerId === 'x_ads' ? 'engagement' : ''),
    startAt: toDatetimeLocal(campaign?.startAt),
    endAt: toDatetimeLocal(campaign?.endAt),
    budgetMode: campaign?.budgetMode ?? 'daily',
    budgetAmountCents: campaign?.budgetAmountCents == null ? '' : String(campaign.budgetAmountCents),
    currencyCode: campaign?.currencyCode ?? fallbackAccount?.currencyCode ?? 'EUR',
    destinationType: campaign?.destinationType ?? defaultDestinationType(providerId),
    productSku: campaign?.productSku ?? '',
    destinationUrl: campaign?.destinationUrl ?? '',
    promotedTweetId: campaign?.promotedTweetId ?? '',
    socialPostPk: campaign?.socialPostPk == null ? '' : String(campaign.socialPostPk),
    targetingJson: campaign?.targetingJson ?? '',
    trackingJson: campaign?.trackingJson ?? '',
    notes: campaign?.notes ?? '',
    creativeHeadline: campaign?.creativeHeadline ?? '',
    creativePrimaryText: campaign?.creativePrimaryText ?? '',
    creativeDescription: campaign?.creativeDescription ?? '',
    creativeCta: campaign?.creativeCta ?? '',
  }
}

function parseJsonField(label: string, raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function parsePositiveInt(label: string, raw: string): number | null {
  if (!raw.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function providerModeLabel(account: AdsAccount | undefined): string {
  if (!account) return 'Unknown'
  return account.dummyMode ? 'Dummy Mode' : 'Live Mode'
}

function providerModeTone(account: AdsAccount | undefined): string {
  if (!account) return 'border-slate-300 bg-slate-100 text-slate-700'
  return account.dummyMode
    ? 'border-amber-300 bg-amber-100 text-amber-900'
    : 'border-emerald-300 bg-emerald-100 text-emerald-900'
}

function campaignTweetLabel(campaign: CampaignRow): string {
  if (campaign.promotedTweetId) return campaign.promotedTweetId
  if (campaign.socialPostPk) return `postPk ${campaign.socialPostPk}`
  return '-'
}

function accountSummary(campaign: CampaignRow): string {
  const suffix = campaign.accountExternalId ? ` (${campaign.accountExternalId})` : ''
  return `${campaign.accountName}${suffix}`
}

type CampaignModalState =
  | { mode: 'create'; providerId: ProviderId }
  | { mode: 'edit'; providerId: ProviderId; campaign: CampaignRow }

export default function AdsPipelinePage() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [scheduleAt, setScheduleAt] = useState<Record<number, string>>({})
  const [modal, setModal] = useState<CampaignModalState | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['ads-campaigns'],
    queryFn: () => apiFetch<{ data: CampaignRow[] }>('/api/ads/campaigns'),
  })

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['ads-accounts'],
    queryFn: () => apiFetch<{ data: AdsAccount[] }>('/api/ads/accounts'),
  })

  const campaigns = campaignsData?.data ?? []
  const accounts = accountsData?.data ?? []

  const campaignsByProvider = useMemo(() => {
    const map = new Map<ProviderId, CampaignRow[]>()
    for (const providerId of ['google_ads', 'x_ads', 'tiktok_ads'] as ProviderId[]) map.set(providerId, [])
    for (const campaign of campaigns) {
      const current = map.get(campaign.providerId) ?? []
      current.push(campaign)
      map.set(campaign.providerId, current)
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => new Date(a.startAt ?? a.createdAt).getTime() - new Date(b.startAt ?? b.createdAt).getTime())
    }
    return map
  }, [campaigns])

  const accountsByProvider = useMemo(() => {
    const map = new Map<ProviderId, AdsAccount[]>()
    for (const providerId of ['google_ads', 'x_ads', 'tiktok_ads'] as ProviderId[]) {
      map.set(providerId, accounts.filter((account) => account.providerId === providerId))
    }
    return map
  }, [accounts])

  const mutateStatus = useMutation({
    mutationFn: ({ campaignPk, status, scheduledFor }: { campaignPk: number; status: CampaignStatus; scheduledFor?: string }) =>
      apiPatch(`/api/ads/campaigns/${campaignPk}/status`, {
        status,
        ...(scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
        triggeredBy: 'human',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads-campaigns'] }),
  })

  const createCampaign = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost('/api/ads/campaigns', payload),
  })

  const updateCampaign = useMutation({
    mutationFn: ({ campaignPk, payload }: { campaignPk: number; payload: Record<string, unknown> }) =>
      apiPatch(`/api/ads/campaigns/${campaignPk}`, payload),
  })

  const formProviderId = modal?.providerId ?? null
  const providerAccounts = formProviderId ? (accountsByProvider.get(formProviderId) ?? []) : []
  const selectedAccount = providerAccounts.find((account) => String(account.accountPk) === form?.accountPk)
  const isSaving = createCampaign.isPending || updateCampaign.isPending || mutateStatus.isPending

  function openCreate(providerId: ProviderId) {
    setModal({ mode: 'create', providerId })
    setForm(initForm(providerId, accounts, null))
    setFormError(null)
  }

  function openEdit(campaign: CampaignRow) {
    setModal({ mode: 'edit', providerId: campaign.providerId, campaign })
    setForm(initForm(campaign.providerId, accounts, campaign))
    setFormError(null)
  }

  function closeModal() {
    setModal(null)
    setForm(null)
    setFormError(null)
  }

  function toggleExpanded(campaignPk: number) {
    setExpanded((prev) => ({ ...prev, [campaignPk]: !prev[campaignPk] }))
  }

  async function submitForm(nextStatus: 'draft' | 'approved' | 'scheduled') {
    if (!modal || !form || !formProviderId) return
    setFormError(null)

    try {
      const accountPk = parsePositiveInt('Account', form.accountPk)
      if (!accountPk) throw new Error('Account is required')
      if (!form.name.trim()) throw new Error('Campaign name is required')
      if (!form.objective.trim()) throw new Error('Objective is required')
      if (!form.productSku.trim()) throw new Error('Product SKU is required')
      if (nextStatus === 'approved' && (form.startAt || form.endAt)) {
        throw new Error('Approved is only allowed when no period is selected')
      }
      if (nextStatus === 'scheduled' && !form.startAt) {
        throw new Error('Scheduled requires a start date/time')
      }

      const targeting = parseJsonField('Targeting JSON', form.targetingJson)
      const tracking = parseJsonField('Tracking JSON', form.trackingJson)
      const budgetAmountCents = parsePositiveInt('Budget', form.budgetAmountCents)
      const socialPostPk = form.socialPostPk.trim() ? parsePositiveInt('Wizhard social postPk', form.socialPostPk) : null

      const payload: Record<string, unknown> = {
        providerId: formProviderId,
        accountPk,
        name: form.name.trim(),
        objective: form.objective.trim(),
        startAt: fromDatetimeLocal(form.startAt),
        endAt: fromDatetimeLocal(form.endAt),
        budgetMode: form.budgetMode,
        budgetAmountCents,
        currencyCode: (form.currencyCode.trim() || selectedAccount?.currencyCode || 'EUR').toUpperCase(),
        destinationType: formProviderId === 'x_ads' ? 'x_promoted_tweet' : form.destinationType,
        productSku: form.productSku.trim(),
        destinationUrl: form.destinationUrl.trim() || null,
        promotedTweetId: form.promotedTweetId.trim() || null,
        socialPostPk,
        targeting,
        tracking,
        notes: form.notes.trim() || null,
        createdBy: 'human',
      }

      if (formProviderId === 'x_ads') {
        if (!payload.promotedTweetId && !payload.socialPostPk) {
          throw new Error('X Ads campaigns require either a Tweet ID or a Wizhard social postPk')
        }
      } else if (!payload.destinationUrl) {
        throw new Error('Destination URL is required for this provider')
      }

      if (modal.mode === 'create') {
        const created = await createCampaign.mutateAsync({ ...payload, status: 'draft' })
        const createdPayload = created as { data?: { campaignPk?: number | null } }
        const campaignPk = createdPayload.data?.campaignPk ?? null
        if (!campaignPk) throw new Error('Campaign creation returned no campaign id')
        if (nextStatus !== 'draft') {
          await mutateStatus.mutateAsync({
            campaignPk,
            status: nextStatus,
            scheduledFor: nextStatus === 'scheduled' ? form.startAt : undefined,
          })
        }
      } else {
        await updateCampaign.mutateAsync({
          campaignPk: modal.campaign.campaignPk,
          payload,
        })
        await mutateStatus.mutateAsync({
          campaignPk: modal.campaign.campaignPk,
          status: nextStatus,
          scheduledFor: nextStatus === 'scheduled' ? form.startAt : undefined,
        })
      }

      await qc.invalidateQueries({ queryKey: ['ads-campaigns'] })
      closeModal()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  if (campaignsLoading || accountsLoading) {
    return <p className="text-xs text-muted-foreground">Loading ads pipeline…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">Ads Pipeline</h1>
          <p className="text-xs text-muted-foreground">Google Ads, X Ads, and TikTok Ads are managed separately. Meta Ads is hidden for now.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(['google_ads', 'x_ads', 'tiktok_ads'] as ProviderId[]).map((providerId) => {
          const rows = campaignsByProvider.get(providerId) ?? []
          const providerAccountsRows = accountsByProvider.get(providerId) ?? []
          const upcoming = rows.filter((row) => UPCOMING_STATUSES.has(row.status)).slice(0, 8)
          const history = rows
            .filter((row) => HISTORY_STATUSES.has(row.status))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 4)

          return (
            <section key={providerId} className="border border-border rounded p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium">{PROVIDER_LABELS[providerId]}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{PROVIDER_HINTS[providerId]}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {providerAccountsRows.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground">No accounts configured</span>
                    ) : (
                      providerAccountsRows.map((account) => (
                        <span key={account.accountPk} className={`text-[10px] px-1.5 py-0.5 rounded border ${providerModeTone(account)}`}>
                          {account.accountName}: {providerModeLabel(account)}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <button
                  className="text-xs px-2 py-1 rounded border border-slate-400 bg-white disabled:opacity-50"
                  disabled={providerAccountsRows.length === 0}
                  onClick={() => openCreate(providerId)}
                >
                  New
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">Upcoming</div>
                <div className="space-y-2">
                  {upcoming.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No upcoming campaigns</span>
                  ) : (
                    upcoming.map((campaign) => (
                      <article
                        key={campaign.campaignPk}
                        className="border border-slate-200 bg-slate-50 rounded p-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium truncate" title={campaign.name}>{campaign.name}</div>
                            <div className="text-[10px] text-muted-foreground">{accountSummary(campaign)}</div>
                          </div>
                          {campaign.accountDummyMode && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-900">
                              Dummy
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-[10px]">Status: {campaign.status}</div>
                        <div className="text-[10px]">Objective: {campaign.objective}</div>
                        <div className="text-[10px]">Start: {fmtDate(campaign.startAt)}</div>
                        <div className="text-[10px]">Budget: {campaign.budgetMode} | {fmtMoney(campaign.budgetAmountCents, campaign.currencyCode)}</div>
                        <div className="text-[10px]">
                          Product: {campaign.productSku ?? '-'} | {campaign.destinationPending ? 'Pending' : 'Ready'}
                        </div>
                        {providerId === 'x_ads' && (
                          <div className="text-[10px]">Tweet: {campaignTweetLabel(campaign)}</div>
                        )}

                        <div className="mt-2 flex flex-wrap gap-1">
                          <button className="text-[10px] px-1.5 py-0.5 rounded border border-slate-400 bg-white" onClick={() => openEdit(campaign)}>
                            Edit
                          </button>
                          <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400 bg-blue-100"
                            onClick={() => toggleExpanded(campaign.campaignPk)}
                          >
                            {expanded[campaign.campaignPk] ? 'Hide' : 'Details'}
                          </button>
                        </div>

                        {expanded[campaign.campaignPk] && (
                          <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                            <div className="text-[10px] break-all">Destination URL: {campaign.destinationUrl ?? '-'}</div>
                            {providerId === 'x_ads' && <div className="text-[10px] break-all">Tweet reference: {campaignTweetLabel(campaign)}</div>}
                            <div className="text-[10px] break-all">Targeting JSON: {campaign.targetingJson ?? '-'}</div>
                            <div className="text-[10px] break-all">Tracking JSON: {campaign.trackingJson ?? '-'}</div>
                            <div className="text-[10px] break-all">Notes: {campaign.notes ?? '-'}</div>
                            <div className="pt-1 flex flex-wrap gap-1 items-center">
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-green-400 bg-green-200"
                                onClick={() => mutateStatus.mutate({ campaignPk: campaign.campaignPk, status: 'approved' })}
                              >
                                Approve
                              </button>
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 bg-red-200"
                                onClick={() => mutateStatus.mutate({ campaignPk: campaign.campaignPk, status: 'canceled' })}
                              >
                                Cancel
                              </button>
                              <input
                                type="datetime-local"
                                className="text-[10px] border border-border rounded px-1 py-0.5 bg-background"
                                value={scheduleAt[campaign.campaignPk] ?? ''}
                                onChange={(e) => setScheduleAt((prev) => ({ ...prev, [campaign.campaignPk]: e.target.value }))}
                              />
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400 bg-blue-200"
                                onClick={() => {
                                  const when = scheduleAt[campaign.campaignPk]
                                  if (!when) return
                                  mutateStatus.mutate({ campaignPk: campaign.campaignPk, status: 'scheduled', scheduledFor: when })
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

              <div className="space-y-2 border-t border-border pt-2">
                <div className="text-[11px] text-muted-foreground">Recent history</div>
                <div className="space-y-2">
                  {history.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No campaign history</span>
                  ) : (
                    history.map((campaign) => (
                      <article key={campaign.campaignPk} className="border border-blue-300 bg-blue-100 rounded p-2">
                        <div className="text-[11px] font-medium truncate" title={campaign.name}>{campaign.name}</div>
                        <div className="text-[10px] text-muted-foreground">{accountSummary(campaign)}</div>
                        <div className="text-[10px] mt-1">Status: {campaign.status}</div>
                        <div className="text-[10px]">Provider ID: {campaign.providerCampaignId ?? '-'}</div>
                        <div className="text-[10px]">Updated: {fmtDate(campaign.updatedAt)}</div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      {modal && form && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {modal.mode === 'create' ? `New ${PROVIDER_LABELS[modal.providerId]} Campaign` : `Edit Campaign #${modal.campaign.campaignPk}`}
                </h2>
                <p className="text-xs text-muted-foreground">{PROVIDER_OBJECTIVE_HINTS[modal.providerId]}</p>
              </div>
              {selectedAccount && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${providerModeTone(selectedAccount)}`}>
                  {providerModeLabel(selectedAccount)}
                </span>
              )}
            </div>

            {formError && (
              <div className="text-xs border border-red-300 bg-red-50 text-red-800 rounded px-2 py-2">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select
                className="text-xs border border-border rounded px-2 py-1 bg-background"
                value={form.accountPk}
                onChange={(e) => {
                  const nextAccount = providerAccounts.find((account) => String(account.accountPk) === e.target.value)
                  setForm((prev) => prev ? {
                    ...prev,
                    accountPk: e.target.value,
                    currencyCode: nextAccount?.currencyCode ?? prev.currencyCode,
                  } : prev)
                }}
              >
                <option value="">Select account</option>
                {providerAccounts.map((account) => (
                  <option key={account.accountPk} value={account.accountPk}>
                    {account.accountName}
                  </option>
                ))}
              </select>
              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Campaign name" value={form.name} onChange={(e) => setForm((prev) => prev ? { ...prev, name: e.target.value } : prev)} />

              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Objective" value={form.objective} onChange={(e) => setForm((prev) => prev ? { ...prev, objective: e.target.value } : prev)} />
              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Product SKU" value={form.productSku} onChange={(e) => setForm((prev) => prev ? { ...prev, productSku: e.target.value } : prev)} />

              <input type="datetime-local" className="text-xs border border-border rounded px-2 py-1" value={form.startAt} onChange={(e) => setForm((prev) => prev ? { ...prev, startAt: e.target.value } : prev)} />
              <input type="datetime-local" className="text-xs border border-border rounded px-2 py-1" value={form.endAt} onChange={(e) => setForm((prev) => prev ? { ...prev, endAt: e.target.value } : prev)} />

              <select className="text-xs border border-border rounded px-2 py-1 bg-background" value={form.budgetMode} onChange={(e) => setForm((prev) => prev ? { ...prev, budgetMode: e.target.value as 'daily' | 'lifetime' } : prev)}>
                <option value="daily">Daily budget</option>
                <option value="lifetime">Lifetime budget</option>
              </select>
              <input type="number" min="1" className="text-xs border border-border rounded px-2 py-1" placeholder="Budget (cents)" value={form.budgetAmountCents} onChange={(e) => setForm((prev) => prev ? { ...prev, budgetAmountCents: e.target.value } : prev)} />

              <input className="text-xs border border-border rounded px-2 py-1" placeholder="Currency" value={form.currencyCode} onChange={(e) => setForm((prev) => prev ? { ...prev, currencyCode: e.target.value } : prev)} />
              {modal.providerId !== 'x_ads' ? (
                <select className="text-xs border border-border rounded px-2 py-1 bg-background" value={form.destinationType} onChange={(e) => setForm((prev) => prev ? { ...prev, destinationType: e.target.value as DestinationType } : prev)}>
                  <option value="shopify_komputerzz_product">shopify_komputerzz_product</option>
                  <option value="tiktok_shop_product">tiktok_shop_product</option>
                </select>
              ) : (
                <div className="text-xs border border-border rounded px-2 py-1 bg-muted/20 flex items-center">
                  Destination type: x_promoted_tweet
                </div>
              )}

              {modal.providerId === 'x_ads' ? (
                <>
                  <input className="text-xs border border-border rounded px-2 py-1" placeholder="Existing Tweet ID" value={form.promotedTweetId} onChange={(e) => setForm((prev) => prev ? { ...prev, promotedTweetId: e.target.value } : prev)} />
                  <input className="text-xs border border-border rounded px-2 py-1" placeholder="Wizhard social postPk" value={form.socialPostPk} onChange={(e) => setForm((prev) => prev ? { ...prev, socialPostPk: e.target.value } : prev)} />
                </>
              ) : (
                <>
                  <input className="text-xs border border-border rounded px-2 py-1 md:col-span-2" placeholder="Destination URL" value={form.destinationUrl} onChange={(e) => setForm((prev) => prev ? { ...prev, destinationUrl: e.target.value } : prev)} />
                </>
              )}
            </div>

            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Creative headline" value={form.creativeHeadline} onChange={(e) => setForm((prev) => prev ? { ...prev, creativeHeadline: e.target.value } : prev)} />
            <textarea className="w-full min-h-[90px] text-xs border border-border rounded px-2 py-1" placeholder="Primary ad text" value={form.creativePrimaryText} onChange={(e) => setForm((prev) => prev ? { ...prev, creativePrimaryText: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Creative description" value={form.creativeDescription} onChange={(e) => setForm((prev) => prev ? { ...prev, creativeDescription: e.target.value } : prev)} />
            <input className="w-full text-xs border border-border rounded px-2 py-1" placeholder="CTA" value={form.creativeCta} onChange={(e) => setForm((prev) => prev ? { ...prev, creativeCta: e.target.value } : prev)} />

            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1 font-mono" placeholder="Targeting JSON" value={form.targetingJson} onChange={(e) => setForm((prev) => prev ? { ...prev, targetingJson: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1 font-mono" placeholder="Tracking JSON" value={form.trackingJson} onChange={(e) => setForm((prev) => prev ? { ...prev, trackingJson: e.target.value } : prev)} />
            <textarea className="w-full min-h-[70px] text-xs border border-border rounded px-2 py-1" placeholder="Notes" value={form.notes} onChange={(e) => setForm((prev) => prev ? { ...prev, notes: e.target.value } : prev)} />

            {modal.providerId === 'x_ads' && (
              <div className="text-xs border border-amber-300 bg-amber-50 text-amber-900 rounded px-2 py-2">
                X Ads is currently running in dummy mode until real Ads API access is available. Scheduling and performance screens work inside Wizhard; live publish/import will be wired once access is granted.
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-slate-400" onClick={() => submitForm('draft')}>
                Save as draft
              </button>
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-green-400 bg-green-200" onClick={() => submitForm('approved')}>
                Save as approved
              </button>
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-blue-400 bg-blue-200" onClick={() => submitForm('scheduled')}>
                Save as scheduled
              </button>
              <button disabled={isSaving} className="text-xs px-2 py-1 rounded border border-border" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
