'use client'

/**
 * GlobalLoader
 *
 * Bouncing ball overlay shown during:
 *  1. Any <a> / Next Link click (detected via document click capture)
 *  2. Manual setLoading(true) calls from server actions
 *
 * Navigation completion is detected via usePathname change.
 *
 * Usage:
 *   const { setLoading } = useLoading()
 *   setLoading(true)
 *   await someServerAction()
 *   setLoading(false)
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// ── Context ──────────────────────────────────────────────────────────────────

interface LoadingCtx {
  isLoading:  boolean
  setLoading: (v: boolean) => void
}

const Ctx = createContext<LoadingCtx>({
  isLoading:  false,
  setLoading: () => {},
})

export function useLoading() {
  return useContext(Ctx)
}

// ── Bouncing Ball Overlay ────────────────────────────────────────────────────

function BouncingBall() {
  return (
    <>
      <style>{`
        @keyframes tt-ball-bounce {
          0%, 100% { transform: translateY(0px) scaleX(1)    scaleY(1);    }
          40%       { transform: translateY(-28px) scaleX(0.9)  scaleY(1.1);  }
          50%       { transform: translateY(-32px) scaleX(0.88) scaleY(1.12); }
          60%       { transform: translateY(-28px) scaleX(0.9)  scaleY(1.1);  }
          80%       { transform: translateY(0px) scaleX(1.12) scaleY(0.88); }
          90%       { transform: translateY(0px) scaleX(1)    scaleY(1);    }
        }
        @keyframes tt-shadow-pulse {
          0%, 100% { transform: scaleX(1);    opacity: 0.35; }
          50%       { transform: scaleX(0.55); opacity: 0.15; }
        }
        @keyframes tt-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .tt-loader-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.22);
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          animation: tt-overlay-in 0.12s ease-out;
        }
        .tt-ball {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #ffe066, #f5c800 60%, #d4a800);
          box-shadow: 0 4px 18px rgba(245,200,0,0.7), inset 0 -3px 6px rgba(0,0,0,0.15);
          animation: tt-ball-bounce 0.65s cubic-bezier(0.33,0,0.66,1) infinite;
        }
        .tt-ball-shadow {
          width: 26px;
          height: 6px;
          border-radius: 50%;
          background: rgba(180,140,0,0.35);
          animation: tt-shadow-pulse 0.65s cubic-bezier(0.33,0,0.66,1) infinite;
          margin-top: 3px;
        }
        .tt-loader-label {
          margin-top: 14px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.9);
          text-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
      `}</style>
      <div className="tt-loader-overlay" aria-label="Loading" role="status">
        <div className="tt-ball" />
        <div className="tt-ball-shadow" />
        <div className="tt-loader-label">Please wait</div>
      </div>
    </>
  )
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function GlobalLoaderProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(false)

  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const prevKey   = useRef<string | null>(null)
  const manualRef = useRef(false)

  const finish = useCallback(() => {
    manualRef.current = false
    setIsLoading(false)
  }, [])

  const start = useCallback(() => {
    setIsLoading(true)
  }, [])

  const setLoading = useCallback((v: boolean) => {
    manualRef.current = v
    if (v) start(); else finish()
  }, [start, finish])

  // Hide overlay when navigation completes (pathname/searchParams changed)
  useEffect(() => {
    const key = pathname + '?' + searchParams.toString()
    if (prevKey.current === null) {
      prevKey.current = key
      return
    }
    if (key !== prevKey.current) {
      prevKey.current = key
      finish()
    }
  }, [pathname, searchParams, finish])

  // Show overlay on ANY internal link click — fires before Next.js router
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element

      // Don't hijack clicks on buttons, inputs, or elements that opt-out
      // This prevents the loader firing when e.g. a delete button is inside a <Link> card
      if (target.closest('button, input, select, textarea, [data-no-loader]')) return

      const anchor = target.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href') ?? ''
      if (!href) return

      // Skip non-navigation links
      if (
        href.startsWith('http') ||
        href.startsWith('//') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('target') === '_blank' ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
      ) return

      // Skip same-path same-query (no actual navigation)
      const currentFull = pathname + (window.location.search || '')
      const newPath  = href.split('?')[0] || pathname
      const newQuery = href.includes('?') ? '?' + href.split('?')[1] : ''
      const newFull  = newPath + newQuery
      if (newFull === currentFull) return

      start()
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [pathname, start])

  return (
    <Ctx.Provider value={{ isLoading, setLoading }}>
      {isLoading && <BouncingBall />}
      {children}
    </Ctx.Provider>
  )
}

// ── InlineLoader ─────────────────────────────────────────────────────────────
// Use this in place of tt-spinner for section-level loading states.
// Shows the same bouncing ball style but inline (not full-screen overlay).

export function InlineLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 select-none" role="status" aria-label={label}>
      <style>{`
        @keyframes tt-ball-bounce-inline {
          0%, 100% { transform: translateY(0px) scaleX(1)    scaleY(1);    }
          40%       { transform: translateY(-16px) scaleX(0.9)  scaleY(1.1);  }
          50%       { transform: translateY(-18px) scaleX(0.88) scaleY(1.12); }
          60%       { transform: translateY(-16px) scaleX(0.9)  scaleY(1.1);  }
          80%       { transform: translateY(0px) scaleX(1.12) scaleY(0.88); }
          90%       { transform: translateY(0px) scaleX(1)    scaleY(1);    }
        }
        @keyframes tt-shadow-pulse-inline {
          0%, 100% { transform: scaleX(1);    opacity: 0.3; }
          50%       { transform: scaleX(0.55); opacity: 0.1; }
        }
        .tt-ball-inline {
          width: 18px; height: 18px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #ffe066, #f5c800 60%, #d4a800);
          box-shadow: 0 3px 10px rgba(245,200,0,0.5), inset 0 -2px 4px rgba(0,0,0,0.15);
          animation: tt-ball-bounce-inline 0.65s cubic-bezier(0.33,0,0.66,1) infinite;
        }
        .tt-shadow-inline {
          width: 18px; height: 4px; border-radius: 50%;
          background: rgba(180,140,0,0.3);
          animation: tt-shadow-pulse-inline 0.65s cubic-bezier(0.33,0,0.66,1) infinite;
          margin-top: 2px;
        }
      `}</style>
      <div className="tt-ball-inline" />
      <div className="tt-shadow-inline" />
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mt-1">{label}</span>
    </div>
  )
}
