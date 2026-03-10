'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard, Store, Warehouse, ShoppingCart,
  Users, CheckSquare, RefreshCw, Video, Settings, Megaphone, Share2,
  Rss, TrendingUp, Layers, LineChart, PieChart,
  ChevronsRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ---- nav config ----

type NavLink = { href: string; label: string; icon: LucideIcon; sub?: boolean }
type NavSection = { type: 'section'; label: string }
type NavItem = NavLink | NavSection

const nav: NavItem[] = [
  { href: '/',                          label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/warehouses',                label: 'Warehouses',   icon: Warehouse },
  { href: '/channels',                  label: 'Sale Channels', icon: Store },
  { href: '/orders',                    label: 'Orders',       icon: ShoppingCart },
  { href: '/suppliers',                 label: 'Suppliers',    icon: Users },
  { type: 'section',                    label: 'Social Media' },
  { href: '/social-media/pipeline',     label: 'Pipeline',     icon: Rss,       sub: true },
  { href: '/social-media/performance',  label: 'Performance',  icon: TrendingUp, sub: true },
  { type: 'section',                    label: 'Ads' },
  { href: '/ads/pipeline',              label: 'Pipeline',     icon: Layers,    sub: true },
  { href: '/ads/performance',           label: 'Performance',  icon: LineChart,  sub: true },
  { href: '/tiktok',                    label: 'TikTok',       icon: Video },
  { href: '/analyze',                   label: 'Analysis',     icon: PieChart },
  { href: '/validate',                  label: 'Validate',     icon: CheckSquare },
  { href: '/sync',                      label: 'Sync Logs',    icon: RefreshCw },
  { href: '/settings',                  label: 'Settings',     icon: Settings },
]

// ---- sub-components ----

function Logo() {
  return (
    <div className="grid size-8 shrink-0 place-content-center rounded-lg bg-[#1E2A44] border border-[#35A7FF]/40">
      <span className="text-[15px] leading-none text-[#35A7FF]">◉</span>
    </div>
  )
}

function TitleSection({ open }: { open: boolean }) {
  return (
    <div className="mb-2 border-b border-[#1E2A44] pb-2 px-1">
      <div className="flex items-center gap-2.5 rounded-md px-1 py-1">
        <Logo />
        {open && (
          <div>
            <span className="block text-sm font-bold tracking-wide text-[#E6ECFF]" style={{ fontFamily: 'var(--font-heading), serif' }}>
              WIZHARD
            </span>
            <span className="block text-[9px] text-[#8FA0C7]">Master Catalogue</span>
          </div>
        )}
      </div>
    </div>
  )
}

function NavOption({
  href, label, icon: Icon, sub = false, open, active,
}: NavLink & { open: boolean; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'relative flex h-8 w-full items-center rounded-md transition-all duration-150',
        active
          ? 'border-l-2 border-[#35A7FF] bg-[#1E2A44] text-[#E6ECFF]'
          : 'border-l-2 border-transparent text-[#8FA0C7] hover:bg-[#1E2A44]/60 hover:text-[#E6ECFF]',
        open && sub ? 'pl-0' : '',
      )}
    >
      <div className={cn('grid h-full shrink-0 place-content-center', open && sub ? 'w-14' : 'w-12')}>
        <Icon className="h-4 w-4" />
      </div>
      {open && (
        <span className="text-xs font-medium truncate">{label}</span>
      )}
    </Link>
  )
}

function SectionDivider({ label, open }: { label: string; open: boolean }) {
  if (!open) {
    return <div className="mx-3 my-1 h-px bg-[#1E2A44]" />
  }
  return (
    <div className="px-4 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#8FA0C7]/70">
      {label}
    </div>
  )
}

function ToggleClose({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  return (
    <button
      onClick={() => setOpen(!open)}
      className="absolute bottom-0 left-0 right-0 flex items-center border-t border-[#1E2A44] p-3 transition-colors hover:bg-[#1E2A44]/60"
    >
      <div className="grid size-10 shrink-0 place-content-center">
        <ChevronsRight
          className={cn(
            'h-4 w-4 text-[#8FA0C7] transition-transform duration-300',
            open && 'rotate-180',
          )}
        />
      </div>
      {open && (
        <span className="text-xs font-medium text-[#8FA0C7]">Collapse</span>
      )}
    </button>
  )
}

// ---- main ----

export function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(true)

  function isActive(href: string) {
    return href === '/' ? pathname === href : pathname.startsWith(href)
  }

  return (
    <nav
      className={cn(
        'relative sticky top-0 h-screen shrink-0 border-r border-[#1E2A44] bg-[#0B1328] transition-all duration-300 ease-in-out',
        open ? 'w-56' : 'w-16',
      )}
    >
      <div className="flex h-full flex-col overflow-hidden pb-12 pt-2">
        <div className="px-2">
          <TitleSection open={open} />
        </div>

        <div className="flex-1 overflow-hidden px-2 space-y-0">
          {nav.map((item, i) => {
            if ('type' in item) {
              return <SectionDivider key={`section-${i}`} label={item.label} open={open} />
            }
            return (
              <NavOption
                key={item.href}
                {...item}
                open={open}
                active={isActive(item.href)}
              />
            )
          })}
        </div>
      </div>

      <ToggleClose open={open} setOpen={setOpen} />
    </nav>
  )
}
