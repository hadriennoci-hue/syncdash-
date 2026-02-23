'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiPost } from '@/lib/utils/api-fetch'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'

export default function ImportPage() {
  const [platform, setPlatform] = useState<string>('shopify_komputerzz')
  const [mode, setMode]         = useState<string>('full')
  const [result, setResult]     = useState<any>(null)
  const [error, setError]       = useState('')

  const doImport = useMutation({
    mutationFn: () => apiPost(`/api/import/${platform}`, { mode, triggeredBy: 'human' }),
    onSuccess:  (data) => { setResult(data?.data); setError('') },
    onError:    (err: any) => { setError(err.message); setResult(null) },
  })

  return (
    <div className="space-y-4 max-w-md">
      <h1 className="text-sm font-semibold">Import from Platform</h1>
      <p className="text-xs text-muted-foreground">
        Imports all products from the selected platform into SyncDash D1. Use <strong>full</strong> for the initial Phase A import.
      </p>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}
            className="w-full text-xs border border-border rounded px-2 py-1 bg-background">
            <option value="full">Full (replace all)</option>
            <option value="new_changed">New / changed products</option>
          </select>
        </div>

        <button
          onClick={() => doImport.mutate()}
          disabled={doImport.isPending}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
        >
          {doImport.isPending ? 'Importing...' : `Import from ${PLATFORM_LABELS[platform] ?? platform}`}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <div className="border border-border rounded p-3 text-xs space-y-1">
          <p className="font-medium">Import complete</p>
          <p>Imported: {result.imported}</p>
          <p>Updated: {result.updated}</p>
          <p>Errors: {result.errors}</p>
        </div>
      )}
    </div>
  )
}
