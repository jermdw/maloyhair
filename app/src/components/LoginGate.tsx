import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, loading, signIn } = useAuth()

  if (loading) return null

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Button onClick={() => signIn()}>Sign in with Google</Button>
      </div>
    )
  }

  return <>{children}</>
}
