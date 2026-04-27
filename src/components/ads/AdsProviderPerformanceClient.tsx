'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/utils/api-fetch'

type ProviderId = 'google_ads' | 'x_ads' | 'tiktok_ads'

type CuratedRow = {
  campaignPk: number
  campaignName: string
  providerId: ProviderId
  accountName: string
  productSku: string
  spendCents: number
  impressions: number
  clicks: number
  providerConversions: number
  shopifyOrders: number
  shopifyNetRevenueCents: number
}

type CreativeRow = {
  creativeKey: string
  creativeName: string | null
  spendCents: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number | null
  cpcCents: number | null
}

type CuratedResponse = {
  data: {
    rows: CuratedRow[]
    summary: {
      spendCents: number
      impressions: number
      clicks: number
      providerConversions: number
      shopifyOrders: number
      shopifyNetRevenueCents: number
      ctr: number | null
      cpcCents: number | null
      cpaCents: number | null
      roas: number | null
    }
    topWinningCreatives: CreativeRow[]
    topLosingCreatives: CreativeRow[]
  }
}

type CampaignPerf = {
  campaignPk: number
  campaignName: string
  providerId: ProviderId
  accountName: string
  productSku: string
  spendCents: number
  impressions: number
  clicks: number
  providerConversions: number
  shopifyOrders: number
  shopifyNetRevenueCents: number
  ctr: number | null
  cpcCents: number | null
  cpaCents: number | null
  roas: number | null
}

const PROVIDER_META: Record<ProviderId, { label: string; href: string }> = {
  google_ads: { label: 'Google Ads', href: '/ads/performance/google-ads' },
  x_ads: { label: 'X Ads', href: '/ads/performance/x-ads' },
  tiktok_ads: { label: 'TikTok Ads', href: '/ads/performance/tiktok-ads' },
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function fromYmd(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

function money(cents: number | null | undefined): string {
  return `EUR ${(((cents ?? 0) as number) / 100).toFixed(2)}`
}

export function AdsProviderPerformanceClient({ providerId }: { providerId: ProviderId }) {
  const [from, setFrom] = useState(fromYmd(30))
  const [to, setTo] = useState(todayYmd())

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ads-performance', providerId, from, to],
    queryFn: () => apiFetch<CuratedResponse>(`/api/ads/analytics/curated?providerId=${providerId}&from=${from}&to=${to}`),
  })

  const rows = data?.data.rows
  const summary = data?.data.summary

  const byCampaign = useMemo(() => {
    const map = new Map<number, CampaignPerf>()
    for (const row of rows ?? []) {
      const current = map.get(row.campaignPk) ?? {
        campaignPk: row.campaignPk,
        campaignName: row.campaignName,
        providerId: row.providerId,
        accountName: row.accountName,
        productSku: row.productSku,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        providerConversions: 0,
        shopifyOrders: 0,
        shopifyNetRevenueCents: 0,
        ctr: null,
        cpcCents: null,
        cpaCents: null,
        roas: null,
      }
      current.spendCents += row.spendCents
      current.impressions += row.impressions
      current.clicks += row.clicks
      current.providerConversions += row.providerConversions
      current.shopifyOrders += row.shopifyOrders
      current.shopifyNetRevenueCents += row.shopifyNetRevenueCents
      map.set(row.campaignPk, current)
    }

    const result = Array.from(map.values())
    for (const r of result) {
      r.ctr = r.impressions > 0 ? r.clicks / r.impressions : null
      r.cpcCents = r.clicks > 0 ? Math.round(r.spendCents / r.clicks) : null
      r.cpaCents = r.providerConversions > 0 ? Math.round(r.spendCents / r.providerConversions) : null
      r.roas = r.spendCents > 0 ? r.shopifyNetRevenueCents / r.spendCents : null
    }
    result.sort((a, b) => b.spendCents - a.spendCents)
    return result
  }, [rows])

  const isXAds = providerId === 'x_ads'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">{PROVIDER_META[providerId].label} Performance</h1>
          <p className="text-xs text-muted-foreground">
            {isXAds ? 'Paid engagement metrics and promoted tweet breakdowns.' : 'Campaign metrics for this provider.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['google_ads', 'x_ads', 'tiktok_ads'] as ProviderId[]).map((id) => (
            <Link
              key={id}
              href={PROVIDER_META[id].href}
              className={`text-xs border rounded px-2 py-1 ${id === providerId ? 'border-slate-500 bg-slate-100 text-slate-900' : 'border-border'}`}
            >
              {PROVIDER_META[id].label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-background" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-background" />
        <button onClick={() => refetch()} className="text-xs border border-border rounded px-2 py-1" disabled={isFetching}>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading performance...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="border border-border rounded p-3">
              <div className="text-[11px] text-muted-foreground">Spend</div>
              <div className="text-sm font-medium">{money(summary?.spendCents)}</div>
            </div>
            <div className="border border-border rounded p-3">
              <div className="text-[11px] text-muted-foreground">Impressions</div>
              <div className="text-sm font-medium">{summary?.impressions ?? 0}</div>
            </div>
            <div className="border border-border rounded p-3">
              <div className="text-[11px] text-muted-foreground">Clicks</div>
              <div className="text-sm font-medium">{summary?.clicks ?? 0}</div>
            </div>
            <div className="border border-border rounded p-3">
              <div className="text-[11px] text-muted-foreground">CTR</div>
              <div className="text-sm font-medium">{summary?.ctr == null ? '-' : `${(summary.ctr * 100).toFixed(2)}%`}</div>
            </div>
            <div className="border border-border rounded p-3">
              <div className="text-[11px] text-muted-foreground">CPC</div>
              <div className="text-sm font-medium">{summary?.cpcCents == null ? '-' : money(summary.cpcCents)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 border border-border rounded overflow-x-auto">
              <table className="min-w-[900px] w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-2">Campaign</th>
                    <th className="px-2 py-2">Account</th>
                    <th className="px-2 py-2">SKU</th>
                    <th className="px-2 py-2">Spend</th>
                    <th className="px-2 py-2">Impressions</th>
                    <th className="px-2 py-2">Clicks</th>
                    <th className="px-2 py-2">CTR</th>
                    <th className="px-2 py-2">CPC</th>
                    {!isXAds && <th className="px-2 py-2">ROAS</th>}
                  </tr>
                </thead>
                <tbody>
                  {byCampaign.length === 0 ? (
                    <tr>
                      <td colSpan={isXAds ? 8 : 9} className="px-2 py-3 text-muted-foreground">No campaign performance rows for this period.</td>
                    </tr>
                  ) : (
                    byCampaign.map((r) => (
                      <tr key={r.campaignPk} className="border-t border-border">
                        <td className="px-2 py-2">{r.campaignName}</td>
                        <td className="px-2 py-2">{r.accountName}</td>
                        <td className="px-2 py-2">{r.productSku}</td>
                        <td className="px-2 py-2">{money(r.spendCents)}</td>
                        <td className="px-2 py-2">{r.impressions}</td>
                        <td className="px-2 py-2">{r.clicks}</td>
                        <td className="px-2 py-2">{r.ctr == null ? '-' : `${(r.ctr * 100).toFixed(2)}%`}</td>
                        <td className="px-2 py-2">{r.cpcCents == null ? '-' : money(r.cpcCents)}</td>
                        {!isXAds && <td className="px-2 py-2">{r.roas == null ? '-' : r.roas.toFixed(2)}</td>}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <div className="border border-border rounded p-3">
                <div className="text-xs font-medium mb-2">{isXAds ? 'Top Promoted Tweets' : 'Top Creatives'}</div>
                <div className="space-y-2">
                  {(data?.data.topWinningCreatives ?? []).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No creative rows for this period.</div>
                  ) : (
                    (data?.data.topWinningCreatives ?? []).map((row) => (
                      <div key={row.creativeKey} className="border border-border rounded p-2">
                        <div className="text-[11px] font-medium break-all">{row.creativeName ?? row.creativeKey}</div>
                        <div className="text-[11px] text-muted-foreground">Spend {money(row.spendCents)} | CTR {row.ctr == null ? '-' : `${(row.ctr * 100).toFixed(2)}%`}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-border rounded p-3">
                <div className="text-xs font-medium mb-2">{isXAds ? 'Weakest Promoted Tweets' : 'Weakest Creatives'}</div>
                <div className="space-y-2">
                  {(data?.data.topLosingCreatives ?? []).length === 0 ? (
                    <div className="text-xs text-muted-foreground">No creative rows for this period.</div>
                  ) : (
                    (data?.data.topLosingCreatives ?? []).map((row) => (
                      <div key={row.creativeKey} className="border border-border rounded p-2">
                        <div className="text-[11px] font-medium break-all">{row.creativeName ?? row.creativeKey}</div>
                        <div className="text-[11px] text-muted-foreground">Spend {money(row.spendCents)} | CTR {row.ctr == null ? '-' : `${(row.ctr * 100).toFixed(2)}%`}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
