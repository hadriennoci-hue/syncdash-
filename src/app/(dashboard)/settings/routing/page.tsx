'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiPut } from '@/lib/utils/api-fetch'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'

const WAREHOUSES = [
  { id: 'ireland',    label: 'Ireland (Shopify TikTok)' },
  { id: 'poland',     label: 'Poland' },
  { id: 'acer_store', label: 'ACER Store' },
  { id: 'dropshipping', label: 'Dropshipping' },
]

// Build a lookup: rules[warehouseId][platform] = priority (0 if missing = forbidden)
function buildMatrix(rules: Array<{ warehouseId: string; platform: string; priority: number }>) {
  const m: Record<string, Record<string, number>> = {}
  for (const wh of WAREHOUSES) {
    m[wh.id] = {}
    for (const pl of PLATFORMS) {
      m[wh.id][pl] = 0
    }
  }
  for (const r of rules) {
    if (m[r.warehouseId]) m[r.warehouseId][r.platform] = r.priority
  }
  return m
}

export default function RoutingPage() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['warehouse-rules'],
    queryFn:  () => apiFetch('/api/warehouses/rules'),
  })

  const update = useMutation({
    mutationFn: (payload: { warehouseId: string; platform: string; priority: number }) =>
      apiPut('/api/warehouses/rules', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-rules'] }),
  })

  const rules   = data?.data?.rules ?? []
  const matrix  = buildMatrix(rules)

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-sm font-semibold">Warehouse → Channel Routing</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Set the priority of each warehouse for each sales channel.
          Priority 1 = primary (used first), 2 = secondary (fallback).
          <strong> 0 / NO = warehouse stock is FORBIDDEN on that channel.</strong>
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 pr-4 font-medium w-40">Warehouse</th>
              {PLATFORMS.map((p) => (
                <th key={p} className="text-center py-2 px-3 font-medium">{PLATFORM_LABELS[p]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WAREHOUSES.map((wh) => (
              <tr key={wh.id} className="border-b border-border">
                <td className="py-2 pr-4 font-medium">{wh.label}</td>
                {PLATFORMS.map((pl) => {
                  const current = matrix[wh.id]?.[pl] ?? 0
                  return (
                    <td key={pl} className="py-2 px-3 text-center">
                      <select
                        value={current}
                        onChange={(e) =>
                          update.mutate({
                            warehouseId: wh.id,
                            platform:    pl,
                            priority:    Number(e.target.value),
                          })
                        }
                        className={`text-xs border rounded px-1.5 py-0.5 bg-background ${
                          current === 0
                            ? 'border-border text-muted-foreground'
                            : current === 1
                            ? 'border-green-500 text-green-700'
                            : 'border-amber-400 text-amber-700'
                        }`}
                      >
                        <option value={0}>NO</option>
                        <option value={1}>1 (primary)</option>
                        <option value={2}>2 (fallback)</option>
                        <option value={3}>3</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="text-xs text-muted-foreground space-y-1 border border-border rounded p-3">
        <p className="font-medium">Current rules (from seed):</p>
        <p>• Coincart: Ireland (1) → Acer Store (2) → Dropshipping (3) → Poland (NO)</p>
        <p>• Komputerzz: Ireland (1) → Acer Store (2) → Dropshipping (3) → Poland (NO)</p>
        <p>• eBay IE: Ireland (1) → Acer Store (2) → Dropshipping (3) → Poland (NO)</p>
        <p>• TikTok: Ireland (1) — Acer Store FORBIDDEN — Dropshipping FORBIDDEN — Poland (NO)</p>
        <p className="text-muted-foreground/60 mt-1">Stock pushed daily = SUM of quantities from all allowed warehouses.</p>
      </div>
    </div>
  )
}
