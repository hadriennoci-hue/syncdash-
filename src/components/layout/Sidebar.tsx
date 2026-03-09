'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, Store, Warehouse, ShoppingCart,
  Users, BarChart2, CheckSquare, RefreshCw, Video, Settings, Megaphone, Share2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type NavLinkItem = { href: string; label: string; icon: LucideIcon }
type NavSectionItem = { type: 'section'; label: string; icon: LucideIcon }
type NavItem = NavLinkItem | NavSectionItem

const nav: NavItem[] = [
  { href: '/',            label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/warehouses',  label: 'Warehouses',   icon: Warehouse },
  { href: '/channels',    label: 'Sale Channels', icon: Store },
  { href: '/orders',      label: 'Orders',       icon: ShoppingCart },
  { href: '/suppliers',   label: 'Suppliers',    icon: Users },
  { type: 'section',      label: 'Social Media', icon: Share2 },
  { href: '/social-media/pipeline', label: 'Pipeline', icon: Share2 },
  { href: '/social-media/performance', label: 'Performance', icon: BarChart2 },
  { type: 'section',      label: 'Ads',          icon: Megaphone },
  { href: '/ads/pipeline', label: 'Pipeline',    icon: Megaphone },
  { href: '/ads/performance', label: 'Performance', icon: BarChart2 },
  { href: '/tiktok',      label: 'TikTok',       icon: Video },
  { href: '/analyze',     label: 'Analysis',     icon: BarChart2 },
  { href: '/validate',    label: 'Validate',     icon: CheckSquare },
  { href: '/sync',        label: 'Sync Logs',    icon: RefreshCw },
  { href: '/settings',    label: 'Settings',     icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold tracking-tight">Wizhard</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {nav.map((item) => {
          if ('type' in item) {
            const Icon = item.icon
            return (
              <div
                key={`section-${item.label}`}
                className="flex items-center gap-2 px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </div>
            )
          }

          const { href, label, icon: Icon } = item as NavLinkItem
          const active = href === '/' ? pathname === href : pathname.startsWith(href)
          const isSubItem = href.startsWith('/ads/') || href.startsWith('/social-media/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 py-1.5 text-xs transition-colors',
                isSubItem ? 'pl-8 pr-4' : 'px-4',
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
