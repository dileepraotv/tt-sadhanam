'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ToastProvider   = ToastPrimitive.Provider
const ToastViewport   = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn('fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-[100] flex max-h-screen w-auto sm:max-w-[380px] flex-col gap-2 p-4', className)}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & { variant?: 'default' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      variant === 'destructive'
        ? 'border-destructive bg-destructive text-destructive-foreground'
        : 'border-border bg-card text-foreground',
      className,
    )}
    {...props}
  />
))
Toast.displayName = ToastPrimitive.Root.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn('absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100', className)}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

// ── Toast hook ────────────────────────────────────────────────────────────────
const TOAST_LIMIT = 3
type ToastData = {
  id: string; title?: string; description?: string; variant?: 'default' | 'destructive'
}

let toastListeners: Array<(toasts: ToastData[]) => void> = []
let toastMemory: ToastData[] = []

function emitChange(toasts: ToastData[]) {
  toastMemory = toasts
  toastListeners.forEach(l => l(toasts))
}

export function toast({ title, description, variant = 'default' }: Omit<ToastData, 'id'>) {
  const id = Math.random().toString(36).slice(2)
  emitChange([...toastMemory, { id, title, description, variant }].slice(-TOAST_LIMIT))
  setTimeout(() => emitChange(toastMemory.filter(t => t.id !== id)), 4000)
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToastData[]>(toastMemory)
  React.useEffect(() => {
    toastListeners.push(setToasts)
    return () => { toastListeners = toastListeners.filter(l => l !== setToasts) }
  }, [])
  return { toasts }
}

// ── Toaster (rendered in layout) ─────────────────────────────────────────────
export function Toaster() {
  const { toasts } = useToast()
  return (
    <ToastProvider>
      {toasts.map(t => (
        <Toast key={t.id} variant={t.variant}>
          <div className="grid gap-1">
            {t.title && <ToastTitle>{t.title}</ToastTitle>}
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
