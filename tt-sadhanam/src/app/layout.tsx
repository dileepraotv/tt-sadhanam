import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { ThemeScript } from '@/components/shared/ThemeScript'
import { GlobalLoaderProvider } from '@/components/shared/GlobalLoader'

export const metadata: Metadata = {
  title:       'SADHANAM - Table Tennis Tournament Manager',
  description: 'Professional table tennis tournament brackets and live scoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen antialiased">
        {/* Suspense required because GlobalLoaderProvider uses useSearchParams */}
        <Suspense>
          <GlobalLoaderProvider>
            {children}
            <Toaster />
          </GlobalLoaderProvider>
        </Suspense>
      </body>
    </html>
  )
}
