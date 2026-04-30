import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { syncWarehouse } from '@/lib/functions/warehouses'
import { db } from '@/lib/db/client'
import { requestRunnerWake } from '@/lib/functions/runner-signal'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  productsCreated: number
  existingProductsUpdated: number
  zeroedAbsent: number
  errors: string[]
  syncedAt: string
  skipped?: boolean
  message?: string
}

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const all = await db.query.warehouses.findMany()
  const priorities: Record<string, number> = {
    ireland: 1,
    acer_store: 2,
  }
  const ordered = [...all].sort((a, b) => (priorities[a.id] ?? 100) - (priorities[b.id] ?? 100))

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const results: WarehouseSyncResult[] = []
      const push = (event: string, data: unknown) => controller.enqueue(encoder.encode(toSse(event, data)))

      void (async () => {
        push('scan_start', { totalWarehouses: ordered.length })

        for (let index = 0; index < ordered.length; index++) {
          const warehouse = ordered[index]
          push('warehouse_start', {
            warehouseId: warehouse.id,
            warehouseIndex: index + 1,
            warehouseTotal: ordered.length,
          })

          try {
            if (warehouse.id === 'acer_store') {
              await requestRunnerWake('acer-stock', 'sync-all-stream')
              const queued: WarehouseSyncResult & { queued: boolean; message: string } = {
                warehouseId: 'acer_store',
                productsUpdated: 0,
                productsCreated: 0,
                existingProductsUpdated: 0,
                zeroedAbsent: 0,
                errors: [],
                syncedAt: new Date().toISOString(),
                queued: true,
                message: 'ACER stock scan queued on local runner (async; dashboard result will stay queued until refresh)',
              }
              results.push(queued)
              push('progress', {
                warehouseId: warehouse.id,
                warehouseIndex: index + 1,
                warehouseTotal: ordered.length,
                stage: 'fetch_done',
                message: 'ACER stock scan queued on local runner (async; wait for runner completion, then refresh summary)',
                current: 1,
                total: 1,
              })
              push('warehouse_result', queued)
              continue
            }
            if (warehouse.id === 'dropshipping') {
              const skipped: WarehouseSyncResult = {
                warehouseId: warehouse.id,
                productsUpdated: 0,
                productsCreated: 0,
                existingProductsUpdated: 0,
                zeroedAbsent: 0,
                errors: [],
                syncedAt: new Date().toISOString(),
                skipped: true,
                message: 'Manual warehouse - scan skipped',
              }
              results.push(skipped)
              push('progress', {
                warehouseId: warehouse.id,
                warehouseIndex: index + 1,
                warehouseTotal: ordered.length,
                stage: 'skipped',
                message: 'Manual warehouse - scan skipped',
                current: 1,
                total: 1,
              })
              push('warehouse_result', skipped)
              continue
            }

            const result = await syncWarehouse(warehouse.id, 'human', {
              onProgress: (progress) => {
                push('progress', {
                  warehouseId: warehouse.id,
                  warehouseIndex: index + 1,
                  warehouseTotal: ordered.length,
                  ...progress,
                })
              },
            })
            results.push(result)
            push('warehouse_result', result)
          } catch (err) {
            const fallback: WarehouseSyncResult = {
              warehouseId: warehouse.id,
              productsUpdated: 0,
              productsCreated: 0,
              existingProductsUpdated: 0,
              zeroedAbsent: 0,
              errors: [err instanceof Error ? err.message : 'Unknown error'],
              syncedAt: new Date().toISOString(),
            }
            results.push(fallback)
            push('warehouse_result', fallback)
          }
        }

        push('scan_done', { results })
        controller.close()
      })().catch((err) => {
        push('stream_error', { message: err instanceof Error ? err.message : 'Unknown error' })
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
