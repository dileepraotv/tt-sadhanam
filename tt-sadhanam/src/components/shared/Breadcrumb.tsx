/**
 * Breadcrumb — consistent breadcrumb navigation strip.
 *
 * Renders a sticky sub-bar below the main Header on admin and public pages.
 * Accepts an array of { label, href? } items; last item is always non-linked.
 *
 * Usage (server component):
 *   <Breadcrumb items={[
 *     { label: 'Championships', href: '/admin/championships' },
 *     { label: 'National 2026', href: '/admin/championships/abc' },
 *     { label: 'Men\'s Singles' },   // current page — no href
 *   ]} />
 */

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface Props {
  items:   BreadcrumbItem[]
  /** 'admin' = orange-tinted bg; 'public' = slightly lighter tint */
  variant?: 'admin' | 'public'
}

export function Breadcrumb({ items, variant = 'public' }: Props) {
  if (items.length === 0) return null

  const bgClass = variant === 'admin'
    ? 'bg-orange-800/25 border-orange-600/25'
    : 'bg-orange-700/18 border-orange-500/20'

  return (
    <nav
      aria-label="Breadcrumb"
      className={`border-b ${bgClass}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2">
        <ol className="flex items-center gap-1 flex-wrap">
          {/* Always prepend Home */}
          <li className="flex items-center gap-1 shrink-0">
            <Link href="/" className="text-white/60 hover:text-white transition-colors">
              <Home className="h-3.5 w-3.5" />
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
          </li>

          {items.map((item, i) => {
            const isLast = i === items.length - 1
            return (
              <li key={i} className="flex items-center gap-1 min-w-0">
                {isLast ? (
                  <span className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-[280px]">
                    {item.label}
                  </span>
                ) : (
                  <>
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="text-sm text-white/70 hover:text-white transition-colors truncate max-w-[150px]"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-sm text-white/70 truncate max-w-[150px]">
                        {item.label}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                  </>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
