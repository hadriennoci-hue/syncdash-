'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'

export default function ValidatePage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['validate-coincart2'],
    queryFn:  () => apiFetch('/api/validate/coincart2-readiness'),
  })

  const d = data?.data

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Coincart2 Readiness</h1>
        <button onClick={() => refetch()} className="text-xs border border-border px-2 py-1 rounded hover:bg-accent">Refresh</button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Validating...</p>
      ) : d ? (
        <>
          <div className="flex gap-4 text-xs">
            <span>Total: {d.total}</span>
            <span className="text-green-600">Ready: {d.ready}</span>
            <span className="text-amber-500">Not ready: {d.notReady}</span>
          </div>

          {d.issues?.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Title</th>
                  <th className="text-left py-1.5 font-medium">Missing</th>
                </tr>
              </thead>
              <tbody>
                {d.issues.map((issue: any) => (
                  <tr key={issue.sku} className="border-b border-border hover:bg-accent/50">
                    <td className="py-1 pr-3 font-mono">
                      <Link href={`/products/${issue.sku}`} className="text-primary hover:underline">{issue.sku}</Link>
                    </td>
                    <td className="py-1 pr-3 max-w-xs truncate">{issue.title}</td>
                    <td className="py-1">
                      <div className="flex flex-wrap gap-1">
                        {issue.reasons.map((r: string) => (
                          <span key={r} className="bg-amber-100 text-amber-700 px-1 rounded text-[10px]">{r.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  )
}

