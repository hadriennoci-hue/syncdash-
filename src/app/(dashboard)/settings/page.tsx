'use client'

import Link from 'next/link'

export default function SettingsPage() {
  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-sm font-semibold">Settings</h1>

      <div className="space-y-2">
        <Link href="/settings/routing"
          className="flex items-center justify-between border border-border rounded p-3 hover:bg-accent transition-colors text-xs">
          <div>
            <div className="font-medium">Warehouse → channel routing</div>
            <div className="text-muted-foreground mt-0.5">Set which warehouses supply which channels and in what priority order</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
        <Link href="/settings/import"
          className="flex items-center justify-between border border-border rounded p-3 hover:bg-accent transition-colors text-xs">
          <div>
            <div className="font-medium">Import from platform</div>
            <div className="text-muted-foreground mt-0.5">One-time import of products from Komputerzz or other channels</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>

      <div className="border border-border rounded p-3 text-xs space-y-2">
        <h2 className="font-medium">Environment</h2>
        <div className="text-muted-foreground space-y-1">
          <div>Coincart2: {process.env.NEXT_PUBLIC_COINCART_URL ?? 'configured'}</div>
          <div>Shopify Komputerzz: configured</div>
          <div>Shopify TikTok: configured</div>
          <div>eBay Ireland: configured</div>
        </div>
      </div>
    </div>
  )
}
