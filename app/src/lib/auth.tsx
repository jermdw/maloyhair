import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { toast } from 'sonner'
import { auth, googleProvider } from '@/lib/firebase'

/** Popup-based OAuth is unreliable on mobile WebKit (iOS Safari, and Chrome/Firefox/etc on
 *  iOS, which Apple requires to run on the same WebKit engine as Safari — "Chrome" there is
 *  not Chromium and inherits Safari's popup + third-party storage restrictions). Google's
 *  own guidance is to use a full-page redirect on mobile instead of a popup. */
function isMobileBrowser(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** Set right before navigating away for signInWithRedirect, checked on the page's next load.
 *  This is plain sessionStorage on our own origin, not Firebase's internal redirect-state
 *  storage — it lets us tell "no sign-in was attempted" apart from "a sign-in was attempted
 *  but Firebase's own pending-redirect state didn't survive the round trip through Google"
 *  (a known WebKit/ITP failure mode: getRedirectResult() silently resolves to null in both
 *  cases, so without this flag the two are indistinguishable). */
const REDIRECT_PENDING_KEY = 'maloyhair-auth-redirect-pending'

/** Throws if the signed-in user isn't the app's single owner, undoing the sign-in first. */
async function assertOwner(user: User): Promise<void> {
  const idTokenResult = await user.getIdTokenResult()
  if (idTokenResult.claims.owner !== true) {
    await signOut(auth)
    throw new Error('This app is restricted to a single account.')
  }
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: () => Promise<void>
  signInDev: (email: string, password: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Completes the sign-in started by signInWithRedirect below — the page fully reloads
    // for that flow, so this is the only place its outcome (including the owner check,
    // since a rejected sign-in has already resolved by the time onAuthStateChanged fires)
    // can be surfaced. A plain popup sign-in never reaches here (getRedirectResult
    // resolves to null when there was no pending redirect).
    const wasPending = sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1'
    sessionStorage.removeItem(REDIRECT_PENDING_KEY)

    getRedirectResult(auth)
      .then((result) => {
        if (result) return assertOwner(result.user)
        if (wasPending) {
          // We definitely left for signInWithRedirect and came back, but Firebase found no
          // redirect result to process — its own storage for correlating the two ends of the
          // round trip didn't survive, most likely the browser's cross-site tracking
          // protection. This is a real, actionable dead end, not a silent no-op.
          throw new Error(
            "Sign-in didn't complete after returning from Google — this browser blocked storage the sign-in flow needs. In Settings, try turning off \"Prevent Cross-Site Tracking\" for this site, or use Safari directly instead of Chrome.",
          )
        }
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Sign-in failed.')
      })

    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
  }, [])

  async function signIn() {
    if (isMobileBrowser()) {
      // Navigates away immediately — control returns to the app on reload, handled by
      // the getRedirectResult effect above, not by this function's caller.
      sessionStorage.setItem(REDIRECT_PENDING_KEY, '1')
      await signInWithRedirect(auth, googleProvider)
      return
    }
    const result = await signInWithPopup(auth, googleProvider)
    await assertOwner(result.user)
  }

  /** Dev-only (emulator) sign-in path — never reachable in production, see LoginGate. */
  async function signInDev(email: string, password: string) {
    const result = await signInWithEmailAndPassword(auth, email, password)
    await assertOwner(result.user)
  }

  async function signOutUser() {
    await signOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInDev, signOutUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
