'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function SuppliersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn:  () => apiFetch('/api/suppliers'),
  })

  const suppliers = data?.data ?? []

  return (
    <div className="space-y-3">
      <h1 className="text-sm font-semibold">Suppliers</h1>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">Name</th>
              <th className="text-left py-1.5 pr-3 font-medium">Contact</th>
              <th className="text-left py-1.5 pr-3 font-medium">Email</th>
              <th className="text-left py-1.5 font-medium">Phone</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s: any) => (
              <tr key={s.id} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3">
                  <Link href={`/suppliers/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                </td>
                <td className="py-1 pr-3">{s.contact ?? '—'}</td>
                <td className="py-1 pr-3">{s.email ?? '—'}</td>
                <td className="py-1">{s.phone ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
