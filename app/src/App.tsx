import { AuthProvider } from '@/lib/auth'
import { LoginGate } from '@/components/LoginGate'

function App() {
  return (
    <AuthProvider>
      <LoginGate>
        <div className="p-8">
          <h1 className="text-2xl font-semibold">Maloy Hair — Booking</h1>
          <p className="text-muted-foreground">Calendar and client list go here.</p>
        </div>
      </LoginGate>
    </AuthProvider>
  )
}

export default App
