import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="text-5xl mb-2">🏓</div>
      <h1 className="font-display text-3xl font-bold tracking-wide">Tournament Not Found</h1>
      <p className="text-muted-foreground max-w-sm">
        This tournament doesn't exist or hasn't been published yet.
      </p>
      <Button asChild variant="cyan">
        <Link href="/">Back to Home</Link>
      </Button>
    </div>
  )
}
