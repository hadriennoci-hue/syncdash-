'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiFetch, apiPost } from '@/lib/utils/api-fetch'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

export default function NewOrderPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [warehouseId, setWarehouseId] = useState('acer_store')
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [orderDate, setOrderDate] = useState(todayIsoDate())
  const [items, setItems] = useState([{ productId: '', quantity: 1, purchasePrice: '' }])

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch('/api/suppliers'),
  })

  const suppliers = suppliersData?.data ?? []

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, it) => {
      const qty = Number(it.quantity)
      const unit = Number(it.purchasePrice)
      if (!Number.isFinite(qty) || !Number.isFinite(unit)) return sum
      return sum + qty * unit
    }, 0)
    const vat = subtotal * 0.2
    const total = subtotal + vat
    return { subtotal, vat, total }
  }, [items])

  function addItem() {
    setItems([...items, { productId: '', quantity: 1, purchasePrice: '' }])
  }

  function updateItem(i: number, field: string, value: string | number) {
    const next = [...items]
    next[i] = { ...next[i], [field]: value }
    setItems(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await apiPost('/api/orders', {
        invoiceNumber: invoiceNumber || undefined,
        supplierId: supplierId || undefined,
        warehouseId,
        orderDate,
        items: items.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          purchasePrice: it.purchasePrice ? Number(it.purchasePrice) : undefined,
        })),
        triggeredBy: 'human',
      })
      router.push(`/orders/${res.data.id}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <h1 className="text-sm font-semibold">New Purchase Order</h1>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Invoice #</label>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Warehouse *</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
          >
            <option value="acer_store">ACER Store</option>
            <option value="dropshipping">Dropshipping</option>
            <option value="ireland">Ireland</option>
            <option value="poland">Poland</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
          >
            <option value="">Optional</option>
            {suppliers.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Order date</label>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Items</label>

        <div className="grid grid-cols-[1fr_120px_140px] gap-2 text-[11px] text-muted-foreground px-1">
          <div>SKU</div>
          <div>Quantity</div>
          <div>Unit price (EUR)</div>
        </div>

        {items.map((item, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_140px] gap-2 items-center">
            <input
              value={item.productId}
              onChange={(e) => updateItem(i, 'productId', e.target.value)}
              placeholder="SKU"
              className="text-xs border border-border rounded px-2 py-1 bg-background font-mono"
            />
            <input
              type="number"
              value={item.quantity}
              onChange={(e) => updateItem(i, 'quantity', e.target.value)}
              min={1}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={item.purchasePrice}
              onChange={(e) => updateItem(i, 'purchasePrice', e.target.value)}
              placeholder="0.00"
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            />
          </div>
        ))}

        <button type="button" onClick={addItem} className="text-xs text-primary hover:underline">
          + Add item
        </button>
      </div>

      <div className="border border-border rounded p-3 text-xs space-y-1 max-w-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total without taxes (HT)</span>
          <span>EUR {totals.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">VAT (20%)</span>
          <span>EUR {totals.vat.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Total with taxes (TTC)</span>
          <span>EUR {totals.total.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">
          Create order
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xs border border-border px-3 py-1.5 rounded hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
