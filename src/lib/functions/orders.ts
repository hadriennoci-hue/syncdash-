import { db } from '@/lib/db/client'
import { orders, orderItems, warehouseStock } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { TriggeredBy } from '@/types/platform'
import type { ArrivalStatus } from '@/types/order'

interface CreateOrderInput {
  invoiceNumber: string
  supplierId?: string
  warehouseId?: string
  orderDate: string
  paid?: boolean
  sentToSupplier?: boolean
  items: Array<{
    productId: string
    quantity: number
    purchasePrice: number
  }>
}

export async function createOrder(
  input: CreateOrderInput,
  triggeredBy: TriggeredBy = 'human'
): Promise<string> {
  const orderId = generateId()

  await db.insert(orders).values({
    id:             orderId,
    invoiceNumber:  input.invoiceNumber,
    supplierId:     input.supplierId ?? null,
    warehouseId:    input.warehouseId ?? null,
    orderDate:      input.orderDate,
    paid:           input.paid ? 1 : 0,
    sentToSupplier: input.sentToSupplier ? 1 : 0,
    arrivalStatus:  'pending',
  })

  for (const item of input.items) {
    await db.insert(orderItems).values({
      id:            generateId(),
      orderId,
      productId:     item.productId,
      quantity:      item.quantity,
      purchasePrice: item.purchasePrice,
    })

    // Update quantity_ordered and last_order_date in warehouse_stock
    if (input.warehouseId) {
      await db.insert(warehouseStock).values({
        productId:       item.productId,
        warehouseId:     input.warehouseId,
        quantity:        0,
        quantityOrdered: item.quantity,
        lastOrderDate:   input.orderDate,
        purchasePrice:   item.purchasePrice,
        updatedAt:       new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [warehouseStock.productId, warehouseStock.warehouseId],
        set: {
          quantityOrdered: item.quantity,
          lastOrderDate:   input.orderDate,
          purchasePrice:   item.purchasePrice,
          updatedAt:       new Date().toISOString(),
        },
      })
    }
  }

  await logOperation({
    action:      'create_order',
    status:      'success',
    message:     `invoice=${input.invoiceNumber} items=${input.items.length}`,
    triggeredBy,
  })

  return orderId
}

interface UpdateOrderInput {
  paid?: boolean
  sentToSupplier?: boolean
  arrivalStatus?: ArrivalStatus
  itemsReceived?: Array<{ itemId: string; quantityReceived: number }>
}

export async function updateOrder(
  orderId: string,
  input: UpdateOrderInput,
  triggeredBy: TriggeredBy = 'human'
): Promise<void> {
  const set: Record<string, unknown> = {}
  if (input.paid !== undefined)           set.paid = input.paid ? 1 : 0
  if (input.sentToSupplier !== undefined) set.sentToSupplier = input.sentToSupplier ? 1 : 0
  if (input.arrivalStatus !== undefined)  set.arrivalStatus = input.arrivalStatus

  if (Object.keys(set).length > 0) {
    await db.update(orders).set(set).where(eq(orders.id, orderId))
  }

  if (input.itemsReceived) {
    for (const { itemId, quantityReceived } of input.itemsReceived) {
      await db.update(orderItems)
        .set({ quantityReceived })
        .where(eq(orderItems.id, itemId))
    }
  }

  await logOperation({
    action:      'update_order',
    status:      'success',
    message:     `orderId=${orderId}`,
    triggeredBy,
  })
}

// ---------------------------------------------------------------------------
// reconcileOrders — compare stock snapshots to open orders
// ---------------------------------------------------------------------------

export async function reconcileOrders(triggeredBy: TriggeredBy = 'system'): Promise<number> {
  const openOrders = await db.query.orders.findMany({
    where: eq(orders.arrivalStatus, 'pending'),
    with: { items: true },
  })

  let reconciled = 0

  for (const order of openOrders) {
    const items = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, order.id),
    })

    let allArrived = true
    let anyArrived = false

    for (const item of items) {
      if (!order.warehouseId) continue

      const stock = await db.query.warehouseStock.findFirst({
        where: and(
          eq(warehouseStock.productId, item.productId),
          eq(warehouseStock.warehouseId, order.warehouseId)
        ),
      })

      const received = stock?.quantity ?? 0
      const expected = item.quantity

      if (received >= expected) {
        anyArrived = true
        await db.update(orderItems)
          .set({ quantityReceived: expected })
          .where(eq(orderItems.id, item.id))
      } else if (received > 0) {
        anyArrived = true
        allArrived = false
        await db.update(orderItems)
          .set({ quantityReceived: received })
          .where(eq(orderItems.id, item.id))
      } else {
        allArrived = false
      }
    }

    if (anyArrived) {
      const newStatus: ArrivalStatus = allArrived ? 'arrived' : 'partial'
      await db.update(orders).set({ arrivalStatus: newStatus }).where(eq(orders.id, order.id))
      reconciled++
    }
  }

  await logOperation({
    action:      'reconcile_orders',
    status:      'success',
    message:     `reconciled=${reconciled}`,
    triggeredBy,
  })

  return reconciled
}
