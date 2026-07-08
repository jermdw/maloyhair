import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { LoginGate } from '@/components/LoginGate'
import { Nav } from '@/components/Nav'
import { Toaster } from '@/components/ui/sonner'
import { CalendarPage } from '@/pages/CalendarPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ClientDetailPage } from '@/pages/ClientDetailPage'
import { MessagesPage } from '@/pages/MessagesPage'
import { ServicesPage } from '@/pages/ServicesPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <AuthProvider>
      <LoginGate>
        <div className="min-h-screen">
          <Nav />
          <main className="p-4 sm:p-6">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:clientId" element={<ClientDetailPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </LoginGate>
      <Toaster />
    </AuthProvider>
  )
}

export default App
