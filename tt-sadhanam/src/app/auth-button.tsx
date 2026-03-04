'use client'

import { useState, useTransition } from 'react'
import { LogIn, LogOut, Mail } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/index'
import { useRouter } from 'next/navigation'

interface AuthButtonProps {
  user:               User | null
  /** After login, redirect here instead of /admin/championships */
  adminRedirectPath?: string
}

export function AuthButton({ user, adminRedirectPath }: AuthButtonProps) {
  const [open, setOpen]          = useState(false)
  const [email, setEmail]        = useState('')
  const [password, setPassword]  = useState('')
  const [isSignUp, setIsSignUp]  = useState(false)
  const [error, setError]        = useState('')
  const [isPending, startTransition] = useTransition()
  const router                   = useRouter()
  const supabase                 = createClient()

  const handleAuth = () => {
    setError('')
    startTransition(async () => {
      const fn = isSignUp
        ? supabase.auth.signUp({ email, password })
        : supabase.auth.signInWithPassword({ email, password })
      const { error: authError } = await fn
      if (authError) {
        setError(authError.message)
        return
      }
      setOpen(false)
      // Always redirect to admin after login
      router.push(adminRedirectPath ?? '/admin/championships')
      router.refresh()
    })
  }

  const handleSignOut = () => {
    startTransition(async () => {
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    })
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        {/* Compact email label — desktop only */}
        <span className="hidden md:flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1 border border-white/20">
          <Mail className="h-3 w-3 text-white/70 shrink-0" />
          <span className="text-xs font-medium text-white/90 truncate max-w-[140px]">
            {user.email}
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          disabled={isPending}
          className="border-white/70 text-white hover:bg-white/15 h-8 px-2.5 text-xs"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline ml-1">Sign out</span>
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-white/70 text-white hover:bg-white/15 h-8 text-xs"
      >
        <LogIn className="h-3.5 w-3.5" />
        <span className="ml-1">Admin Login</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isSignUp ? 'Create Admin Account' : 'Admin Sign In'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAuth()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-pw">Password</Label>
              <Input
                id="auth-pw"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAuth()}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleAuth} disabled={isPending || !email || !password} variant="cyan">
              {isPending ? 'Signing in…' : isSignUp ? 'Create Account' : 'Sign In →'}
            </Button>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError('') }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
