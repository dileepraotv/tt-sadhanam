import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (in production)
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  // Lightweight query — just checks DB is alive
  const { error } = await supabase
    .from('championships')
    .select('id')
    .limit(1)

  if (error) {
    console.error('[ping] Supabase keep-alive failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  console.log('[ping] Supabase keep-alive ok at', new Date().toISOString())
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() })
}
