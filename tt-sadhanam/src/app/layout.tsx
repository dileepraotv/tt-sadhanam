import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { ThemeScript } from '@/components/shared/ThemeScript'

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
        {children}
        <Toaster />
      </body>
    </html>
  )
}
