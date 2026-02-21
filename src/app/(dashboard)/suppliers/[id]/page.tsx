'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function SupplierPage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useQuery({
    queryKey: ['supplier', params.id],
    queryFn:  () => apiFetch(`/api/suppliers/${params.id}`),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>
  const s = data?.data
  if (!s) return <p className="text-xs text-destructive">Supplier not found</p>

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-sm font-semibold">{s.name}</h1>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Row label="Contact" value={s.contact ?? '—'} />
        <Row label="Email"   value={s.email   ?? '—'} />
        <Row label="Phone"   value={s.phone   ?? '—'} />
      </div>

      {s.notes && <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">{s.notes}</p>}

      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Products ({s.products?.length ?? 0})</h2>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Title</th>
              <th className="text-left py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {s.products?.map((p: any) => (
              <tr key={p.id} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3 font-mono">
                  <Link href={`/products/${p.id}`} className="text-primary hover:underline">{p.id}</Link>
                </td>
                <td className="py-1 pr-3">{p.title}</td>
                <td className="py-1">
                  <span className={p.status === 'active' ? 'text-green-600' : 'text-muted-foreground'}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span>{value}</span>
    </div>
  )
}
