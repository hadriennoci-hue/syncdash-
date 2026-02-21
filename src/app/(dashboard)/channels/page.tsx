'use client'

import Link from 'next/link'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'

export default function ChannelsPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-sm font-semibold">Channels</h1>
      <div className="grid grid-cols-3 gap-3">
        {PLATFORMS.map((p) => (
          <Link key={p} href={`/channels/${p}`}
            className="border border-border rounded p-4 hover:bg-accent transition-colors text-xs">
            <div className="font-medium">{PLATFORM_LABELS[p]}</div>
            <div className="text-muted-foreground mt-1 font-mono">{p}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
