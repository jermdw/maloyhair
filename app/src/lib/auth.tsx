import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'

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
  /**
   * Completes sign-in from a Google Identity Services credential (the JWT the GIS
   * button hands to its callback). This is the primary sign-in path: GIS delivers
   * the token directly to the page, so there's no popup hand-back or redirect
   * round trip for mobile WebKit's tracking prevention to break — which is what
   * defeated both signInWithPopup and signInWithRedirect on iOS (Safari AND
   * Chrome, same engine), even with "Prevent Cross-Site Tracking" turned off.
   */
  signInWithGoogleIdToken: (idToken: string) => Promise<void>
  /** Fallback when the GIS script can't load (e.g. blocked by an extension) — the
   *  original popup flow, which still works fine on desktop browsers. */
  signInWithGooglePopup: () => Promise<void>
  signInDev: (email: string, password: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
  }, [])

  async function signInWithGoogleIdToken(idToken: string) {
    const credential = GoogleAuthProvider.credential(idToken)
    const result = await signInWithCredential(auth, credential)
    await assertOwner(result.user)
  }

  async function signInWithGooglePopup() {
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
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogleIdToken, signInWithGooglePopup, signInDev, signOutUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
