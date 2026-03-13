/**
 * NextStepBanner
 *
 * A consistent orange CTA that tells the admin exactly what to do next.
 * Used uniformly across ALL stage formats:
 *   • SingleKOStage
 *   • SingleRRStage
 *   • MultiStagePanel (stage 1 and stage 2)
 *   • PlayerManager (navigates to groups tab)
 *
 * Variants:
 *   info     — grey, informational (no action needed yet)
 *   warning  — amber, something needs attention
 *   action   — orange, primary CTA (clickable)
 *   success  — green, step complete
 *   locked   — slate, step locked/unavailable
 */

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowRight, CheckCircle2, Lock, Info, AlertTriangle } from 'lucide-react'

type Variant = 'info' | 'warning' | 'action' | 'success' | 'locked'

interface NextStepBannerProps {
  variant:     Variant
  step?:       string          // e.g. "Step 1 of 3"
  title:       string
  description?: string
  href?:       string          // if provided, renders as a <Link>
  onClick?:    () => void      // if provided, renders as a <button>
  className?:  string
}

export function NextStepBanner({
  variant, step, title, description, href, onClick, className,
}: NextStepBannerProps) {
  const isClickable = !!(href || onClick)

  const styles: Record<Variant, { wrap: string; icon: React.ReactNode; arrow?: boolean }> = {
    action:  {
      wrap: 'border-2 border-orange-400 dark:border-orange-500/70 bg-orange-50 dark:bg-orange-950/25 hover:bg-orange-100 dark:hover:bg-orange-950/40',
      icon: <span className="text-2xl shrink-0">🎯</span>,
      arrow: true,
    },
    success: {
      wrap: 'border border-green-400/50 bg-green-50 dark:bg-green-950/20',
      icon: <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />,
    },
    info: {
      wrap: 'border-2 border-dashed border-border bg-muted/30',
      icon: <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />,
    },
    warning: {
      wrap: 'border border-amber-400/50 bg-amber-50 dark:bg-amber-950/20',
      icon: <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />,
    },
    locked: {
      wrap: 'border border-border/50 bg-muted/20 opacity-70',
      icon: <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />,
    },
  }

  const { wrap, icon, arrow } = styles[variant]

  const inner = (
    <>
      {icon}
      <div className="flex-1 min-w-0">
        {step && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">{step}</p>
        )}
        <p className={cn(
          'font-bold text-sm',
          variant === 'action'  && 'text-orange-700 dark:text-orange-400',
          variant === 'success' && 'text-green-700 dark:text-green-400',
          variant === 'warning' && 'text-amber-700 dark:text-amber-400',
          variant === 'info'    && 'text-foreground',
          variant === 'locked'  && 'text-muted-foreground',
        )}>
          {title}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      {arrow && isClickable && (
        <ArrowRight className="h-5 w-5 text-orange-500 shrink-0 group-hover:translate-x-1 transition-transform" />
      )}
    </>
  )

  const shared = cn(
    'w-full rounded-2xl px-5 py-4 flex gap-3 items-start text-left transition-colors',
    isClickable && 'group cursor-pointer',
    wrap,
    className,
  )

  if (href) {
    return <Link href={href} className={shared}>{inner}</Link>
  }
  if (onClick) {
    return <button onClick={onClick} className={shared}>{inner}</button>
  }
  return <div className={shared}>{inner}</div>
}
