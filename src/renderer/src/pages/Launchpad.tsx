import { useMemo, useState } from 'react'
import { PRACTICE_AREAS, WORKFLOWS } from '@shared/workflows'
import ActionCard from '../components/ActionCard'
import Icon from '../components/Icon'
import DataNotice from '../components/DataNotice'
import { Search } from 'lucide-react'

export default function Launchpad(): JSX.Element {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return WORKFLOWS
    return WORKFLOWS.filter((w) =>
      [w.title, w.cta, w.description, w.area].join(' ').toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8">
          <h1 className="font-serif text-3xl font-semibold text-slate-50">What do you need to do?</h1>
          <p className="text-ink-600 mt-2">
            Pick a workflow to get a clear start — Quantum Law Group reads your documents and drafts the work product for you.
          </p>
          <div className="mt-5 relative max-w-xl">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-600" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows — e.g. “DSAR”, “demand letter”, “diligence”"
              className="w-full bg-ink-900 border border-ink-700 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-accent/60"
            />
          </div>
        </header>

        <DataNotice />

        {PRACTICE_AREAS.map((area) => {
          const items = filtered.filter((w) => w.area === area.id)
          if (items.length === 0) return null
          return (
            <section key={area.id} className="mb-9">
              <div className="flex items-center gap-2.5 mb-3">
                <div
                  className="w-7 h-7 rounded-md grid place-items-center"
                  style={{ backgroundColor: `${area.accent}22`, color: area.accent }}
                >
                  <Icon name={area.icon} className="w-4 h-4" />
                </div>
                <h2 className="font-serif text-lg font-semibold text-slate-100">{area.label}</h2>
                <span className="text-xs text-ink-600">— {area.blurb}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((w) => (
                  <ActionCard key={w.id} workflow={w} accent={area.accent} />
                ))}
              </div>
            </section>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center text-ink-600 py-16">No workflows match “{query}”.</div>
        )}
      </div>
    </div>
  )
}
