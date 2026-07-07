import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ring px-1 text-[10px] font-semibold text-primary-foreground">
      {count}
    </span>
  )
}

export function Nav() {
  const { signOutUser } = useAuth()
  const { unreadTotal } = useConversations()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="border-b border-border bg-card px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-heading text-lg">Maloy Hair</span>
          <div className="hidden items-center gap-4 font-label text-sm uppercase tracking-wide sm:flex">
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
                {link.to === '/messages' && <UnreadBadge count={unreadTotal} />}
              </NavLink>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => signOutUser()}>
          Sign out
        </Button>
        <button
          type="button"
          className="flex items-center gap-1.5 text-muted-foreground sm:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          <UnreadBadge count={unreadTotal} />
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 font-label text-sm uppercase tracking-wide sm:hidden">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn('flex items-center gap-1.5 text-muted-foreground', isActive && 'text-foreground')
              }
            >
              {link.label}
              {link.to === '/messages' && <UnreadBadge count={unreadTotal} />}
            </NavLink>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setMobileOpen(false)
              signOutUser()
            }}
          >
            Sign out
          </Button>
        </div>
      )}
    </nav>
  )
}
