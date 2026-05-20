import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getRunnerSignal, requestRunnerWake } from '@/lib/functions/runner-signal'
import { db } from '@/lib/db/client'
import { products, productPrices } from '@/lib/db/schema'
import { or, eq, inArray } from 'drizzle-orm'

const runnerSchema = z.object({
  runner: z.enum(['browser', 'acer-stock', 'acer-fill']).default('browser'),
})

const wakeSchema = z.object({
  runner: z.enum(['browser', 'acer-stock', 'acer-fill']).default('browser'),
  reason: z.string().min(1).max(200).default('manual'),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const parsed = runnerSchema.safeParse({
    runner: searchParams.get('runner') ?? 'browser',
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  // ?preflight=true: check prices without side effects (used by dashboard before initiating push)
  if (searchParams.get('preflight') === 'true' && parsed.data.runner === 'browser') {
    const check = await checkBrowserChannelPrices()
    return apiResponse({ preflight: true, ...check })
  }

  const signal = await getRunnerSignal(parsed.data.runner)
  return apiResponse(signal)
}

const BROWSER_CHANNELS = ['libre_market', 'xmr_bazaar'] as const

async function checkBrowserChannelPrices(): Promise<{ ok: boolean; missing: Array<{ sku: string; channel: string }> }> {
  // Find all products queued for browser channels
  const queued = await db
    .select({ id: products.id, pushedLibreMarket: products.pushedLibreMarket, pushedXmrBazaar: products.pushedXmrBazaar })
    .from(products)
    .where(or(eq(products.pushedLibreMarket, '2push'), eq(products.pushedXmrBazaar, '2push')))

  if (queued.length === 0) return { ok: true, missing: [] }

  const skus = queued.map((p) => p.id)
  const priceRows = await db
    .select({ productId: productPrices.productId, platform: productPrices.platform, price: productPrices.price })
    .from(productPrices)
    .where(
      inArray(productPrices.productId, skus)
    )
    .then((rows) => rows.filter((r) => (BROWSER_CHANNELS as readonly string[]).includes(r.platform)))

  // Build a lookup: sku → { platform → price }
  const priceMap = new Map<string, Map<string, number | null>>()
  for (const row of priceRows) {
    if (!priceMap.has(row.productId)) priceMap.set(row.productId, new Map())
    priceMap.get(row.productId)!.set(row.platform, row.price ?? null)
  }

  const missing: Array<{ sku: string; channel: string }> = []
  for (const p of queued) {
    if (p.pushedLibreMarket === '2push') {
      const price = priceMap.get(p.id)?.get('libre_market')
      if (!price) missing.push({ sku: p.id, channel: 'libre_market' })
    }
    if (p.pushedXmrBazaar === '2push') {
      const price = priceMap.get(p.id)?.get('xmr_bazaar')
      if (!price) missing.push({ sku: p.id, channel: 'xmr_bazaar' })
    }
  }

  return { ok: missing.length === 0, missing }
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = wakeSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  // For browser runner: block if any queued product is missing a price for its channel
  if (parsed.data.runner === 'browser') {
    const check = await checkBrowserChannelPrices()
    if (!check.ok) {
      const details = check.missing.map((m) => `${m.sku} (${m.channel})`).join(', ')
      return apiError(
        'MISSING_PRICES',
        `Cannot push: ${check.missing.length} product(s) are queued but have no price set — set prices first: ${details}`,
        422
      )
    }
  }

  await requestRunnerWake(parsed.data.runner, parsed.data.reason)
  const signal = await getRunnerSignal(parsed.data.runner)
  return apiResponse(signal)
}

