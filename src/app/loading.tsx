export default function Loading() {
  return (
    <main className="min-h-screen bg-slate-50" aria-busy="true" aria-label="Loading race data">
      <div className="max-w-7xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-8 w-56 rounded bg-slate-200 mb-8" />
        <div className="space-y-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-44 rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
      </div>
    </main>
  )
}