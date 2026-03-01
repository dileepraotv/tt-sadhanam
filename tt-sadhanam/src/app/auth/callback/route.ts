import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase sends users to /auth/callback after email confirmation.
 * This route exchanges the one-time code for a session, then
 * redirects to the home page.
 *
 * Without this route, the confirmation link redirects to localhost
 * because Supabase doesn't know where to send the user.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If anything went wrong, send to home page — user can sign in manually
  return NextResponse.redirect(`${origin}/`)
}
