import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import ProgressBar from '../components/ProgressBar'
import type { Collection as CollectionType, IndexedDoc } from '@shared/types'
import {
  ArrowLeft,
  Search,
  X,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ExternalLink,
  Loader2,
  ArrowUpDown,
  Highlighter,
  FolderOpen,
  Send,
  FileStack,
  Pause,
  Play,
  FileX,
  AlertTriangle
} from 'lucide-react'

type Col = { key: keyof IndexedDoc; label: string }

export default function Collection(): JSX.Element {
  const {
    collectionDetail,
    indexProgress,
    searchHits,
    searchCollection,
    clearSearch,
    exportIndex,
    reindexCollection,
    pauseCollection,
    resumeCollection,
    setRoute
  } = useStore()
  const openHighlights = (): void => setRoute('highlights')

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<keyof IndexedDoc>('date')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const c = collectionDetail
  const indexing = c?.status === 'indexing' || !!(c && indexProgress[c.id])
  const isPaused = c?.status === 'paused'
  const prog = c ? indexProgress[c.id] : undefined
  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0

  const hasEmail = useMemo(() => (c?.docs ?? []).some((d) => d.kind === 'email'), [c])
  const hasSummary = useMemo(() => (c?.docs ?? []).some((d) => d.summary), [c])
  const hasHighlights = useMemo(() => (c?.docs ?? []).some((d) => d.highlights?.length), [c])

  const columns: Col[] = useMemo(() => {
    const cols: Col[] = hasEmail
      ? [
          { key: 'date', label: 'Date' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'subject', label: 'Subject' }
        ]
      : [
          { key: 'name', label: 'Name' },
          { key: 'docType', label: 'Type' },
          { key: 'date', label: 'Date' }
        ]
    if (hasSummary) cols.push({ key: 'summary', label: 'Summary' })
    return cols
  }, [hasEmail, hasSummary])

  const snippetById = useMemo(() => {
    const m = new Map<string, string>()
    if (searchHits) for (const h of searchHits) m.set(h.doc.id, h.snippet)
    return m
  }, [searchHits])

  const rows: IndexedDoc[] = useMemo(() => {
    if (!c) return []
    if (searchHits) return searchHits.map((h) => h.doc)
    const sorted = [...c.docs].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return av.localeCompare(bv) * sortDir
    })
    return sorted
  }, [c, searchHits, sortKey, sortDir])

  const runSearch = (v: string): void => {
    setQuery(v)
    void searchCollection(v)
  }

  const toggleSort = (key: keyof IndexedDoc): void => {
    if (searchHits) return // search defines its own order
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(1)
    }
  }

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
        <button onClick={() => setRoute('library')} className="text-ink-600 hover:text-slate-200" title="Back to Documents">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-slate-100 truncate">{c.name}</div>
          <div className="text-[11px] text-ink-600">
            {c.fileCount} documents{indexing ? ' · processing…' : isPaused ? ' · paused' : ''}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasHighlights && (
            <button
              onClick={openHighlights}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-accent/40 text-accent hover:bg-accent/10"
            >
              <Highlighter className="w-4 h-4" /> Highlights
            </button>
          )}
          {indexing && (
            <button
              onClick={() => void pauseCollection(c.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            >
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => void resumeCollection(c.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] bg-accent text-ink-950 font-medium hover:bg-accent-soft"
            >
              <Play className="w-4 h-4" /> Resume
            </button>
          )}
          {!indexing && !isPaused && (
            <button
              onClick={() => void reindexCollection(c.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800"
            >
              <RefreshCw className="w-4 h-4" /> Re-run
            </button>
          )}
          <button
            onClick={() => void exportIndex('xlsx')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800"
          >
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={() => void exportIndex('docx')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800"
          >
            <FileText className="w-4 h-4" /> Word
          </button>
        </div>
      </header>

      {indexing && (
        <div className="px-5 pt-3">
          <div className="flex justify-between items-center text-[11.5px] text-accent mb-1.5">
            <span>{prog ? `${prog.phase}…` : 'Processing…'}</span>
            <span className="text-ink-600">{prog ? `${prog.done} / ${prog.total}` : ''}</span>
          </div>
          <ProgressBar pct={pct} />
        </div>
      )}

      {c.output && <OutputsPanel c={c} indexing={indexing} paused={isPaused} />}

      <div className="px-5 pt-3 pb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-600">
        <FileStack className="w-3.5 h-3.5" /> Input documents
      </div>
      <div className="px-5 py-2 border-b border-ink-700/40">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-600" />
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            disabled={indexing}
            placeholder={indexing ? 'Search available once processing finishes…' : 'Search the indexed documents…'}
            className="w-full rounded-lg bg-ink-950 border border-ink-700 pl-9 pr-9 py-2 text-sm text-slate-100 focus:border-accent outline-none disabled:opacity-60"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                clearSearch()
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-600 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[12.5px] border-collapse">
          <thead className="sticky top-0 bg-ink-900 z-10">
            <tr className="text-left text-ink-600 border-b border-ink-700">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  onClick={() => toggleSort(col.key)}
                  className={`px-3 py-2 font-medium select-none ${searchHits ? '' : 'cursor-pointer hover:text-slate-200'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {!searchHits && <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-ink-600">
                  {searchHits ? 'No matches.' : indexing ? 'Reading documents…' : 'No documents indexed.'}
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-ink-800/60 hover:bg-ink-800/40 align-top">
                {columns.map((col) => {
                  // The primary column falls back to the filename, so rows are
                  // readable the instant they appear — before metadata is parsed.
                  const isPrimary = col.key === (hasEmail ? 'subject' : 'name')
                  const display = String(d[col.key] ?? '') || (isPrimary ? d.name : '')
                  return (
                    <td key={String(col.key)} className="px-3 py-2 text-slate-300">
                      <div className="line-clamp-2 max-w-[22rem]">{display}</div>
                      {isPrimary && snippetById.get(d.id) && (
                        <div className="text-[11px] text-ink-600 italic mt-0.5 line-clamp-2">…{snippetById.get(d.id)}…</div>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => void window.api.files.reveal(d.path)}
                    title="Reveal in Explorer"
                    className="text-ink-600 hover:text-accent"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The production bundle — prioritized above the input documents. */
function OutputsPanel({ c, indexing, paused }: { c: CollectionType; indexing: boolean; paused: boolean }): JSX.Element {
  const p = c.production
  const reveal = (path: string): void => void window.api.files.reveal(path)
  // Show the folder + filename (e.g. "Reports/Review Index.xlsx") so the layout is clear.
  const rel = (path?: string): string => (path ? path.split(/[\\/]/).slice(-2).join('/') : '')
  // Build a path under the output folder with the right separator for the platform.
  const sep = c.output?.includes('\\') ? '\\' : '/'
  const outPath = (...parts: string[]): string | undefined => (c.output ? [c.output, ...parts].join(sep) : undefined)

  const artifacts: { show: boolean; icon: JSX.Element; label: string; sub: string; path?: string }[] = [
    {
      show: !!p && p.pdfCount > 0,
      icon: <FileStack className="w-4 h-4 text-accent" />,
      label: `${p?.pdfCount ?? 0} PDF${p?.pdfCount === 1 ? '' : 's'} in Documents/`,
      sub: p?.batesRange ? `Bates ${p.batesRange.begin}–${p.batesRange.end}` : 'rendered & Bates-stamped'
    },
    { show: !!p?.indexPath, icon: <FileSpreadsheet className="w-4 h-4 text-accent" />, label: 'Review index', sub: rel(p?.indexPath), path: p?.indexPath },
    { show: !!p?.loadFilePath, icon: <Send className="w-4 h-4 text-accent" />, label: 'Production load file', sub: rel(p?.loadFilePath) + ' + .csv', path: p?.loadFilePath },
    { show: !!p?.highlightsPath, icon: <Highlighter className="w-4 h-4 text-accent" />, label: 'Highlights table', sub: rel(p?.highlightsPath), path: p?.highlightsPath },
    {
      show: !!p && p.excludedAttachments > 0,
      icon: <FileX className="w-4 h-4 text-accent" />,
      label: `${p?.excludedAttachments} attachment${p?.excludedAttachments === 1 ? '' : 's'} excluded`,
      sub: p?.inconsistentAttachments ? `${p.inconsistentAttachments} need review` : 'Excluded/',
      path: outPath('Excluded')
    }
  ]
  const shown = artifacts.filter((a) => a.show)

  return (
    <div className="px-5 pt-4">
      <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-accent/90">
            <FolderOpen className="w-3.5 h-3.5" /> Output
          </div>
          <button
            onClick={() => c.output && reveal(c.output)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] bg-accent text-ink-950 font-medium hover:bg-accent-soft"
          >
            <FolderOpen className="w-4 h-4" /> Open output folder
          </button>
        </div>
        <div className="mt-1 text-[12px] text-ink-600 truncate" title={c.output}>{c.output}</div>

        {paused && (
          <div className="mt-3 text-[12.5px] text-amber-300 flex items-center gap-1.5">
            <Pause className="w-3.5 h-3.5" /> Paused{shown.length > 0 ? ` at ${p?.pdfCount ?? 0} produced` : ''} — Resume to finish.
          </div>
        )}
        {indexing ? (
          <div className="mt-3 text-[12.5px] text-accent flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Building the production…
          </div>
        ) : shown.length === 0 ? (
          !paused && <div className="mt-3 text-[12.5px] text-ink-600">No artifacts produced yet — re-run to build them.</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {shown.map((a) => (
              <button
                key={a.label}
                onClick={() => a.path && reveal(a.path)}
                disabled={!a.path}
                className={`flex items-start gap-2.5 text-left rounded-lg border border-ink-700/70 bg-ink-900/50 p-2.5 ${a.path ? 'hover:border-accent/50' : 'cursor-default'}`}
              >
                {a.icon}
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-slate-200">{a.label}</span>
                  <span className="block text-[11px] text-ink-600 truncate">{a.sub}</span>
                </span>
                {a.path && <ExternalLink className="w-3.5 h-3.5 text-ink-600 ml-auto shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {p && !indexing && (
          <div className="mt-2.5 text-[11.5px] text-ink-600">
            <span className="text-slate-300">{p.processed}</span> processed ·{' '}
            <span className="text-slate-300">{p.skipped}</span> unchanged (reused)
            {p.removed > 0 && <span> · {p.removed} removed from input</span>}
            {p.slipSheets > 0 && <span> · {p.slipSheets} slip-sheeted</span>}
            {p.excludedAttachments > 0 && <span> · {p.excludedAttachments} attachments excluded</span>}
            {p.errors.length > 0 && <span className="text-amber-300/80"> · {p.errors.length} failed</span>}
          </div>
        )}

        {p && !indexing && p.inconsistentAttachments > 0 && (
          <button
            onClick={() => {
              const path = outPath('Excluded', 'Needs Review')
              if (path) reveal(path)
            }}
            className="mt-2 flex items-start gap-2 text-left rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-2.5 text-[12px] text-amber-200/90 hover:border-amber-500/60 w-full"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {p.inconsistentAttachments} excluded filename{p.inconsistentAttachments === 1 ? ' has' : 's have'} copies of different sizes — check{' '}
              <span className="text-amber-200">Excluded/Needs Review</span> in case a real document was filtered out.
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
