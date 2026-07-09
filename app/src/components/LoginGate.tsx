import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** OAuth 2.0 web client for this Firebase project (auto-created by Firebase when Google
 *  sign-in was enabled). Client IDs are public identifiers by design — this same value
 *  ships in every served page — so hardcoding it is safe and keeps CI free of another
 *  secret. The client's "Authorized JavaScript origins" in the Google Cloud console must
 *  list every domain the app is served from (app.maloy.hair, maloyhair-app.web.app). */
const GOOGLE_CLIENT_ID = '156605570671-s88c8vhprl0n1q62u2offauhqjnf8jco.apps.googleusercontent.com'

interface GisCredentialResponse {
  credential: string
}

/** The subset of the Google Identity Services API this app uses. */
interface GisId {
  initialize: (config: {
    client_id: string
    callback: (response: GisCredentialResponse) => void
    itp_support?: boolean
  }) => void
  renderButton: (
    parent: HTMLElement,
    options: { theme?: string; size?: string; text?: string; width?: number; logo_alignment?: string },
  ) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GisId } }
  }
}

let gisScriptPromise: Promise<GisId> | null = null

/** Loads https://accounts.google.com/gsi/client exactly once, resolving with the GIS API. */
function loadGis(): Promise<GisId> {
  if (gisScriptPromise) return gisScriptPromise
  gisScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else reject(new Error('Google sign-in script loaded but its API is missing.'))
    }
    script.onerror = () => reject(new Error('Failed to load the Google sign-in script.'))
    document.head.appendChild(script)
  })
  return gisScriptPromise
}

/**
 * Google Identity Services sign-in button. GIS delivers the credential (a signed ID
 * token JWT) straight to a same-page callback — no popup hand-back and no redirect
 * round trip, the two mechanisms mobile WebKit's tracking prevention breaks. The
 * token is then exchanged for a Firebase session via signInWithCredential.
 */
function GoogleSignInButton() {
  const { signInWithGoogleIdToken, signInWithGooglePopup } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [gisFailed, setGisFailed] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)

  useEffect(() => {
    let cancelled = false

    loadGis()
      .then((gis) => {
        if (cancelled || !containerRef.current) return
        gis.initialize({
          client_id: GOOGLE_CLIENT_ID,
          itp_support: true,
          callback: async (response) => {
            try {
              await signInWithGoogleIdToken(response.credential)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
            }
          },
        })
        gis.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: 240,
        })
      })
      .catch(() => {
        if (!cancelled) setGisFailed(true)
      })

    return () => {
      cancelled = true
    }
    // signInWithGoogleIdToken is stable for the lifetime of AuthProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePopupFallback() {
    if (isSigningIn) return
    setIsSigningIn(true)
    try {
      await signInWithGooglePopup()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setIsSigningIn(false)
    }
  }

  if (gisFailed) {
    return (
      <Button onClick={handlePopupFallback} disabled={isSigningIn}>
        {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
      </Button>
    )
  }

  return <div ref={containerRef} />
}

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
  const { user, loading } = useAuth()

  if (loading) return null

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        {/* The dev emulator can't mint real Google credentials, so the GIS button is
            production-only; the emulator path is the email/password form below. */}
        {!import.meta.env.DEV && <GoogleSignInButton />}
        {import.meta.env.DEV && <DevSignInForm />}
      </div>
    )
  }

  return <>{children}</>
}
