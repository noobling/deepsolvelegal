import { useMemo } from 'react'
import { useStore } from '../state/store'
import { ArrowLeft, Highlighter, ExternalLink, Loader2 } from 'lucide-react'

// CSS colours for the common Word highlight names; "#RRGGBB" fills pass through.
const SWATCH: Record<string, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  cyan: '#22d3ee',
  magenta: '#e879f9',
  blue: '#60a5fa',
  red: '#f87171',
  darkGreen: '#16a34a',
  orange: '#fb923c',
  gray: '#9ca3af'
}
function swatch(color: string): string {
  return color.startsWith('#') ? color : SWATCH[color] ?? '#facc15'
}

/**
 * A dedicated page listing just the reviewer highlights across the collection's
 * documents — the highlighted text, its colour, and which document it's from —
 * separate from the index table.
 */
export default function Highlights(): JSX.Element {
  const { collectionDetail: c, setRoute } = useStore()

  // Only documents that actually have highlights, in index order.
  const docs = useMemo(() => (c?.docs ?? []).filter((d) => d.highlights && d.highlights.length > 0), [c])
  const total = useMemo(() => docs.reduce((n, d) => n + (d.highlights?.length ?? 0), 0), [docs])

  if (!c) {
    return (
      <div className="flex-1 grid place-items-center text-ink-600">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <header className="h-14 shrink-0 border-b border-ink-700/60 bg-ink-900/60 flex items-center gap-3 px-5">
        <button onClick={() => setRoute('collection')} className="text-ink-600 hover:text-slate-200" title="Back to index">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Highlighter className="w-4 h-4 text-accent" />
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-slate-100 truncate">Highlights — {c.name}</div>
          <div className="text-[11px] text-ink-600">
            {total} highlight{total === 1 ? '' : 's'} across {docs.length} document{docs.length === 1 ? '' : 's'}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto">
        {docs.length === 0 ? (
          <div className="h-full grid place-items-center text-ink-600">
            <div className="flex flex-col items-center gap-2">
              <Highlighter className="w-7 h-7 opacity-40" />
              <span className="text-sm">No highlighted text in this collection.</span>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-7">
            {docs.map((d) => (
              <section key={d.id}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[13px] font-medium text-slate-200 truncate">{d.name}</h2>
                  <span className="text-[11px] text-ink-600">
                    {d.highlights?.length} highlight{(d.highlights?.length ?? 0) === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => void window.api.files.reveal(d.path)}
                    title="Reveal in Finder"
                    className="ml-auto text-ink-600 hover:text-accent"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {(d.highlights ?? []).map((h, i) => (
                    <li key={i} className="flex gap-3 items-start rounded-lg bg-ink-900/50 border border-ink-700/50 px-3 py-2.5">
                      <span
                        className="mt-1 w-1.5 h-5 rounded-sm shrink-0"
                        style={{ backgroundColor: swatch(h.color) }}
                        title={h.color}
                      />
                      <span className="text-[13px] text-slate-200 leading-relaxed">{h.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
