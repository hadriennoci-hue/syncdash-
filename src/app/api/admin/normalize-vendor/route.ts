import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, eq, ne, or, isNull } from 'drizzle-orm'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, platformMappings } from '@/lib/db/schema'
import { createConnector } from '@/lib/connectors/registry'
import { ensureFreshShopifyToken } from '@/lib/functions/tokens'
import type { Platform } from '@/types/platform'

const schema = z.object({
  vendor: z.string().trim().min(1).default('Acer'),
  platforms: z.array(z.enum(['shopify_tiktok', 'shopify_komputerzz'])).default(['shopify_tiktok', 'shopify_komputerzz']),
  dryRun: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const { vendor, platforms, dryRun } = parsed.data

  for (const platform of platforms) {
    const refresh = await ensureFreshShopifyToken(platform, 24)
    if (!refresh.ok) {
      return apiError(
        'TOKEN_REFRESH_ERROR',
        `${platform} token refresh failed: ${refresh.error ?? 'unknown error'}`,
        500
      )
    }
  }

  const wrongVendorRows = await db.query.products.findMany({
    where: or(
      isNull(products.vendor),
      eq(products.vendor, ''),
      ne(products.vendor, vendor),
    ),
    columns: {
      id: true,
      vendor: true,
    },
    with: {
      platformMappings: {
        where: and(
          eq(platformMappings.syncStatus, 'synced'),
          or(
            ...platforms.map((platform) => eq(platformMappings.platform, platform as Platform))
          ),
        ),
        columns: {
          platform: true,
          platformId: true,
        },
      },
    },
  })

  const summary = {
    vendor,
    dryRun,
    d1RowsNeedingUpdate: wrongVendorRows.length,
    platformUpdates: {
      shopify_tiktok: { attempted: 0, updated: 0, failed: 0 as number, failures: [] as string[] },
      shopify_komputerzz: { attempted: 0, updated: 0, failed: 0 as number, failures: [] as string[] },
    },
    sampleSkus: wrongVendorRows.slice(0, 20).map((row) => row.id),
  }

  if (dryRun) return apiResponse(summary)

  if (wrongVendorRows.length > 0) {
    await db
      .update(products)
      .set({ vendor, updatedAt: new Date().toISOString() })
      .where(
        or(
          isNull(products.vendor),
          eq(products.vendor, ''),
          ne(products.vendor, vendor),
        )
      )
  }

  const connectorCache = new Map<Platform, Awaited<ReturnType<typeof createConnector>>>()
  const getConnector = async (platform: Platform) => {
    if (!connectorCache.has(platform)) {
      connectorCache.set(platform, await createConnector(platform))
    }
    return connectorCache.get(platform)!
  }

  for (const row of wrongVendorRows) {
    for (const mapping of row.platformMappings) {
      const platform = mapping.platform as 'shopify_tiktok' | 'shopify_komputerzz'
      summary.platformUpdates[platform].attempted += 1
      try {
        const connector = await getConnector(platform)
        await connector.updateProduct(mapping.platformId, { vendor })
        summary.platformUpdates[platform].updated += 1
      } catch (error) {
        summary.platformUpdates[platform].failed += 1
        summary.platformUpdates[platform].failures.push(
          `${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`
        )
      }
    }
  }

  return apiResponse(summary)
}
