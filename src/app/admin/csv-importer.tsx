'use client'

import { useState } from 'react'

const SAMPLE_CSV = `racecourse,race_datetime,distance_m,track_condition,race_class,horse_name,finishing_position,finishing_time,margin,barrier_number,weight_carried,jockey,trainer
Flemington,2026-08-18T14:30:00+10:00,1400,Good 3,BM78,Thunder Strike,1,85.23,0.12,3,59.5,J. McDonald,C. Waller
Flemington,2026-08-18T14:30:00+10:00,1400,Good 3,BM78,Golden Arrow,2,85.45,0.35,7,58.0,M. Zahra,A. Freedman
Flemington,2026-08-18T14:30:00+10:00,1400,Good 3,BM78,Silver Dash,3,85.78,0.55,12,57.5,D. Lane,D. Hayes
Caulfield,2026-08-17T16:00:00+10:00,1200,Soft 5,BM64,Swift Star,1,68.12,0.45,1,60.0,C. Williams,M. Moroney
Caulfield,2026-08-17T16:00:00+10:00,1200,Soft 5,BM64,Wild Spirit,2,68.35,0.62,9,59.5,L. Nolen,J. Cummings`

export function CsvImporter() {
  const [csv, setCsv] = useState(SAMPLE_CSV)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string>()
  const [isError, setIsError] = useState(false)
  const [preview, setPreview] = useState<any>(null)

  async function handleDryRun() {
    setLoading(true)
    setMessage(undefined)
    setIsError(false)
    setPreview(null)

    try {
      const response = await fetch('/api/admin/import-csv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: true }),
      })
      const payload = await response.json()
      setIsError(!response.ok)
      setMessage(payload.message ?? (response.ok ? 'Dry run complete' : 'Dry run failed'))
      if (response.ok) setPreview(payload.summary)
    } catch {
      setIsError(true)
      setMessage('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    const confirmed = typeof window !== 'undefined' ? window.confirm('Import this CSV into Supabase?') : false
    if (!confirmed) return

    setLoading(true)
    setMessage(undefined)
    setIsError(false)
    setPreview(null)

    try {
      const response = await fetch('/api/admin/import-csv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, dryRun: false }),
      })
      const payload = await response.json()
      setIsError(!response.ok)
      setMessage(payload.message ?? (response.ok ? 'Import complete' : 'Import failed'))
      if (response.ok) setPreview(payload.summary)
    } catch {
      setIsError(true)
      setMessage('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-300">Victoria Race Results CSV</label>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-200"
          placeholder="Paste CSV here..."
        />
        <p className="mt-1 text-xs text-zinc-500">
          Required columns: racecourse, race_datetime, horse_name. Optional: distance_m, track_condition, race_class,
          finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDryRun}
          disabled={loading}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          Dry Run
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={loading}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          Import CSV
        </button>
      </div>

      {message ? (
        <div className={`rounded-lg border p-3 text-sm ${isError ? 'border-red-900 bg-red-900/20 text-red-300' : 'border-emerald-900 bg-emerald-900/20 text-emerald-300'}`}>
          {message}
        </div>
      ) : null}

      {preview ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
          <div className="mb-2 font-semibold text-zinc-300">Preview</div>
          <div className="space-y-1 text-zinc-400">
            <div>Races detected: {preview.races}</div>
            <div>Entries detected: {preview.entries}</div>
            {preview.sample?.length ? (
              <div>
                <div className="mt-2 text-xs text-zinc-500">Sample:</div>
                <ul className="ml-4 list-disc">
                  {preview.sample.map((item: any) => (
                    <li key={item.race_datetime}>
                      {item.racecourse} - {item.race_datetime} ({item.entries} runners)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
