'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/utils/api-fetch'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'

export default function NewProductPage() {
  const router  = useRouter()
  const [error, setError] = useState('')
  const [form, setForm]   = useState({
    sku:      '',
    title:    '',
    vendor:   '',
    platforms: ['shopify_komputerzz'],
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await apiPost('/api/products', { ...form, triggeredBy: 'human' })
      router.push(`/products/${form.sku}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <h1 className="text-sm font-semibold">New Product</h1>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Field label="SKU *">
        <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" placeholder="e.g. LAPTOP-001" />
      </Field>

      <Field label="Title *">
        <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" placeholder="Product title" />
      </Field>

      <Field label="Vendor">
        <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" placeholder="Brand or vendor name" />
      </Field>

      <Field label="Push to platforms">
        <div className="space-y-1">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.platforms.includes(p)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...form.platforms, p]
                    : form.platforms.filter((x) => x !== p)
                  setForm({ ...form, platforms: next })
                }}
              />
              {PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
      </Field>

      <div className="flex gap-2">
        <button type="submit" className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">
          Create product
        </button>
        <button type="button" onClick={() => router.back()}
          className="text-xs border border-border px-3 py-1.5 rounded hover:bg-accent">
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
