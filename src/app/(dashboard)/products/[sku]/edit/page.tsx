'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, apiPatch } from '@/lib/utils/api-fetch'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'

export default function EditProductPage({ params }: { params: { sku: string } }) {
  const router = useRouter()
  const { data } = useQuery({
    queryKey: ['product', params.sku],
    queryFn:  () => apiFetch(`/api/products/${params.sku}`),
  })

  const p = data?.data
  const [form, setForm] = useState({
    title: '', description: '', status: 'active', isFeatured: false,
    ean: '', commodityCode: '', customsDescription: '', countryOfManufacture: '',
    weight: '', weightUnit: 'kg',
    platforms: PLATFORMS as unknown as string[],
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (p) {
      setForm({
        title:                p.title                ?? '',
        description:          p.description          ?? '',
        status:               p.status               ?? 'active',
        isFeatured:           !!p.isFeatured,
        ean:                  p.ean                  ?? '',
        commodityCode:        p.commodityCode         ?? '',
        customsDescription:   p.customsDescription   ?? '',
        countryOfManufacture: p.countryOfManufacture ?? '',
        weight:               p.weight != null ? String(p.weight) : '',
        weightUnit:           p.weightUnit            ?? 'kg',
        platforms:            PLATFORMS as unknown as string[],
      })
    }
  }, [p])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await apiPatch(`/api/products/${params.sku}`, {
        fields: {
          title: form.title, description: form.description,
          status: form.status as 'active' | 'archived', isFeatured: form.isFeatured,
          ean: form.ean || undefined,
          commodityCode: form.commodityCode || undefined,
          customsDescription: form.customsDescription || undefined,
          countryOfManufacture: form.countryOfManufacture || undefined,
          weight: form.weight ? Number(form.weight) : undefined,
          weightUnit: form.weightUnit || undefined,
        },
        platforms:   form.platforms,
        triggeredBy: 'human',
      })
      router.push(`/products/${params.sku}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (!p) return <p className="text-xs text-muted-foreground">Loading...</p>

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <h1 className="text-sm font-semibold">Edit {params.sku}</h1>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Title</label>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={6} className="w-full text-xs border border-border rounded px-2 py-1 bg-background" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">EAN (13 digits)</label>
          <input value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })}
            maxLength={13} placeholder="e.g. 5901234123457"
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background font-mono" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Country of manufacture</label>
          <input value={form.countryOfManufacture} onChange={(e) => setForm({ ...form, countryOfManufacture: e.target.value })}
            placeholder="e.g. CN"
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Commodity code (HS)</label>
          <input value={form.commodityCode} onChange={(e) => setForm({ ...form, commodityCode: e.target.value })}
            placeholder="e.g. 8471.30.0000"
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background font-mono" />
        </div>
        <div className="space-y-1 flex gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Weight</label>
            <input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })}
              step="0.01" min="0" placeholder="0.00"
              className="w-full text-xs border border-border rounded px-2 py-1 bg-background" />
          </div>
          <div className="space-y-1 w-16">
            <label className="text-xs text-muted-foreground">Unit</label>
            <select value={form.weightUnit} onChange={(e) => setForm({ ...form, weightUnit: e.target.value })}
              className="w-full text-xs border border-border rounded px-2 py-1 bg-background">
              <option value="kg">kg</option>
              <option value="g">g</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Customs description</label>
        <input value={form.customsDescription} onChange={(e) => setForm({ ...form, customsDescription: e.target.value })}
          placeholder="Description for customs declarations"
          className="w-full text-xs border border-border rounded px-2 py-1 bg-background" />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Status</label>
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
          className="text-xs border border-border rounded px-2 py-1 bg-background">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
        Featured product
      </label>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Push to</label>
        <div className="space-y-1">
          {PLATFORMS.map((pl) => (
            <label key={pl} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.platforms.includes(pl)}
                onChange={(e) => {
                  const next = e.target.checked ? [...form.platforms, pl] : form.platforms.filter((x) => x !== pl)
                  setForm({ ...form, platforms: next })
                }} />
              {PLATFORM_LABELS[pl]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90">Save</button>
        <button type="button" onClick={() => router.back()} className="text-xs border border-border px-3 py-1.5 rounded hover:bg-accent">Cancel</button>
      </div>
    </form>
  )
}
