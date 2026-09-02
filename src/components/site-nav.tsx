'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/greyhounds', label: 'Greyhounds' },
  { href: '/paper-betting', label: 'Paper Betting' },
  { href: '/betfair', label: 'Betfair' },
  { href: '/picks-history', label: 'Past Picks' },
  { href: '/accuracy', label: 'Accuracy' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/results', label: 'Results' },
  { href: '/verify', label: 'Verify' },
  { href: '/admin', label: 'Admin' },
]

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <nav className="relative shrink-0">
      <ul className="hidden items-center gap-4 md:flex">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={`text-sm font-medium ${pathname === link.href ? 'text-slate-900' : 'text-teal-700 hover:text-teal-800'}`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Toggle navigation menu"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-700 md:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-48 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${pathname === link.href ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  )
}
