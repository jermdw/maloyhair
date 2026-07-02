import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function DevSignInForm() {
  const { signInDev } = useAuth()
  const [email, setEmail] = useState('test-owner@maloyhair.test')
  const [password, setPassword] = useState('test-password-123')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await signInDev(email, password)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dev sign-in failed.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-64 flex-col gap-2">
      <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <Button type="submit" variant="outline">
        Dev sign-in (emulator)
      </Button>
    </form>
  )
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, loading, signIn } = useAuth()

  async function handleSignIn() {
    try {
      await signIn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
    }
  }

  if (loading) return null

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Button onClick={handleSignIn}>Sign in with Google</Button>
        {import.meta.env.DEV && <DevSignInForm />}
      </div>
    )
  }

  return <>{children}</>
}
