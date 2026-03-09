'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/utils/api-fetch'

interface CuratedRow {
  campaignPk: number
  campaignName: string
  providerId: string
  accountName: string
  productSku: string
  spendCents: number
  impressions: number
  clicks: number
  providerConversions: number
  shopifyOrders: number
  shopifyNetRevenueCents: number
}

interface CuratedResponse {
  data: {
    rows: CuratedRow[]
  }
}

interface CampaignPerf {
  campaignPk: number
  campaignName: string
  providerId: string
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

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function fromYmd(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

function money(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`
}

export default function AdsPerformancePage() {
  const [from, setFrom] = useState(fromYmd(30))
  const [to, setTo] = useState(todayYmd())

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ads-performance', from, to],
    queryFn: () => apiFetch<CuratedResponse>(`/api/ads/analytics/curated?from=${from}&to=${to}`),
  })

  const rows = data?.data.rows

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

    result.sort((a, b) => (b.roas ?? -999) - (a.roas ?? -999))
    return result
  }, [rows])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-semibold">Ads Performance</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background"
          />
          <button
            onClick={() => refetch()}
            className="text-xs border border-border rounded px-2 py-1"
            disabled={isFetching}
          >
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading performance...</p>
      ) : (
        <div className="border border-border rounded overflow-x-auto">
          <table className="min-w-[1200px] w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-2 py-2">Campaign</th>
                <th className="px-2 py-2">Provider</th>
                <th className="px-2 py-2">Account</th>
                <th className="px-2 py-2">SKU</th>
                <th className="px-2 py-2">Spend</th>
                <th className="px-2 py-2">Revenue</th>
                <th className="px-2 py-2">ROAS</th>
                <th className="px-2 py-2">Impressions</th>
                <th className="px-2 py-2">Clicks</th>
                <th className="px-2 py-2">CTR</th>
                <th className="px-2 py-2">CPC</th>
                <th className="px-2 py-2">Purchases</th>
                <th className="px-2 py-2">CPA</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-2 py-3 text-muted-foreground">No campaign performance rows for this period.</td>
                </tr>
              ) : (
                byCampaign.map((r) => (
                  <tr key={r.campaignPk} className="border-t border-border">
                    <td className="px-2 py-2">{r.campaignName}</td>
                    <td className="px-2 py-2">{r.providerId}</td>
                    <td className="px-2 py-2">{r.accountName}</td>
                    <td className="px-2 py-2">{r.productSku}</td>
                    <td className="px-2 py-2">{money(r.spendCents)}</td>
                    <td className="px-2 py-2">{money(r.shopifyNetRevenueCents)}</td>
                    <td className="px-2 py-2">{r.roas == null ? '-' : r.roas.toFixed(2)}</td>
                    <td className="px-2 py-2">{r.impressions}</td>
                    <td className="px-2 py-2">{r.clicks}</td>
                    <td className="px-2 py-2">{r.ctr == null ? '-' : `${(r.ctr * 100).toFixed(2)}%`}</td>
                    <td className="px-2 py-2">{r.cpcCents == null ? '-' : money(r.cpcCents)}</td>
                    <td className="px-2 py-2">{r.shopifyOrders}</td>
                    <td className="px-2 py-2">{r.cpaCents == null ? '-' : money(r.cpaCents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
