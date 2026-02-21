'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/utils/api-fetch'

export default function NewOrderPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [warehouseId, setWarehouseId]       = useState('acer_store')
  const [supplierId, setSupplierId]         = useState('')
  const [invoiceNumber, setInvoiceNumber]   = useState('')
  const [items, setItems] = useState([{ productId: '', quantity: 1, purchasePrice: '' }])

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
        supplierId:    supplierId   || undefined,
        warehouseId,
        items: items.map((it) => ({
          productId:     it.productId,
          quantity:      Number(it.quantity),
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
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <h1 className="text-sm font-semibold">New Purchase Order</h1>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Invoice #</label>
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background" placeholder="Optional" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Warehouse *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background">
            <option value="acer_store">ACER Store</option>
            <option value="ireland">Ireland</option>
            <option value="poland">Poland</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Supplier ID</label>
        <input value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" placeholder="Optional" />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Items</label>
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input value={item.productId} onChange={(e) => updateItem(i, 'productId', e.target.value)}
              placeholder="SKU" className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background font-mono" />
            <input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)}
              min={1} placeholder="Qty" className="w-16 text-xs border border-border rounded px-2 py-1 bg-background" />
            <input value={item.purchasePrice} onChange={(e) => updateItem(i, 'purchasePrice', e.target.value)}
              placeholder="€ price" className="w-20 text-xs border border-border rounded px-2 py-1 bg-background" />
          </div>
        ))}
        <button type="button" onClick={addItem} className="text-xs text-primary hover:underline">+ Add item</button>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">Create order</button>
        <button type="button" onClick={() => router.back()} className="text-xs border border-border px-3 py-1.5 rounded hover:bg-accent">Cancel</button>
      </div>
    </form>
  )
}
