import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] shadow-sm hover:shadow-md touch-manipulation select-none',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground hover:brightness-105 active:brightness-95',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:     'border-2 border-primary/60 bg-transparent text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 hover:border-primary dark:hover:border-primary/80',
        secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:border dark:border-border/50',
        ghost:       'hover:bg-accent/10 hover:text-accent-foreground',
        link:        'text-white underline-offset-4 hover:underline',
        // Legacy alias (some pages still call "cyan") — keep it as brand-primary
        cyan:        'bg-primary text-primary-foreground hover:brightness-105 active:brightness-95',
      },
      size: {
        default: 'h-9 px-4 py-2 text-base',
        sm:      'h-8 rounded-md px-3 text-sm',
        lg:      'h-11 rounded-md px-6 text-lg',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        style={style}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
