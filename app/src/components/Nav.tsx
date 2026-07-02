import { NavLink } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useConversations } from '@/hooks/useMessages'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const links = [
  { to: '/calendar', label: 'Calendar' },
  { to: '/clients', label: 'Clients' },
  { to: '/messages', label: 'Messages' },
  { to: '/services', label: 'Services' },
  { to: '/settings', label: 'Settings' },
]

export function Nav() {
  const { signOutUser } = useAuth()
  const { unreadTotal } = useConversations()

  return (
    <nav className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="font-heading text-lg">Maloy Hair</span>
        <div className="flex items-center gap-4 font-label text-sm uppercase tracking-wide">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 border-b-2 border-transparent pb-1 text-muted-foreground transition-colors hover:text-foreground',
                  isActive && 'border-ring text-foreground',
                )
              }
            >
              {link.label}
              {link.to === '/messages' && unreadTotal > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ring px-1 text-[10px] font-semibold text-primary-foreground">
                  {unreadTotal}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => signOutUser()}>
        Sign out
      </Button>
    </nav>
  )
}
