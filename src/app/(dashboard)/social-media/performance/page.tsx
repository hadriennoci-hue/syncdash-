'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/utils/api-fetch'

interface PostMetricRow {
  accountId: string
  accountLabel: string
  accountHandle: string
  platform: string
  postPk: number
  impressions: number
  engagements: number
  linkClicks: number
  engagementRate: number | null
  ctr: number | null
}

interface CuratedResponse {
  data: {
    postMetrics: PostMetricRow[]
  }
}

interface AccountPerf {
  accountId: string
  accountLabel: string
  accountHandle: string
  platform: string
  posts: number
  impressions: number
  engagements: number
  linkClicks: number
  er: number | null
  ctr: number | null
  avgImpressionsPerPost: number | null
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function fromYmd(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}

export default function SocialMediaPerformancePage() {
  const [from, setFrom] = useState(fromYmd(30))
  const [to, setTo] = useState(todayYmd())

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['social-performance', from, to],
    queryFn: () => apiFetch<CuratedResponse>(`/api/social/analytics/curated?from=${from}&to=${to}`),
  })

  const rows = data?.data.postMetrics

  const byAccount = useMemo(() => {
    const map = new Map<string, AccountPerf>()
    for (const row of rows ?? []) {
      const current = map.get(row.accountId) ?? {
        accountId: row.accountId,
        accountLabel: row.accountLabel,
        accountHandle: row.accountHandle,
        platform: row.platform,
        posts: 0,
        impressions: 0,
        engagements: 0,
        linkClicks: 0,
        er: null,
        ctr: null,
        avgImpressionsPerPost: null,
      }
      current.posts += 1
      current.impressions += row.impressions
      current.engagements += row.engagements
      current.linkClicks += row.linkClicks
      map.set(row.accountId, current)
    }

    const result = Array.from(map.values())
    for (const r of result) {
      r.er = r.impressions > 0 ? r.engagements / r.impressions : null
      r.ctr = r.impressions > 0 ? r.linkClicks / r.impressions : null
      r.avgImpressionsPerPost = r.posts > 0 ? r.impressions / r.posts : null
    }
    result.sort((a, b) => (b.er ?? -999) - (a.er ?? -999))
    return result
  }, [rows])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-semibold">Social Media Performance</h1>
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
          <table className="min-w-[980px] w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-2 py-2">Account</th>
                <th className="px-2 py-2">Handle</th>
                <th className="px-2 py-2">Platform</th>
                <th className="px-2 py-2">Posts</th>
                <th className="px-2 py-2">Impressions</th>
                <th className="px-2 py-2">Engagements</th>
                <th className="px-2 py-2">ER</th>
                <th className="px-2 py-2">Link Clicks</th>
                <th className="px-2 py-2">CTR</th>
                <th className="px-2 py-2">Avg Impr/Post</th>
              </tr>
            </thead>
            <tbody>
              {byAccount.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-3 text-muted-foreground">No social performance rows for this period.</td>
                </tr>
              ) : (
                byAccount.map((r) => (
                  <tr key={r.accountId} className="border-t border-border">
                    <td className="px-2 py-2">{r.accountLabel}</td>
                    <td className="px-2 py-2">{r.accountHandle}</td>
                    <td className="px-2 py-2">{r.platform}</td>
                    <td className="px-2 py-2">{r.posts}</td>
                    <td className="px-2 py-2">{r.impressions}</td>
                    <td className="px-2 py-2">{r.engagements}</td>
                    <td className="px-2 py-2">{r.er == null ? '-' : `${(r.er * 100).toFixed(2)}%`}</td>
                    <td className="px-2 py-2">{r.linkClicks}</td>
                    <td className="px-2 py-2">{r.ctr == null ? '-' : `${(r.ctr * 100).toFixed(2)}%`}</td>
                    <td className="px-2 py-2">{r.avgImpressionsPerPost == null ? '-' : r.avgImpressionsPerPost.toFixed(1)}</td>
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
