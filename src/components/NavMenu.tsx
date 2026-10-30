import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { LogOutIcon, MenuIcon, type IconComponent } from './icons'
import { Sheet } from './Sheet'
import { ThemePicker } from './ThemeToggle'
import { Button, cx } from './ui'

export interface MenuLink {
  to: string
  label: string
  icon: IconComponent
  count?: number
}

/**
 * The menu button for small screens, and the sheet it opens: everything that
 * doesn't fit in the top bar, plus appearance and signing out.
 */
export function NavMenu({
  title,
  links,
  top,
  bottom,
  account,
  onSignOut,
  signingOut,
  className,
}: {
  title: string
  links: MenuLink[]
  /** Above the links, e.g. the wallet balance or the store's name. */
  top?: ReactNode
  /** Under everything, e.g. small print. Links in it close the menu. */
  bottom?: ReactNode
  /** The signed-in email, shown beside "Sign out". */
  account?: string | null
  /** Offered when given. Call `done` to close the menu. */
  onSignOut?: (done: () => void) => void
  signingOut?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const total = links.reduce((sum, l) => sum + (l.count ?? 0), 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={total ? `Menu, ${total} new` : 'Menu'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx('relative flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sunken', className)}
      >
        <MenuIcon size={22} />
        {total ? (
          <span className="absolute top-1.5 right-1.5 flex size-4.5 items-center justify-center rounded-full bg-hot text-[9px] font-extrabold text-white">
            {total > 9 ? '9+' : total}
          </span>
        ) : null}
      </button>

      <Sheet open={open} onClose={close} title={title}>
        <h2 className="pr-10 font-display text-2xl font-extrabold">{title}</h2>
        {top ? <div onClick={close}>{top}</div> : null}

        {links.length ? (
          <nav className="flex flex-col gap-1" aria-label={title}>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end
                onClick={close}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold no-underline transition',
                    isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink hover:bg-sunken',
                  )
                }
              >
                <l.icon size={20} />
                {l.label}
                {l.count ? <span className="ml-auto rounded-full bg-hot px-2 py-0.5 text-[11px] font-extrabold text-white">{l.count}</span> : null}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="text-sm font-bold">Appearance</span>
          <ThemePicker />
        </div>

        {onSignOut ? (
          <Button variant="outline" loading={signingOut} onClick={() => onSignOut(close)} className="min-h-11">
            <LogOutIcon size={16} />
            <span className="min-w-0 truncate">
              Sign out{account ? <span className="font-normal"> · {account}</span> : null}
            </span>
          </Button>
        ) : null}
        {bottom ? <div onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>{bottom}</div> : null}
      </Sheet>
    </>
  )
}
