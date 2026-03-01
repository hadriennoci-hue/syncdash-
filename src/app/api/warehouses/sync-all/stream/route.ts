import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { syncWarehouse } from '@/lib/functions/warehouses'
import { db } from '@/lib/db/client'

interface WarehouseSyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
  syncedAt: string
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
