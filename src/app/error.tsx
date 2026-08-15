'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-20">
      <div className="max-w-lg mx-auto rounded-lg border border-red-200 bg-white p-8">
        <p className="text-xs font-semibold uppercase text-red-700">Data unavailable</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">We could not load the latest racing data.</h1>
        <p className="mt-3 text-sm text-slate-600">Check the database connection, then try again.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Return home
          </Link>
        </div>
      </div>
    </main>
  )
}