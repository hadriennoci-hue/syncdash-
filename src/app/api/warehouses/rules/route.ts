import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouseChannelRules } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'


const putSchema = z.object({
  warehouseId: z.string().min(1),
  platform:    z.string().min(1),
  // Priority >= 1 = allowed (1 = primary, 2 = secondary…)
  // To REMOVE a rule (forbid the combination), send priority: 0
  priority:    z.number().int().min(0),
})

// GET — return the full routing matrix
// Response shape: { rules: [{ warehouseId, platform, priority }] }
// Missing combinations are implicitly forbidden (priority = 0 / "NO")
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.query.warehouseChannelRules.findMany({
    orderBy: (t, { asc }) => [asc(t.platform), asc(t.priority)],
  })

  return apiResponse({ rules: rows })
}

// PUT — upsert a single rule (or remove it if priority = 0)
export async function PUT(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const { warehouseId, platform, priority } = parsed.data

  if (!PLATFORMS.includes(platform as Platform)) {
    return apiError('VALIDATION_ERROR', `Unknown platform: ${platform}`, 400)
  }

  if (priority === 0) {
    // Remove the rule — this channel is now forbidden for this warehouse
    await db.delete(warehouseChannelRules).where(
      and(
        eq(warehouseChannelRules.warehouseId, warehouseId),
        eq(warehouseChannelRules.platform,    platform)
      )
    )
    return apiResponse({ warehouseId, platform, priority: 0, status: 'removed' })
  }

  await db.insert(warehouseChannelRules).values({ warehouseId, platform, priority })
    .onConflictDoUpdate({
      target: [warehouseChannelRules.warehouseId, warehouseChannelRules.platform],
      set:    { priority },
    })

  return apiResponse({ warehouseId, platform, priority })
}
