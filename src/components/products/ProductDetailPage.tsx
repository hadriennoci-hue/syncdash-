'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch, apiPatch, apiDelete } from '@/lib/utils/api-fetch'
import { PLATFORM_LABELS, WAREHOUSE_LABELS, PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'

interface AttributeRow {
  id: string
  name: string
  value: string
}

export function ProductDetailPage({ sku }: { sku: string }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', sku],
    queryFn: () => apiFetch(`/api/products/${sku}`),
  })

  const { data: collectionData } = useQuery({
    queryKey: ['collections'],
    queryFn: () => apiFetch('/api/collections'),
  })

  const [description, setDescription] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)
  const [tagsInput, setTagsInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const [savingCollections, setSavingCollections] = useState(false)
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [collectionFilter, setCollectionFilter] = useState('')

  async function setPushStatus(platform: Platform, status: 'N' | '2push' | 'done') {
    await apiPatch(`/api/products/${sku}/push-status`, { platform, status })
    qc.invalidateQueries({ queryKey: ['product', sku] })
  }

  async function deleteImage(imageId: string) {
    if (!confirm('Delete this image?')) return
    await apiDelete(`/api/products/${sku}/images/${imageId}`, { triggeredBy: 'human' })
    qc.invalidateQueries({ queryKey: ['product', sku] })
  }

  async function saveDescription() {
    setSavingDesc(true)
    try {
      await apiPatch(`/api/products/${sku}/local`, {
        fields: { description },
        triggeredBy: 'human',
      })
      qc.invalidateQueries({ queryKey: ['product', sku] })
    } finally {
      setSavingDesc(false)
    }
  }

  async function saveTags() {
    const tags = parseTagsInput(tagsInput)
    if (tags.length > 10) {
      setTagsError('You can save up to 10 tags.')
      return
    }

    setSavingTags(true)
    setTagsError('')
    try {
      await apiPatch(`/api/products/${sku}/local`, {
        fields: { tags },
        triggeredBy: 'human',
      })
      qc.invalidateQueries({ queryKey: ['product', sku] })
    } finally {
      setSavingTags(false)
    }
  }

  async function saveCollections() {
    setSavingCollections(true)
    try {
      await apiPatch(`/api/products/${sku}/local`, {
        fields: { collections: selectedCollections },
        triggeredBy: 'human',
      })
      qc.invalidateQueries({ queryKey: ['product', sku] })
    } finally {
      setSavingCollections(false)
    }
  }

  const p = data?.data
  const collections = (collectionData?.data ?? []) as Array<{ id: string; name: string; platform: string }>

  useEffect(() => {
    if (!p) return
    setDescription(p.description ?? '')
    setTagsInput((p.tags ?? []).join(', '))
    setSelectedCollections((p.collections ?? []).map((c: any) => c.id))
  }, [p?.description, p?.collections, p])

  const filteredCollections = useMemo(() => {
    const q = collectionFilter.trim().toLowerCase()
    if (!q) return collections
    return collections.filter((c) =>
      c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    )
  }, [collections, collectionFilter])

  const attributeRows = useMemo<AttributeRow[]>(() => {
    const metafields = Array.isArray(p?.metafields) ? p.metafields : []
    if (!metafields.length) return []

    const PRIORITY_KEYS = ['keyboard_layout', 'processor_brand', 'processor_model', 'ram', 'storage', 'gpu', 'screen_size', 'operating_system']

    return metafields
      .filter((m: any) => m?.namespace === 'attributes' && typeof m?.key === 'string')
      .sort((a: any, b: any) => {
        const ai = PRIORITY_KEYS.indexOf(a.key)
        const bi = PRIORITY_KEYS.indexOf(b.key)
        if (ai === -1 && bi === -1) return 0
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
      .map((m: any): AttributeRow => ({
        id: String(m.id),
        name: humanizeAttributeName(String(m.namespace ?? 'attributes'), String(m.key)),
        value: m.value == null || String(m.value).trim() === '' ? '-' : String(m.value),
      }))
  }, [p?.metafields])

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  if (error || !p) return <p className="text-xs text-destructive">Product not found</p>

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold">{p.title}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{sku}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/products/${sku}/edit`} className="text-xs border border-border rounded px-2 py-1 hover:bg-accent">Edit</Link>
          <span className={`text-xs px-2 py-1 rounded ${
            p.status === 'active'
              ? 'bg-green-100 text-green-700'
              : p.status === 'info'
                ? 'bg-red-100 text-red-600 font-semibold'
                : 'bg-muted text-muted-foreground'
          }`}>
            {p.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="col-span-1 space-y-3">
          {p.variantSiblings?.length > 0 && (
            <section className="border border-border rounded p-3 text-xs space-y-1.5">
              <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Keyboard Layout Family ({p.variantSiblings.length + 1} variants)</h2>
              <table className="w-full">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium py-0.5 pr-2">SKU</th>
                    <th className="text-left font-medium py-0.5">Keyboard Layout</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border bg-accent/30">
                    <td className="py-1 pr-2 font-mono">{p.id} <span className="text-muted-foreground">(this)</span></td>
                    <td className="py-1">
                      {p.metafields?.find((m: any) => m.namespace === 'attributes' && m.key === 'keyboard_layout')?.value ?? '-'}
                    </td>
                  </tr>
                  {p.variantSiblings.map((s: any) => (
                    <tr key={s.sku} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono">
                        <a href={`/products/${s.sku}`} className="text-primary hover:underline">{s.sku}</a>
                      </td>
                      <td className="py-1">{s.keyboardLayout ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="border border-border rounded p-3 space-y-1.5">
            <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Meta</h2>
            <Row label="Vendor" value={p.vendor ?? '-'} />
            <Row label="Type" value={p.productType ?? '-'} />
            <Row label="Tax code" value={p.taxCode ?? '-'} />
            <Row label="EAN" value={p.ean ?? '-'} />
            <Row label="Commodity" value={p.commodityCode ?? '-'} />
            <Row label="Origin" value={p.countryOfManufacture ?? '-'} />
            <Row label="Weight" value={p.weight != null ? `${p.weight} ${p.weightUnit ?? 'kg'}` : '-'} />
            <Row label="Featured" value={p.isFeatured ? 'Yes' : 'No'} />
            <Row
              label="Supplier"
              value={p.supplier
                ? <Link href={`/suppliers/${p.supplier.id}`} className="text-primary hover:underline">{p.supplier.name}</Link>
                : '-'}
            />
            <Row label="Localization" value={p.localization ?? '-'} />
            <Row label="Updated" value={p.updatedAt?.slice(0, 10) ?? '-'} />
          </section>
        </div>

        <section className="border border-border rounded p-3 space-y-2 text-xs col-span-2">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
            Images ({p.images?.length ?? 0}{(p.images?.length ?? 0) < 5 ? ' - needs 5+' : ''})
          </h2>
          {p.images?.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {p.images.map((img: any, i: number) => {
                const h = img.url ? (new URL(img.url).searchParams.get('height') ?? null) : null
                const w = img.url ? (new URL(img.url).searchParams.get('width') ?? null) : null
                const dims = h && w ? `${w}x${h}px` : null
                return (
                  <div key={i} className="flex flex-col gap-0.5">
                    <a href={img.url} target="_blank" rel="noreferrer">
                      <img
                        src={img.url}
                        alt={img.alt ?? ''}
                        className="h-36 w-36 object-contain rounded border border-border bg-muted/30 hover:opacity-80 transition-opacity"
                      />
                    </a>
                    {dims && <span className="text-[10px] text-muted-foreground text-center">{dims}</span>}
                    {img.id && (
                      <button
                        onClick={() => deleteImage(String(img.id))}
                        className="text-[10px] text-destructive hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-muted-foreground italic">No images</p>
          )}
        </section>
      </div>

      <section className="border border-border rounded p-3 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Description</h2>
          <button
            onClick={saveDescription}
            disabled={savingDesc}
            className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            {savingDesc ? 'Saving...' : 'Save'}
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          className="w-full text-xs border border-border rounded p-2 bg-background"
          placeholder="Enter product description..."
        />
      </section>

      <section className="border border-border rounded p-3 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Tags</h2>
          <button
            onClick={saveTags}
            disabled={savingTags}
            className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            {savingTags ? 'Saving...' : 'Save'}
          </button>
        </div>
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          className="w-full text-xs border border-border rounded p-2 bg-background"
          placeholder="Enter tags separated by commas (max 10)"
        />
        <p className="text-[10px] text-muted-foreground">One word per tag, separated by commas.</p>
        {tagsError && <p className="text-[10px] text-destructive">{tagsError}</p>}
      </section>

      <section className="border border-border rounded p-3 text-xs space-y-1.5">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
          Attributes (name / value)
        </h2>
        {attributeRows.length === 0 ? (
          <p className="text-muted-foreground italic">No attributes</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-0.5 pr-2">Attribute name</th>
                <th className="text-left font-medium py-0.5">Attribute value</th>
              </tr>
            </thead>
            <tbody>
              {attributeRows.map((attr) => (
                <tr key={attr.id} className="border-t border-border">
                  <td className="py-1 pr-2">{attr.name}</td>
                  <td className="py-1">{attr.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border border-border rounded p-3 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Collections</h2>
          <button
            onClick={saveCollections}
            disabled={savingCollections}
            className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            {savingCollections ? 'Saving...' : 'Save'}
          </button>
        </div>
        <input
          type="text"
          placeholder="Filter collections..."
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
          className="text-[11px] border border-border rounded px-2 py-1 bg-background w-full"
        />
        {filteredCollections.length > 0 ? (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredCollections.map((c) => {
              const checked = selectedCollections.includes(c.id)
              return (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedCollections((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                      )
                    }}
                  />
                  <span className="text-muted-foreground">[{c.platform}]</span>
                  <span>{c.name}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="text-muted-foreground italic">No collections</p>
        )}
      </section>

      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Channels</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Channel</th>
              <th className="text-left font-medium py-0.5 pr-2">Platform ID</th>
              <th className="text-left font-medium py-0.5 pr-2">Sync</th>
              <th className="text-left font-medium py-0.5 pr-2">Price</th>
              <th className="text-left font-medium py-0.5 pr-2">Promo</th>
              <th className="text-left font-medium py-0.5">Listing</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.platforms ?? {}).map(([pl, m]: [string, any]) => (
              <tr key={pl} className="border-t border-border">
                <td className="py-1 pr-2">
                  <Link href={`/channels/${pl}`} className="text-primary hover:underline">{PLATFORM_LABELS[pl as Platform] ?? pl}</Link>
                </td>
                <td className="py-1 pr-2 font-mono text-muted-foreground">{m.platformId ?? '-'}</td>
                <td className="py-1 pr-2">
                  <span className={m.syncStatus === 'synced' ? 'text-green-600' : 'text-amber-500'}>{m.syncStatus ?? '-'}</span>
                </td>
                <td className="py-1 pr-2">{p.prices?.[pl]?.price != null ? `EUR${p.prices[pl].price}` : '-'}</td>
                <td className="py-1 pr-2">{p.prices?.[pl]?.compareAt != null ? `EUR${p.prices[pl].compareAt}` : '-'}</td>
                <td className="py-1">
                  {m.listingUrl
                    ? <a href={m.listingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">view</a>
                    : <span className="text-muted-foreground/40">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Warehouse Stock</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Warehouse</th>
              <th className="text-left font-medium py-0.5 pr-2">Qty</th>
              <th className="text-left font-medium py-0.5 pr-2">Ordered</th>
              <th className="text-left font-medium py-0.5 pr-2">Purchase price</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.stock ?? {}).map(([wh, s]: [string, any]) => (
              <tr key={wh} className="border-t border-border">
                <td className="py-1 pr-2">
                  <Link href={`/warehouses/${wh}`} className="text-primary hover:underline">{WAREHOUSE_LABELS[wh as keyof typeof WAREHOUSE_LABELS] ?? wh}</Link>
                </td>
                <td className="py-1 pr-2">{s.quantity ?? '-'}</td>
                <td className="py-1 pr-2">{s.quantityOrdered ?? '-'}</td>
                <td className="py-1">{s.purchasePrice != null ? `EUR${s.purchasePrice}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded p-3 space-y-1.5 text-xs">
        <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Push to channels</h2>
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-0.5 pr-2">Channel</th>
              <th className="text-left font-medium py-0.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((pl) => {
              const current = p.pushStatus?.[pl] ?? 'N'
              return (
                <tr key={pl} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <Link href={`/channels/${pl}`} className="text-primary hover:underline">{PLATFORM_LABELS[pl]}</Link>
                  </td>
                  <td className="py-1">
                    <div className="flex gap-1">
                      {(['N', '2push', 'done'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setPushStatus(pl, s)}
                          className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                            current === s
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-accent'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {p.variants?.length > 0 && (
        <section className="border border-border rounded p-3 text-xs space-y-1.5">
          <h2 className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">Variants ({p.variants.length})</h2>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-0.5 pr-2">SKU</th>
                <th className="text-left font-medium py-0.5 pr-2">Title</th>
                <th className="text-left font-medium py-0.5 pr-2">Price</th>
                <th className="text-left font-medium py-0.5 pr-2">Stock</th>
                <th className="text-left font-medium py-0.5">Options</th>
              </tr>
            </thead>
            <tbody>
              {p.variants.map((v: any) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="py-1 pr-2 font-mono">{v.sku ?? '-'}</td>
                  <td className="py-1 pr-2">{v.title ?? '-'}</td>
                  <td className="py-1 pr-2">{v.price != null ? `EUR${v.price}` : '-'}</td>
                  <td className="py-1 pr-2">{v.stock ?? '-'}</td>
                  <td className="py-1">
                    {[
                      v.option1 ? `${v.optionName1 ?? 'Option 1'}: ${v.option1}` : null,
                      v.option2 ? `${v.optionName2 ?? 'Option 2'}: ${v.option2}` : null,
                      v.option3 ? `${v.optionName3 ?? 'Option 3'}: ${v.option3}` : null,
                    ].filter(Boolean).join(' / ') || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function parseTagsInput(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const raw of value.split(',')) {
    const tag = raw.trim()
    if (!tag || /\s/.test(tag)) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  return tags
}

function humanizeAttributeName(namespace: string, key: string): string {
  const label = key.replace(/[._-]+/g, ' ').trim().toLowerCase()
  if (namespace === 'attributes' || namespace.trim() === '') {
    return capitalizeWords(label)
  }
  return `${capitalizeWords(namespace.replace(/[._-]+/g, ' ').trim())} / ${capitalizeWords(label)}`
}

function capitalizeWords(value: string): string {
  return value.replace(/\b\w/g, (ch) => ch.toUpperCase())
}
