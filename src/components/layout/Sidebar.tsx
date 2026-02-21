'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, Package, Store, Warehouse, ShoppingCart,
  Users, BarChart2, Link2, CheckSquare, RefreshCw, Video, Settings,
} from 'lucide-react'

const nav = [
  { href: '/',            label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/products',    label: 'Products',     icon: Package },
  { href: '/channels',    label: 'Channels',     icon: Store },
  { href: '/warehouses',  label: 'Warehouses',   icon: Warehouse },
  { href: '/orders',      label: 'Orders',       icon: ShoppingCart },
  { href: '/suppliers',   label: 'Suppliers',    icon: Users },
  { href: '/analyze',     label: 'Analysis',     icon: BarChart2 },
  { href: '/mappings',    label: 'Mappings',     icon: Link2 },
  { href: '/validate',    label: 'Validate',     icon: CheckSquare },
  { href: '/sync',        label: 'Sync Logs',    icon: RefreshCw },
  { href: '/tiktok',      label: 'TikTok',       icon: Video },
  { href: '/settings',    label: 'Settings',     icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold tracking-tight">SyncDash</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 text-xs transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
