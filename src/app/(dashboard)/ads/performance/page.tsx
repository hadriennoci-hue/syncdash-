import Link from 'next/link'

const PROVIDERS = [
  { href: '/ads/performance/google-ads', label: 'Google Ads', sub: 'Search and commerce campaign performance' },
  { href: '/ads/performance/x-ads', label: 'X Ads', sub: 'Promoted tweet engagement performance' },
  { href: '/ads/performance/tiktok-ads', label: 'TikTok Ads', sub: 'Provider-specific campaign performance' },
]

export default function AdsPerformanceIndexPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-semibold">Ads Performance</h1>
        <p className="text-xs text-muted-foreground">Provider-specific screens are separated for now.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROVIDERS.map((provider) => (
          <Link key={provider.href} href={provider.href} className="border border-border rounded p-4 hover:bg-muted/20 transition-colors">
            <div className="text-sm font-medium">{provider.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{provider.sub}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
