import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { socialAccountDailyMetrics, socialMediaAccounts, socialMediaPosts, socialPostDailyMetrics } from '@/lib/db/schema'

interface CuratedFilters {
  from: string
  to: string
  accountId?: string
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parseArrayJson(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function parseReasonTags(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function hashtags(content: string): string[] {
  const m = content.match(/#[\p{L}\p{N}_]+/gu) ?? []
  return m.map((s) => s.toLowerCase())
}

function keywords(content: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'about', 'have', 'you', 'our'])
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\p{L}\p{N}_]+/gu, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !stop.has(w))
    .slice(0, 12)
}

function hasLink(content: string): boolean {
  return /https?:\/\/\S+/i.test(content)
}

function isThread(content: string): boolean {
  return /(^|\s)\d+\/\d+(\s|$)/.test(content)
}

function formatBucket(content: string, mediaCount: number): string {
  if (isThread(content)) return 'thread'
  if (hasLink(content)) return 'link_post'
  if (mediaCount === 0) return 'text_only'
  if (mediaCount === 1) return 'image_1'
  return 'image_2_4'
}

function lengthBucket(length: number): string {
  if (length <= 80) return '0_80'
  if (length <= 160) return '81_160'
  if (length <= 280) return '161_280'
  return '281_plus'
}

function dayHour(iso: string): { dayUtc: string; hourUtc: number } {
  const d = new Date(iso)
  const day = d.toISOString().slice(0, 10)
  return { dayUtc: day, hourUtc: d.getUTCHours() }
}

function weekDayName(iso: string): string {
  const d = new Date(iso)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? 'Unknown'
}

function safeDiv(num: number, den: number): number | null {
  if (den <= 0) return null
  return num / den
}

export async function getCuratedSocialAnalytics(filters: CuratedFilters) {
  if (!isYmd(filters.from) || !isYmd(filters.to)) {
    throw new Error('from/to must be YYYY-MM-DD')
  }
  if (filters.from > filters.to) {
    throw new Error('from must be <= to')
  }

  const accountMetrics = await db.query.socialAccountDailyMetrics.findMany({
    where: and(
      gte(socialAccountDailyMetrics.metricDate, filters.from),
      lte(socialAccountDailyMetrics.metricDate, filters.to),
      filters.accountId ? eq(socialAccountDailyMetrics.accountId, filters.accountId) : undefined,
    ),
    orderBy: [asc(socialAccountDailyMetrics.metricDate)],
  })

  const metricRows = await db.select({
    accountId: socialMediaPosts.accountId,
    accountLabel: socialMediaAccounts.label,
    accountHandle: socialMediaAccounts.handle,
    platform: socialMediaAccounts.platform,
    postPk: socialMediaPosts.postPk,
    externalPostId: socialMediaPosts.externalPostId,
    content: socialMediaPosts.content,
    imageUrl: socialMediaPosts.imageUrl,
    imageUrls: socialMediaPosts.imageUrls,
    publishedAt: socialMediaPosts.publishedAt,
    scheduledFor: socialMediaPosts.scheduledFor,
    hypothesis: socialMediaPosts.hypothesis,
    variantLabel: socialMediaPosts.variantLabel,
    experimentGroup: socialMediaPosts.experimentGroup,
    metricDate: socialPostDailyMetrics.metricDate,
    impressions: socialPostDailyMetrics.impressions,
    likes: socialPostDailyMetrics.likes,
    reposts: socialPostDailyMetrics.reposts,
    replies: socialPostDailyMetrics.replies,
    bookmarks: socialPostDailyMetrics.bookmarks,
    quotes: socialPostDailyMetrics.quotes,
    profileClicks: socialPostDailyMetrics.profileClicks,
    linkClicks: socialPostDailyMetrics.linkClicks,
    followerDelta24h: socialPostDailyMetrics.followerDelta24h,
    followerDelta72h: socialPostDailyMetrics.followerDelta72h,
    sentimentTag: socialPostDailyMetrics.sentimentTag,
    reasonTagsJson: socialPostDailyMetrics.reasonTagsJson,
  })
    .from(socialPostDailyMetrics)
    .innerJoin(socialMediaPosts, eq(socialMediaPosts.postPk, socialPostDailyMetrics.postPk))
    .innerJoin(socialMediaAccounts, eq(socialMediaAccounts.id, socialMediaPosts.accountId))
    .where(and(
      gte(socialPostDailyMetrics.metricDate, filters.from),
      lte(socialPostDailyMetrics.metricDate, filters.to),
      filters.accountId ? eq(socialMediaPosts.accountId, filters.accountId) : undefined,
    ))

  type PostAgg = {
    accountId: string
    accountLabel: string
    accountHandle: string
    platform: string
    postPk: number
    externalPostId: string | null
    content: string
    publishedAt: string | null
    scheduledFor: string
    imageUrl: string | null
    images: string[]
    hypothesis: string | null
    variantLabel: string | null
    experimentGroup: string | null
    impressions: number
    likes: number
    reposts: number
    replies: number
    bookmarks: number
    quotes: number
    profileClicks: number
    linkClicks: number
    followerDelta24h: number | null
    followerDelta72h: number | null
    sentimentTag: string | null
    reasonTags: string[]
  }

  const byPost = new Map<number, PostAgg>()
  for (const row of metricRows) {
    const cur = byPost.get(row.postPk) ?? {
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      accountHandle: row.accountHandle,
      platform: row.platform,
      postPk: row.postPk,
      externalPostId: row.externalPostId ?? null,
      content: row.content,
      publishedAt: row.publishedAt ?? null,
      scheduledFor: row.scheduledFor,
      imageUrl: row.imageUrl ?? null,
      images: parseArrayJson(row.imageUrls).slice(0, 4),
      hypothesis: row.hypothesis ?? null,
      variantLabel: row.variantLabel ?? null,
      experimentGroup: row.experimentGroup ?? null,
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      bookmarks: 0,
      quotes: 0,
      profileClicks: 0,
      linkClicks: 0,
      followerDelta24h: null,
      followerDelta72h: null,
      sentimentTag: null,
      reasonTags: [],
    }
    cur.impressions += row.impressions
    cur.likes += row.likes
    cur.reposts += row.reposts
    cur.replies += row.replies
    cur.bookmarks += row.bookmarks
    cur.quotes += row.quotes
    cur.profileClicks += row.profileClicks
    cur.linkClicks += row.linkClicks
    if (row.followerDelta24h != null) cur.followerDelta24h = row.followerDelta24h
    if (row.followerDelta72h != null) cur.followerDelta72h = row.followerDelta72h
    if (row.sentimentTag) cur.sentimentTag = row.sentimentTag
    cur.reasonTags.push(...parseReasonTags(row.reasonTagsJson))
    byPost.set(row.postPk, cur)
  }

  const postRows = Array.from(byPost.values()).map((p) => {
    const engagements = p.likes + p.reposts + p.replies + p.bookmarks + p.quotes
    const er = safeDiv(engagements, p.impressions)
    const ctr = safeDiv(p.linkClicks, p.impressions)
    const publishedIso = p.publishedAt ?? p.scheduledFor
    const { dayUtc, hourUtc } = dayHour(publishedIso)
    const mediaCount = p.images.length
    return {
      ...p,
      engagements,
      engagementRate: er,
      ctr,
      mediaCount,
      contentLength: p.content.length,
      lengthBucket: lengthBucket(p.content.length),
      format: formatBucket(p.content, mediaCount),
      hashtags: hashtags(p.content),
      keywords: keywords(p.content),
      dayUtc,
      hourUtc,
      weekDayUtc: weekDayName(publishedIso),
    }
  })

  const byAccount = new Map<string, { impressions: number; engagements: number; linkClicks: number; postImpressions: number[] }>()
  for (const p of postRows) {
    const cur = byAccount.get(p.accountId) ?? { impressions: 0, engagements: 0, linkClicks: 0, postImpressions: [] }
    cur.impressions += p.impressions
    cur.engagements += p.engagements
    cur.linkClicks += p.linkClicks
    cur.postImpressions.push(p.impressions)
    byAccount.set(p.accountId, cur)
  }

  const accountBaselines = Object.fromEntries(
    Array.from(byAccount.entries()).map(([accountId, m]) => ([
      accountId,
      {
        baselineEr: safeDiv(m.engagements, m.impressions),
        baselineCtr: safeDiv(m.linkClicks, m.impressions),
        medianPostImpressions: median(m.postImpressions),
      },
    ]))
  )

  const withReasonTags = postRows.map((p) => {
    const baseline = accountBaselines[p.accountId] ?? { baselineEr: null, baselineCtr: null, medianPostImpressions: null }
    const tagsSet = new Set<string>(p.reasonTags)
    if ((baseline.baselineEr ?? 0) > 0 && (p.engagementRate ?? 0) < (baseline.baselineEr ?? 0) * 0.6) tagsSet.add('hook_weak')
    if (p.format === 'link_post' && (baseline.baselineCtr ?? 0) > 0 && (p.ctr ?? 0) < (baseline.baselineCtr ?? 0) * 0.6) tagsSet.add('cta_weak')
    if ((baseline.medianPostImpressions ?? 0) > 0 && p.impressions < (baseline.medianPostImpressions ?? 0) * 0.5) tagsSet.add('wrong_timing')
    if (p.mediaCount === 0 && (p.engagementRate ?? 0) < ((baseline.baselineEr ?? 0) * 0.8)) tagsSet.add('creative_weak')
    if ((p.sentimentTag ?? '').toLowerCase() === 'negative') tagsSet.add('negative_reply_sentiment')
    return { ...p, reasonTags: Array.from(tagsSet) }
  })

  const scored = withReasonTags.map((p) => {
    const score = ((p.engagementRate ?? 0) * 0.65) + ((p.ctr ?? 0) * 0.35)
    return { ...p, score }
  })
  const eligible = scored.filter((p) => p.impressions >= 100)
  const topPosts = [...eligible].sort((a, b) => b.score - a.score).slice(0, 10)
  const worstPosts = [...eligible].sort((a, b) => a.score - b.score).slice(0, 10)

  function groupPerformance<T extends string>(keyFn: (p: typeof withReasonTags[number]) => T) {
    const map = new Map<T, { impressions: number; engagements: number; linkClicks: number; count: number; ers: number[]; ctrs: number[] }>()
    for (const p of withReasonTags) {
      const k = keyFn(p)
      const cur = map.get(k) ?? { impressions: 0, engagements: 0, linkClicks: 0, count: 0, ers: [], ctrs: [] }
      cur.impressions += p.impressions
      cur.engagements += p.engagements
      cur.linkClicks += p.linkClicks
      cur.count += 1
      if (p.engagementRate != null) cur.ers.push(p.engagementRate)
      if (p.ctr != null) cur.ctrs.push(p.ctr)
      map.set(k, cur)
    }
    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      postCount: value.count,
      impressions: value.impressions,
      engagements: value.engagements,
      linkClicks: value.linkClicks,
      engagementRate: safeDiv(value.engagements, value.impressions),
      ctr: safeDiv(value.linkClicks, value.impressions),
      medianEr: median(value.ers),
      medianCtr: median(value.ctrs),
    }))
  }

  const timingByHour = groupPerformance((p) => `${p.accountId}|${String(p.hourUtc).padStart(2, '0')}`)
  const timingByWeekday = groupPerformance((p) => `${p.accountId}|${p.weekDayUtc}`)
  const contentFormatPerformance = groupPerformance((p) => `${p.accountId}|${p.format}`)
  const lengthBucketPerformance = groupPerformance((p) => `${p.accountId}|${p.lengthBucket}`)
  const mediaPerformance = groupPerformance((p) => `${p.accountId}|${p.images[0] ?? 'no_media'}`)

  const topicMap = new Map<string, { ers: number[]; ctrs: number[]; posts: number }>()
  for (const p of withReasonTags) {
    const topics = [...p.hashtags, ...p.keywords]
    for (const t of topics) {
      const cur = topicMap.get(`${p.accountId}|${t}`) ?? { ers: [], ctrs: [], posts: 0 }
      if (p.engagementRate != null) cur.ers.push(p.engagementRate)
      if (p.ctr != null) cur.ctrs.push(p.ctr)
      cur.posts += 1
      topicMap.set(`${p.accountId}|${t}`, cur)
    }
  }
  const topicPerformance = Array.from(topicMap.entries()).map(([key, v]) => ({
    key,
    postCount: v.posts,
    medianEr: median(v.ers),
    medianCtr: median(v.ctrs),
  }))

  const postsPerDayMap = new Map<string, { postCount: number; erValues: number[]; ctrValues: number[] }>()
  for (const p of withReasonTags) {
    const key = `${p.accountId}|${p.dayUtc}`
    const cur = postsPerDayMap.get(key) ?? { postCount: 0, erValues: [], ctrValues: [] }
    cur.postCount += 1
    if (p.engagementRate != null) cur.erValues.push(p.engagementRate)
    if (p.ctr != null) cur.ctrValues.push(p.ctr)
    postsPerDayMap.set(key, cur)
  }
  const frequencyFatigue = Array.from(postsPerDayMap.entries()).map(([key, v]) => ({
    key,
    postsPerDay: v.postCount,
    avgEr: avg(v.erValues),
    avgCtr: avg(v.ctrValues),
  }))

  const accountTrendSeries = new Map<string, typeof accountMetrics>()
  for (const row of accountMetrics) {
    const arr = accountTrendSeries.get(row.accountId) ?? []
    arr.push(row)
    accountTrendSeries.set(row.accountId, arr)
  }

  const accountTrends = Array.from(accountTrendSeries.entries()).map(([accountId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.metricDate.localeCompare(b.metricDate))
    const daily = sorted.map((row, idx) => {
      const window7 = sorted.slice(Math.max(0, idx - 6), idx + 1)
      const window30 = sorted.slice(Math.max(0, idx - 29), idx + 1)
      const calc = (w: typeof window7) => {
        const impressions = w.map((x) => x.impressions)
        const ers = w.map((x) => safeDiv(x.engagements, x.impressions)).filter((v): v is number => v != null)
        const ctrs = w.map((x) => safeDiv(x.linkClicks, x.impressions)).filter((v): v is number => v != null)
        const followersDelta = w.map((x) => x.followersDelta)
        return {
          impressionsAvg: avg(impressions),
          erAvg: avg(ers),
          ctrAvg: avg(ctrs),
          followersDeltaAvg: avg(followersDelta),
        }
      }
      return {
        metricDate: row.metricDate,
        impressions: row.impressions,
        engagements: row.engagements,
        linkClicks: row.linkClicks,
        followersDelta: row.followersDelta,
        ma7: calc(window7),
        ma30: calc(window30),
      }
    })
    const latest = daily[daily.length - 1] ?? null
    return {
      accountId,
      daily,
      current7d: latest?.ma7 ?? null,
      current30d: latest?.ma30 ?? null,
    }
  })

  const experimentsMap = new Map<string, { accountId: string; hypothesis: string | null; variants: Array<{ postPk: number; variantLabel: string; impressions: number; er: number | null; ctr: number | null; score: number }> }>()
  for (const p of scored) {
    if (!p.experimentGroup && !p.hypothesis) continue
    const groupKey = `${p.accountId}|${p.experimentGroup ?? ''}|${p.hypothesis ?? ''}`
    const bucket = experimentsMap.get(groupKey) ?? {
      accountId: p.accountId,
      hypothesis: p.hypothesis ?? null,
      variants: [],
    }
    bucket.variants.push({
      postPk: p.postPk,
      variantLabel: p.variantLabel ?? `post_${p.postPk}`,
      impressions: p.impressions,
      er: p.engagementRate,
      ctr: p.ctr,
      score: p.score,
    })
    experimentsMap.set(groupKey, bucket)
  }

  const experiments = Array.from(experimentsMap.entries()).map(([key, v]) => {
    const eligibleVariants = v.variants.filter((x) => x.impressions >= 500)
    const winner = eligibleVariants.length >= 2
      ? [...eligibleVariants].sort((a, b) => b.score - a.score)[0]
      : null
    return {
      key,
      accountId: v.accountId,
      hypothesis: v.hypothesis,
      variants: v.variants,
      winningVariant: winner ? winner.variantLabel : null,
      winningPostPk: winner ? winner.postPk : null,
    }
  })

  return {
    accountDailyMetrics: accountMetrics,
    postMetrics: withReasonTags,
    rollingTrends: accountTrends,
    postTimingPerformance: {
      byHourUtc: timingByHour,
      byWeekDayUtc: timingByWeekday,
    },
    contentFormatPerformance,
    topicPerformance,
    postLengthPerformance: lengthBucketPerformance,
    mediaPerformance,
    frequencyFatigue,
    topPosts,
    worstPosts,
    accountBenchmarks: {
      coincart_x: accountBaselines['coincart_x'] ?? null,
      komputerzz_x: accountBaselines['komputerzz_x'] ?? null,
      allAccounts: accountBaselines,
    },
    experiments,
  }
}
