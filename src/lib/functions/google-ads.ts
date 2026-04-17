import { and, desc, eq, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  googleAdsAdGroups,
  googleAdsCampaigns,
  platformTokens,
  rawGoogleAdsAdGroups,
  rawGoogleAdsCampaigns,
  rawGoogleAdsClickViews,
  salesOrderAttribution,
  salesOrderMarketing,
} from '@/lib/db/schema'
import { logOperation } from './log'
import type { TriggeredBy } from '@/types/platform'

interface StoredGoogleToken {
  accessToken?: string | null
  refreshToken?: string | null
  tokenType?: string | null
  scope?: string | null
  obtainedAt?: string | null
}

interface GoogleAdsImportOptions {
  customerId?: string
  startDate?: string
  endDate?: string
  triggeredBy?: TriggeredBy
}

interface GoogleAdsImportResult {
  customerId: string
  campaignsImported: number
  adGroupsImported: number
  clickViewsImported: number
  startDate: string
  endDate: string
}

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, '')
}

function parseStoredGoogleToken(raw: string): StoredGoogleToken {
  try {
    const parsed = JSON.parse(raw) as StoredGoogleToken
    return parsed
  } catch {
    return { accessToken: raw }
  }
}

async function getGoogleTokenRecord() {
  return db.query.platformTokens.findFirst({
    where: eq(platformTokens.platform, 'google_ads'),
  })
}

async function updateGoogleTokenRecord(token: StoredGoogleToken, expiresInSec: number): Promise<void> {
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()
  await db.insert(platformTokens).values({
    platform: 'google_ads',
    accessToken: JSON.stringify({
      accessToken: token.accessToken ?? null,
      refreshToken: token.refreshToken ?? null,
      tokenType: token.tokenType ?? null,
      scope: token.scope ?? null,
      obtainedAt: nowIso,
    }),
    expiresAt,
    refreshedAt: nowIso,
  }).onConflictDoUpdate({
    target: platformTokens.platform,
    set: {
      accessToken: JSON.stringify({
        accessToken: token.accessToken ?? null,
        refreshToken: token.refreshToken ?? null,
        tokenType: token.tokenType ?? null,
        scope: token.scope ?? null,
        obtainedAt: nowIso,
      }),
      expiresAt,
      refreshedAt: nowIso,
    },
  })
}

export async function getGoogleAdsAccessToken(forceRefresh = true): Promise<string> {
  const row = await getGoogleTokenRecord()
  if (!row) {
    throw new Error('Google Ads token not found. Complete OAuth callback first.')
  }

  const stored = parseStoredGoogleToken(row.accessToken)
  const stillValid = Date.now() < (new Date(row.expiresAt).getTime() - 60_000)
  if (!forceRefresh && stillValid && stored.accessToken) {
    return stored.accessToken
  }

  if (!stored.refreshToken) {
    if (stored.accessToken && stillValid) return stored.accessToken
    throw new Error('Google Ads refresh token missing. Re-authorize with access_type=offline and prompt=consent.')
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Google OAuth refresh failed ${res.status}: ${await res.text()}`)
  }

  const json = await res.json() as { access_token?: string; expires_in?: number; scope?: string; token_type?: string }
  if (!json.access_token) {
    throw new Error('Google OAuth refresh response missing access_token')
  }

  const updated: StoredGoogleToken = {
    accessToken: json.access_token,
    refreshToken: stored.refreshToken,
    tokenType: json.token_type ?? stored.tokenType ?? null,
    scope: json.scope ?? stored.scope ?? null,
  }
  await updateGoogleTokenRecord(updated, json.expires_in ?? 3600)
  return json.access_token
}

function parseStreamRows(payload: unknown): any[] {
  if (!Array.isArray(payload)) return []
  const rows: any[] = []
  for (const chunk of payload as any[]) {
    const results = Array.isArray(chunk?.results) ? chunk.results : []
    rows.push(...results)
  }
  return rows
}

async function googleAdsSearchStream(customerId: string, query: string, accessToken: string): Promise<any[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  if (!developerToken) {
    throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN')
  }

  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v18'
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '') || ''
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': developerToken,
  }
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId
  }

  const res = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${normalizeCustomerId(customerId)}/googleAds:searchStream`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    }
  )
  if (!res.ok) {
    throw new Error(`Google Ads query failed ${res.status}: ${await res.text()}`)
  }

  const stream = await res.json()
  return parseStreamRows(stream)
}

function pickDate(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback
  return value
}

export async function importGoogleAdsData(options: GoogleAdsImportOptions = {}): Promise<GoogleAdsImportResult> {
  const configuredCustomer = process.env.GOOGLE_ADS_CUSTOMER_ID
  const customerId = options.customerId ?? configuredCustomer
  if (!customerId) {
    throw new Error('Missing Google Ads customer id. Set GOOGLE_ADS_CUSTOMER_ID or pass customerId.')
  }

  const today = new Date()
  const defaultEnd = today.toISOString().slice(0, 10)
  const last30 = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
  const startDate = pickDate(options.startDate, last30)
  const endDate = pickDate(options.endDate, defaultEnd)
  const triggeredBy = options.triggeredBy ?? 'human'

  const accessToken = await getGoogleAdsAccessToken(true)

  const campaignsRows = await googleAdsSearchStream(customerId, `
    SELECT
      customer.id,
      customer.currency_code,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
  `, accessToken)

  for (const row of campaignsRows) {
    const campaignId = String(row?.campaign?.id ?? '')
    if (!campaignId) continue
    const customer = String(row?.customer?.id ?? normalizeCustomerId(customerId))

    await db.insert(rawGoogleAdsCampaigns).values({
      customerId: customer,
      campaignId,
      segmentsDate: null,
      payloadJson: JSON.stringify(row),
      syncedAt: new Date().toISOString(),
    }).onConflictDoNothing()

    await db.insert(googleAdsCampaigns).values({
      customerId: customer,
      campaignId,
      name: row?.campaign?.name ? String(row.campaign.name) : null,
      status: row?.campaign?.status ? String(row.campaign.status) : null,
      advertisingChannelType: row?.campaign?.advertisingChannelType ? String(row.campaign.advertisingChannelType) : null,
      startDate: row?.campaign?.startDate ? String(row.campaign.startDate) : null,
      endDate: row?.campaign?.endDate ? String(row.campaign.endDate) : null,
      currencyCode: row?.customer?.currencyCode ? String(row.customer.currencyCode) : null,
      budgetMicros: row?.campaignBudget?.amountMicros != null ? Number(row.campaignBudget.amountMicros) : null,
      lastSyncedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [googleAdsCampaigns.customerId, googleAdsCampaigns.campaignId],
      set: {
        name: row?.campaign?.name ? String(row.campaign.name) : null,
        status: row?.campaign?.status ? String(row.campaign.status) : null,
        advertisingChannelType: row?.campaign?.advertisingChannelType ? String(row.campaign.advertisingChannelType) : null,
        startDate: row?.campaign?.startDate ? String(row.campaign.startDate) : null,
        endDate: row?.campaign?.endDate ? String(row.campaign.endDate) : null,
        currencyCode: row?.customer?.currencyCode ? String(row.customer.currencyCode) : null,
        budgetMicros: row?.campaignBudget?.amountMicros != null ? Number(row.campaignBudget.amountMicros) : null,
        lastSyncedAt: new Date().toISOString(),
      },
    })
  }

  const adGroupRows = await googleAdsSearchStream(customerId, `
    SELECT
      customer.id,
      campaign.id,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.cpc_bid_micros
    FROM ad_group
  `, accessToken)

  for (const row of adGroupRows) {
    const adGroupId = String(row?.adGroup?.id ?? '')
    if (!adGroupId) continue
    const customer = String(row?.customer?.id ?? normalizeCustomerId(customerId))
    const campaignId = row?.campaign?.id != null ? String(row.campaign.id) : null

    await db.insert(rawGoogleAdsAdGroups).values({
      customerId: customer,
      campaignId,
      adGroupId,
      segmentsDate: null,
      payloadJson: JSON.stringify(row),
      syncedAt: new Date().toISOString(),
    }).onConflictDoNothing()

    await db.insert(googleAdsAdGroups).values({
      customerId: customer,
      adGroupId,
      campaignId,
      name: row?.adGroup?.name ? String(row.adGroup.name) : null,
      status: row?.adGroup?.status ? String(row.adGroup.status) : null,
      type: row?.adGroup?.type ? String(row.adGroup.type) : null,
      cpcBidMicros: row?.adGroup?.cpcBidMicros != null ? Number(row.adGroup.cpcBidMicros) : null,
      lastSyncedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [googleAdsAdGroups.customerId, googleAdsAdGroups.adGroupId],
      set: {
        campaignId,
        name: row?.adGroup?.name ? String(row.adGroup.name) : null,
        status: row?.adGroup?.status ? String(row.adGroup.status) : null,
        type: row?.adGroup?.type ? String(row.adGroup.type) : null,
        cpcBidMicros: row?.adGroup?.cpcBidMicros != null ? Number(row.adGroup.cpcBidMicros) : null,
        lastSyncedAt: new Date().toISOString(),
      },
    })
  }

  let clickViewsImported = 0
  try {
    const clickRows = await googleAdsSearchStream(customerId, `
      SELECT
        customer.id,
        click_view.gclid,
        click_view.campaign_id,
        click_view.ad_group_id,
        click_view.gclid_date_time,
        segments.date
      FROM click_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `, accessToken)

    for (const row of clickRows) {
      const gclid = row?.clickView?.gclid ? String(row.clickView.gclid) : ''
      if (!gclid) continue
      const customer = String(row?.customer?.id ?? normalizeCustomerId(customerId))
      await db.insert(rawGoogleAdsClickViews).values({
        customerId: customer,
        gclid,
        campaignId: row?.clickView?.campaignId != null ? String(row.clickView.campaignId) : null,
        adGroupId: row?.clickView?.adGroupId != null ? String(row.clickView.adGroupId) : null,
        clickDateTime: row?.clickView?.gclidDateTime ? String(row.clickView.gclidDateTime) : null,
        segmentsDate: row?.segments?.date ? String(row.segments.date) : null,
        payloadJson: JSON.stringify(row),
        syncedAt: new Date().toISOString(),
      }).onConflictDoNothing()
      clickViewsImported++
    }
  } catch (err) {
    await logOperation({
      action: 'google_ads_click_import',
      status: 'error',
      platform: 'google_ads',
      message: err instanceof Error ? err.message : 'Unknown error',
      triggeredBy,
    })
  }

  await logOperation({
    action: 'google_ads_import',
    status: 'success',
    platform: 'google_ads',
    message: `customer=${normalizeCustomerId(customerId)} campaigns=${campaignsRows.length} adgroups=${adGroupRows.length} clicks=${clickViewsImported}`,
    triggeredBy,
  })

  return {
    customerId: normalizeCustomerId(customerId),
    campaignsImported: campaignsRows.length,
    adGroupsImported: adGroupRows.length,
    clickViewsImported,
    startDate,
    endDate,
  }
}

function readQueryParam(urlValue: string | null, key: string): string | null {
  if (!urlValue) return null
  try {
    const parsed = new URL(urlValue)
    const value = parsed.searchParams.get(key)
    return value ? value.trim() || null : null
  } catch {
    return null
  }
}

function fromMetaData(order: any, key: string): string | null {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : []
  const hit = meta.find((m: any) => String(m?.key ?? '') === key)
  if (!hit) return null
  const value = hit?.value
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

function clean(value: string | null): string | null {
  if (!value) return null
  const s = value.trim()
  return s.length ? s : null
}

export function extractOrderMarketingSignals(order: any): {
  landingSite: string | null
  referringSite: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  gclid: string | null
  fbclid: string | null
  ttclid: string | null
  sourceJson: string
} {
  const landingSite = clean(order?.landing_site ?? order?.landingSite ?? fromMetaData(order, '_wc_order_attribution_session_entry'))
  const referringSite = clean(order?.referring_site ?? order?.referringSite ?? fromMetaData(order, '_wc_order_attribution_session_start_referrer'))

  const utmSource = clean(
    readQueryParam(landingSite, 'utm_source')
    ?? readQueryParam(referringSite, 'utm_source')
    ?? order?.source_name
    ?? fromMetaData(order, '_wc_order_attribution_utm_source')
  )
  const utmMedium = clean(
    readQueryParam(landingSite, 'utm_medium')
    ?? readQueryParam(referringSite, 'utm_medium')
    ?? fromMetaData(order, '_wc_order_attribution_utm_medium')
  )
  const utmCampaign = clean(
    readQueryParam(landingSite, 'utm_campaign')
    ?? readQueryParam(referringSite, 'utm_campaign')
    ?? fromMetaData(order, '_wc_order_attribution_utm_campaign')
  )
  const utmTerm = clean(
    readQueryParam(landingSite, 'utm_term')
    ?? readQueryParam(referringSite, 'utm_term')
    ?? fromMetaData(order, '_wc_order_attribution_utm_term')
  )
  const utmContent = clean(
    readQueryParam(landingSite, 'utm_content')
    ?? readQueryParam(referringSite, 'utm_content')
    ?? fromMetaData(order, '_wc_order_attribution_utm_content')
  )
  const gclid = clean(
    readQueryParam(landingSite, 'gclid')
    ?? readQueryParam(referringSite, 'gclid')
    ?? fromMetaData(order, '_wc_order_attribution_gclid')
  )
  const fbclid = clean(readQueryParam(landingSite, 'fbclid') ?? readQueryParam(referringSite, 'fbclid'))
  const ttclid = clean(
    readQueryParam(landingSite, 'ttclid')
    ?? readQueryParam(referringSite, 'ttclid')
    ?? readQueryParam(landingSite, 'ttclid_1')
  )

  return {
    landingSite,
    referringSite,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    gclid,
    fbclid,
    ttclid,
    sourceJson: JSON.stringify({
      landingSite,
      referringSite,
      sourceName: order?.source_name ?? null,
      customerLocale: order?.customer_locale ?? null,
    }),
  }
}

export async function upsertOrderAttribution(orderPk: number, orderCreatedAt: string, marketing: {
  landingSite: string | null
  referringSite: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  gclid: string | null
  fbclid: string | null
  ttclid: string | null
  sourceJson: string
}): Promise<void> {
  await db.insert(salesOrderMarketing).values({
    orderPk,
    landingSite: marketing.landingSite,
    referringSite: marketing.referringSite,
    utmSource: marketing.utmSource,
    utmMedium: marketing.utmMedium,
    utmCampaign: marketing.utmCampaign,
    utmTerm: marketing.utmTerm,
    utmContent: marketing.utmContent,
    gclid: marketing.gclid,
    fbclid: marketing.fbclid,
    ttclid: marketing.ttclid,
    sourceJson: marketing.sourceJson,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: salesOrderMarketing.orderPk,
    set: {
      landingSite: marketing.landingSite,
      referringSite: marketing.referringSite,
      utmSource: marketing.utmSource,
      utmMedium: marketing.utmMedium,
      utmCampaign: marketing.utmCampaign,
      utmTerm: marketing.utmTerm,
      utmContent: marketing.utmContent,
      gclid: marketing.gclid,
      fbclid: marketing.fbclid,
      ttclid: marketing.ttclid,
      sourceJson: marketing.sourceJson,
      updatedAt: new Date().toISOString(),
    },
  })

  if (marketing.gclid) {
    const click = await db.query.rawGoogleAdsClickViews.findFirst({
      where: and(
        eq(rawGoogleAdsClickViews.gclid, marketing.gclid),
        lte(rawGoogleAdsClickViews.clickDateTime, orderCreatedAt)
      ),
      orderBy: [desc(rawGoogleAdsClickViews.clickDateTime)],
    })

    await db.insert(salesOrderAttribution).values({
      orderPk,
      model: 'last_gclid_click',
      confidence: 0.95,
      googleCustomerId: click?.customerId ?? null,
      campaignId: click?.campaignId ?? null,
      adGroupId: click?.adGroupId ?? null,
      gclid: marketing.gclid,
      clickTime: click?.clickDateTime ?? null,
      notes: click ? 'Matched by gclid in click_view feed' : 'gclid present but not found in click feed',
      attributedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: salesOrderAttribution.orderPk,
      set: {
        model: 'last_gclid_click',
        confidence: 0.95,
        googleCustomerId: click?.customerId ?? null,
        campaignId: click?.campaignId ?? null,
        adGroupId: click?.adGroupId ?? null,
        gclid: marketing.gclid,
        clickTime: click?.clickDateTime ?? null,
        notes: click ? 'Matched by gclid in click_view feed' : 'gclid present but not found in click feed',
        attributedAt: new Date().toISOString(),
      },
    })
    return
  }

  const source = marketing.utmSource?.toLowerCase() ?? ''
  if ((source.includes('google') || source === 'cpc' || source === 'ads') && marketing.utmCampaign) {
    const campaign = await db.query.googleAdsCampaigns.findFirst({
      where: sql`lower(${googleAdsCampaigns.name}) = lower(${marketing.utmCampaign})`,
      orderBy: [desc(googleAdsCampaigns.lastSyncedAt)],
    })

    await db.insert(salesOrderAttribution).values({
      orderPk,
      model: 'utm_campaign_name',
      confidence: campaign ? 0.7 : 0.35,
      googleCustomerId: campaign?.customerId ?? null,
      campaignId: campaign?.campaignId ?? null,
      adGroupId: null,
      gclid: null,
      clickTime: null,
      notes: campaign ? 'Matched by utm_campaign -> campaign.name' : 'No exact campaign name match',
      attributedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: salesOrderAttribution.orderPk,
      set: {
        model: 'utm_campaign_name',
        confidence: campaign ? 0.7 : 0.35,
        googleCustomerId: campaign?.customerId ?? null,
        campaignId: campaign?.campaignId ?? null,
        adGroupId: null,
        gclid: null,
        clickTime: null,
        notes: campaign ? 'Matched by utm_campaign -> campaign.name' : 'No exact campaign name match',
        attributedAt: new Date().toISOString(),
      },
    })
    return
  }

  await db.insert(salesOrderAttribution).values({
    orderPk,
    model: 'unattributed',
    confidence: 0,
    googleCustomerId: null,
    campaignId: null,
    adGroupId: null,
    gclid: marketing.gclid,
    clickTime: null,
    notes: 'No attribution signal found',
    attributedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: salesOrderAttribution.orderPk,
    set: {
      model: 'unattributed',
      confidence: 0,
      googleCustomerId: null,
      campaignId: null,
      adGroupId: null,
      gclid: marketing.gclid,
      clickTime: null,
      notes: 'No attribution signal found',
      attributedAt: new Date().toISOString(),
    },
  })
}
