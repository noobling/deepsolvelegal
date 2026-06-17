import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { IndexedDoc } from '@shared/types'
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
  Highlighter
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
    setRoute
  } = useStore()
  const openHighlights = (): void => setRoute('highlights')

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<keyof IndexedDoc>('date')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const c = collectionDetail
  const indexing = !!(c && indexProgress[c.id])

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
        <button onClick={() => setRoute('library')} className="text-ink-600 hover:text-slate-200" title="Back to Library">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-slate-100 truncate">{c.name}</div>
          <div className="text-[11px] text-ink-600">
            {c.fileCount} documents{indexing ? ' · indexing…' : ''}
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
          <button
            onClick={() => void reindexCollection(c.id)}
            disabled={indexing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-40"
          >
            {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Re-index
          </button>
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

      <div className="px-5 py-3 border-b border-ink-700/40">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-600" />
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search this index…"
            className="w-full rounded-lg bg-ink-950 border border-ink-700 pl-9 pr-9 py-2 text-sm text-slate-100 focus:border-accent outline-none"
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
                  {searchHits ? 'No matches.' : indexing ? 'Indexing…' : 'No documents indexed.'}
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-ink-800/60 hover:bg-ink-800/40 align-top">
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-3 py-2 text-slate-300">
                    <div className="line-clamp-2 max-w-[22rem]">{String(d[col.key] ?? '')}</div>
                    {col.key === (hasEmail ? 'subject' : 'name') && snippetById.get(d.id) && (
                      <div className="text-[11px] text-ink-600 italic mt-0.5 line-clamp-2">…{snippetById.get(d.id)}…</div>
                    )}
                  </td>
                ))}
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
