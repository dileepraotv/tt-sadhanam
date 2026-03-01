'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const saved = localStorage.getItem('tt-theme')
    const initial = saved === 'dark' ? 'dark' : 'light'
    setTheme(initial)
    document.documentElement.className = initial
  }, [])

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.className = next
    try { localStorage.setItem('tt-theme', next) } catch {}
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-white/30 text-white hover:bg-orange-700/40 transition-colors text-xs font-semibold whitespace-nowrap"
    >
      {theme === 'light'
        ? <><Moon className="h-3.5 w-3.5 shrink-0" /><span>Dark Mode</span></>
        : <><Sun  className="h-3.5 w-3.5 shrink-0" /><span>Light Mode</span></>
      }
    </button>
  )
}
