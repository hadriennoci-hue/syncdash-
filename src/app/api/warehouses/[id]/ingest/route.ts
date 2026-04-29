import { NextRequest } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { syncJobs } from '@/lib/db/schema'
import { applyWarehouseSnapshots, getPositiveWarehouseSkus } from '@/lib/functions/warehouses'

const snapshotSchema = z.object({
  sku:              z.string().min(1),
  quantity:         z.number().int().min(0),
  sourceUrl:        z.string().url().optional(),
  sourceName:       z.string().optional(),
  description:      z.string().nullable().optional(),
  importPrice:      z.number().positive().nullable().optional(),
  importPromoPrice: z.number().positive().nullable().optional(),
})

const bodySchema = z.object({
  snapshots:   z.array(snapshotSchema).min(1).max(5000),
  triggeredBy: z.enum(['human', 'agent', 'system']).default('agent'),
  runId:       z.string().min(1).optional(),
  chunkIndex:  z.number().int().min(1).optional(),
  totalChunks: z.number().int().min(1).optional(),
})

interface WarehouseIngestSessionState {
  warehouseId: string
  previousPositiveSkus: string[]
  seenPositiveSkus: string[]
  productsUpdated: number
  productsCreated: number
  existingProductsUpdated: number
  errors: string[]
}

// POST — ingest pre-scraped snapshots directly into D1, bypassing the connector.
// Used by the local Playwright scraper (scripts/scrape-acer-stock.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => null)
  if (!body) return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const { runId, chunkIndex, totalChunks } = parsed.data
    const hasChunking = !!runId || !!chunkIndex || !!totalChunks

    if (hasChunking) {
      if (!runId || !chunkIndex || !totalChunks) {
        return apiError('VALIDATION_ERROR', 'runId, chunkIndex and totalChunks are required together', 400)
      }
      if (chunkIndex > totalChunks) {
        return apiError('VALIDATION_ERROR', 'chunkIndex cannot be greater than totalChunks', 400)
      }

      const isFirstChunk = chunkIndex === 1
      const isFinalChunk = chunkIndex === totalChunks

      let state: WarehouseIngestSessionState
      if (isFirstChunk) {
        state = {
          warehouseId: params.id,
          previousPositiveSkus: await getPositiveWarehouseSkus(params.id),
          seenPositiveSkus: [],
          productsUpdated: 0,
          productsCreated: 0,
          existingProductsUpdated: 0,
          errors: [],
        }
      } else {
        const row = await db.query.syncJobs.findFirst({
          where: eq(syncJobs.id, runId),
        })
        if (!row?.message) {
          return apiError('NOT_FOUND', `Warehouse ingest session not found: ${runId}`, 404)
        }
        state = JSON.parse(row.message) as WarehouseIngestSessionState
      }

      const seenPositiveSkuSet = new Set(state.seenPositiveSkus)
      for (const snapshot of parsed.data.snapshots) {
        if (snapshot.quantity > 0) seenPositiveSkuSet.add(snapshot.sku)
      }

      const result = await applyWarehouseSnapshots(
        params.id,
        parsed.data.snapshots,
        parsed.data.triggeredBy,
        {
          resetExisting: isFirstChunk,
          updateWarehouseSynced: isFinalChunk,
          logOperation: isFinalChunk,
          existingPositiveSkus: isFinalChunk ? state.previousPositiveSkus : undefined,
          finalPositiveSkus: isFinalChunk ? [...seenPositiveSkuSet] : undefined,
        },
      )

      state = {
        warehouseId: state.warehouseId,
        previousPositiveSkus: state.previousPositiveSkus,
        seenPositiveSkus: [...seenPositiveSkuSet],
        productsUpdated: state.productsUpdated + result.productsUpdated,
        productsCreated: state.productsCreated + result.productsCreated,
        existingProductsUpdated: state.existingProductsUpdated + result.existingProductsUpdated,
        errors: [...state.errors, ...result.errors],
      }

      await db.insert(syncJobs).values({
        id: runId,
        jobType: 'warehouse_ingest',
        platform: params.id,
        batchId: runId,
        status: isFinalChunk ? (state.errors.length === 0 ? 'success' : 'error') : 'running',
        startedAt: new Date().toISOString(),
        finishedAt: isFinalChunk ? new Date().toISOString() : null,
        touched: state.productsUpdated,
        zeroed: isFinalChunk ? result.zeroedAbsent : 0,
        errorsCount: state.errors.length,
        message: JSON.stringify(state),
        triggeredBy: parsed.data.triggeredBy,
      }).onConflictDoUpdate({
        target: syncJobs.id,
        set: {
          status: isFinalChunk ? (state.errors.length === 0 ? 'success' : 'error') : 'running',
          finishedAt: isFinalChunk ? new Date().toISOString() : null,
          touched: state.productsUpdated,
          zeroed: isFinalChunk ? result.zeroedAbsent : 0,
          errorsCount: state.errors.length,
          message: JSON.stringify(state),
          triggeredBy: parsed.data.triggeredBy,
        },
      })

      return apiResponse({
        warehouseId: params.id,
        productsUpdated: state.productsUpdated,
        productsCreated: state.productsCreated,
        existingProductsUpdated: state.existingProductsUpdated,
        zeroedAbsent: isFinalChunk ? result.zeroedAbsent : 0,
        errors: state.errors,
        syncedAt: result.syncedAt,
        runId,
        chunkIndex,
        totalChunks,
        complete: isFinalChunk,
      })
    }

    const result = await applyWarehouseSnapshots(
      params.id,
      parsed.data.snapshots,
      parsed.data.triggeredBy,
    )
    return apiResponse(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError('INTERNAL_ERROR', message, 500)
  }
}
