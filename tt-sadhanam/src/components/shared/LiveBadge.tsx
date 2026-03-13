import { cn } from '@/lib/utils'

interface LiveBadgeProps { className?: string; label?: string }

export function LiveBadge({ className, label = 'LIVE' }: LiveBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
      'border-orange-400/70 bg-orange-100 dark:bg-orange-500/15 dark:border-orange-500/50',
      'text-xs font-bold text-orange-600 dark:text-orange-400 tracking-widest',
      className,
    )}>
      <span className="live-dot" />
      {label}
    </span>
  )
}
