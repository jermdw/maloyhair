import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'

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
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
    })
  }, [])

  async function signIn() {
    const result = await signInWithPopup(auth, googleProvider)
    const idTokenResult = await result.user.getIdTokenResult()
    if (idTokenResult.claims.owner !== true) {
      await signOut(auth)
      throw new Error('This app is restricted to a single account.')
    }
  }

  /** Dev-only (emulator) sign-in path — never reachable in production, see LoginGate. */
  async function signInDev(email: string, password: string) {
    const result = await signInWithEmailAndPassword(auth, email, password)
    const idTokenResult = await result.user.getIdTokenResult()
    if (idTokenResult.claims.owner !== true) {
      await signOut(auth)
      throw new Error('This account is not authorized.')
    }
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
