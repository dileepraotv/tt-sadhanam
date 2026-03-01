import Link from 'next/link'
import { Trophy, ShieldCheck, Eye } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { AuthButton } from '@/app/auth-button'
import type { User } from '@supabase/supabase-js'

interface HeaderProps {
  /** Pass user from getUser(). When null/undefined AuthButton shows sign-in. */
  user?:              User | null
  /** true = orange ADMIN badge visible; false/omit = shows Viewer badge for logged-out */
  isAdmin?:           boolean
  /** Legacy single-label breadcrumb (use <Breadcrumb> component for multi-level) */
  tournamentName?:    string
  tournamentId?:      string
  /** After login, redirect to this path instead of /admin/championships */
  adminRedirectPath?: string
  /** Extra content in the right slot (e.g. Public View button) */
  right?:             React.ReactNode
}

export function Header({
  user,
  isAdmin,
  tournamentName,
  tournamentId,
  adminRedirectPath,
  right,
}: HeaderProps) {
  const isLoggedIn = !!user

  return (
    <header
      className="sticky top-0 z-40 border-b border-orange-700/50"
      style={{ background: '#F06321', boxShadow: '0 1px 0 rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.12)' }}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">

        {/* Logo — admin goes to dashboard; public goes to home */}
        <Link
          href={isLoggedIn ? '/admin/championships' : '/'}
          className="flex items-center gap-2 text-white hover:text-orange-100 transition-colors shrink-0"
        >
          <Trophy className="h-5 w-5 text-white" />
          <span
            className="font-bold tracking-wide text-base hidden sm:block"
            style={{ fontFamily: 'Calibri, Trebuchet MS, Arial, sans-serif' }}
          >
            TT-<span className="text-orange-100">SADHANAM</span>
          </span>
        </Link>

        {/* Role indicator */}
        {isLoggedIn ? (
          /* Logged in: white ADMIN pill that links to admin dashboard */
          <Link
            href="/admin/championships"
            className="flex items-center gap-1.5 text-xs font-bold
              bg-white text-orange-700
              hover:bg-orange-50 px-2.5 py-1 rounded-full
              shadow-sm transition-colors shrink-0"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            ADMIN
          </Link>
        ) : (
          /* Not logged in: championships nav + subtle viewer pill */
          <>
            <Link
              href="/championships"
              className="hidden sm:block text-sm text-white/80 hover:text-white transition-colors font-medium"
            >
              Championships
            </Link>
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-semibold
              bg-white/15 text-white/80 px-2 py-0.5 rounded-full border border-white/20">
              <Eye className="h-3 w-3" />
              Viewer
            </span>
          </>
        )}

        {/* Legacy single-label breadcrumb segment */}
        {tournamentName && (
          <>
            <span className="text-orange-200/50 hidden sm:block">/</span>
            {tournamentId ? (
              <Link
                href={isAdmin ? `/admin/tournaments/${tournamentId}` : `/tournaments/${tournamentId}`}
                className="font-semibold text-sm tracking-wide truncate max-w-[160px] text-white hover:text-orange-100 transition-colors hidden sm:block"
              >
                {tournamentName}
              </Link>
            ) : (
              <span className="font-semibold text-sm tracking-wide truncate max-w-[160px] text-white hidden sm:block">
                {tournamentName}
              </span>
            )}
          </>
        )}

        {/* Right slot — extra buttons, then auth */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {right}
          {user !== undefined && (
            <AuthButton user={user ?? null} adminRedirectPath={adminRedirectPath} />
          )}
        </div>
      </div>
    </header>
  )
}
