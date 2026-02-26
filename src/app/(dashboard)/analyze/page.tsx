'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiFetch } from '@/lib/utils/api-fetch'
import { INCONSISTENCY_LABELS, type InconsistencyType } from '@/types/analysis'

export default function AnalyzePage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['analyze'],
    queryFn:  () => apiFetch('/api/analyze'),
  })

  const reports = data?.data ?? []
  const issues  = reports.filter((r: any) => r.inconsistencies?.length > 0)

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Analysis ({issues.length} products with issues)</h1>
        <button onClick={() => refetch()} className="text-xs border border-border px-2 py-1 rounded hover:bg-accent">Refresh</button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Analyzing...</p>
      ) : issues.length === 0 ? (
        <p className="text-xs text-green-600">No inconsistencies found.</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 pr-3 font-medium">SKU</th>
              <th className="text-left py-1.5 pr-3 font-medium">Title</th>
              <th className="text-left py-1.5 font-medium">Issues</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((r: any) => (
              <tr key={r.sku} className="border-b border-border hover:bg-accent/50">
                <td className="py-1 pr-3 font-mono">
                  <Link href={`/products/${r.sku}`} className="text-primary hover:underline">{r.sku}</Link>
                </td>
                <td className="py-1 pr-3 max-w-xs truncate">{r.title}</td>
                <td className="py-1">
                  <div className="flex flex-wrap gap-1">
                    {r.inconsistencies.map((inc: any) => (
                      <span key={inc.type} className="bg-amber-100 text-amber-700 px-1 rounded text-[10px]">
                        {INCONSISTENCY_LABELS[inc.type as InconsistencyType] ?? inc.type}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
