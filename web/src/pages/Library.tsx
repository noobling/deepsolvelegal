import { useEffect, useMemo, useRef, useState } from 'react'
import { pickDirectory, supportsDirectoryPicker, walkFiles } from '../lib/files'
import { extOf, INDEXABLE } from '../lib/extract'
import { indexFolder, type IndexSource } from '../lib/indexerClient'
import { listCollections, putCollection, deleteCollection, putIndex, getIndex } from '../lib/db'
import { searchDocs } from '../lib/search'
import { exportCsv, exportXlsx, downloadBlob } from '../lib/export'
import type { Collection, IndexPayload, IndexedDoc, SearchHit } from '../lib/types'

interface Progress {
  phase: string
  done: number
  total: number
  currentFile?: string
}

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString()

export default function Library(): React.JSX.Element {
  const supported = useMemo(supportsDirectoryPicker, [])
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [index, setIndex] = useState<IndexPayload | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'docs' | 'highlights'>('docs')
  const searchRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Original files for the set indexed THIS session — enables email→PDF and production.
  // (Not persisted; opening a stored set won't have them until re-indexed.)
  const filesRef = useRef<{ collectionId: string; getters: Map<string, () => Promise<File>> }>({ collectionId: '', getters: new Map() })

  useEffect(() => {
    void listCollections().then(setCollections)
  }, [])

  // <input webkitdirectory> needs the attribute set imperatively (not a typed JSX prop).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute('webkitdirectory', '')
      inputRef.current.setAttribute('directory', '')
    }
  }, [])

  const results: SearchHit[] = useMemo(
    () => (index && query.trim() ? searchDocs(index.lexical, index.docs, query) : []),
    [index, query]
  )

  const highlightRows = (): Array<Record<string, unknown>> =>
    (index?.highlights ?? []).map((h) => ({
      Document: h.docName,
      Page: h.page ?? '',
      Colour: h.color,
      'Highlighted text': h.text,
      Context: h.context
    }))

  async function runIndex(source: IndexSource, name: string): Promise<void> {
    setError(null)
    const id = crypto.randomUUID()
    const now = Date.now()
    const coll: Collection = { id, name: name || 'Untitled', createdAt: now, updatedAt: now, fileCount: 0, status: 'indexing' }
    await putCollection(coll)
    setCollections((c) => [coll, ...c])
    setActiveId(id)
    setIndex(null)
    setBusy(true)
    setProgress({ phase: 'Scanning', done: 0, total: 0 })
    try {
      // Keep the original files reachable (in memory) for email→PDF / production.
      const getters = new Map<string, () => Promise<File>>()
      if ('files' in source) {
        for (const f of source.files) getters.set(f.webkitRelativePath || f.name, () => Promise.resolve(f))
      } else {
        for await (const wf of walkFiles(source.dir)) {
          if (INDEXABLE.has(extOf(wf.handle.name))) getters.set(wf.path, () => wf.handle.getFile())
        }
      }
      filesRef.current = { collectionId: id, getters }

      const payload = await indexFolder(id, source, (m) =>
        setProgress({ phase: m.phase, done: m.done, total: m.total, currentFile: m.currentFile })
      )
      await putIndex(id, payload)
      const done: Collection = { ...coll, status: 'ready', fileCount: payload.docs.length, updatedAt: Date.now() }
      await putCollection(done)
      setCollections((c) => c.map((x) => (x.id === id ? done : x)))
      setIndex(payload)
      setTimeout(() => searchRef.current?.focus(), 50)
    } catch (e) {
      const msg = (e as Error)?.message || 'Indexing failed'
      const failed: Collection = { ...coll, status: 'error', error: msg, updatedAt: Date.now() }
      await putCollection(failed)
      setCollections((c) => c.map((x) => (x.id === id ? failed : x)))
      setError(msg)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function onPickClick(): Promise<void> {
    if (busy) return
    if (supported) {
      const dir = await pickDirectory()
      if (dir) void runIndex({ dir }, dir.name || 'Untitled')
    } else {
      inputRef.current?.click() // plain-HTTP / non-Chromium fallback
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const name = files[0].webkitRelativePath?.split('/')[0] || 'Folder'
    void runIndex({ files }, name)
  }

  async function open(c: Collection): Promise<void> {
    setActiveId(c.id)
    setQuery('')
    setView('docs')
    setError(c.status === 'error' ? c.error || 'This set failed to index.' : null)
    setIndex(null)
    if (c.status === 'ready') {
      const payload = await getIndex(c.id)
      setIndex(payload ?? null)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }

  async function remove(c: Collection): Promise<void> {
    await deleteCollection(c.id)
    setCollections((cs) => cs.filter((x) => x.id !== c.id))
    if (activeId === c.id) {
      setActiveId(null)
      setIndex(null)
    }
  }

  function fileGetter(docId: string): (() => Promise<File>) | undefined {
    return filesRef.current.collectionId === activeId ? filesRef.current.getters.get(docId) : undefined
  }

  async function exportEmailPdf(doc: IndexedDoc): Promise<void> {
    const getter = fileGetter(doc.id)
    if (!getter) {
      setError('Original file is not in memory — re-index this folder to export the email as PDF.')
      return
    }
    setError(null)
    try {
      const file = await getter()
      const { parseEmail, emailToPdf } = await import('../lib/email')
      const email = await parseEmail(file, doc.ext)
      const bytes = await emailToPdf(email)
      downloadBlob(new Blob([bytes.slice()], { type: 'application/pdf' }), doc.name.replace(/\.[^.]+$/, '') + '.pdf')
    } catch (e) {
      setError('Email→PDF failed: ' + ((e as Error)?.message || e))
    }
  }

  const active = collections.find((c) => c.id === activeId) || null

  return (
    <div className="min-h-full flex">
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onInputChange} />

      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-white/10 flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="font-serif text-[15px] font-semibold leading-tight">Quantum Law Group</div>
          <div className="text-[11px] tracking-widest text-ink-400 uppercase">Document Index</div>
        </div>
        <div className="p-3">
          <button
            onClick={() => void onPickClick()}
            disabled={busy}
            className="w-full rounded-md bg-accent hover:bg-accent-600 disabled:opacity-50 text-ink-900 font-medium text-sm py-2 transition"
          >
            + Index a folder
          </button>
        </div>
        <div className="px-3 text-[11px] uppercase tracking-wider text-ink-400">Sets</div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {collections.length === 0 && <div className="px-2 py-3 text-sm text-ink-400">No sets yet.</div>}
          {collections.map((c) => (
            <div
              key={c.id}
              className={`group rounded-md px-3 py-2 cursor-pointer border ${
                activeId === c.id ? 'bg-white/10 border-white/20' : 'border-transparent hover:bg-white/5'
              }`}
              onClick={() => void open(c)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm">{c.name}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(c)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-red-400 text-xs"
                  title="Delete set"
                >
                  ✕
                </button>
              </div>
              <div className="text-[11px] text-ink-400">
                {c.status === 'indexing' && 'indexing…'}
                {c.status === 'ready' && `${c.fileCount} files · ${fmtDate(c.updatedAt)}`}
                {c.status === 'error' && <span className="text-red-400">error</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 text-[11px] text-ink-400 border-t border-white/10 leading-relaxed">
          🔒 Everything runs in your browser. No files are uploaded.
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {error && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 break-words">
              {error}
            </div>
          )}

          {progress ? (
            <div className="mt-10">
              <div className="font-serif text-xl mb-2">Indexing {active?.name}</div>
              <div className="text-sm text-ink-300 mb-3">
                {progress.phase}
                {progress.total > 0 && ` — ${progress.done}/${progress.total}`}
                {progress.currentFile && <span className="text-ink-400"> · {progress.currentFile}</span>}
              </div>
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '8%' }}
                />
              </div>
            </div>
          ) : !active ? (
            <div className="mt-16 text-center">
              <div className="font-serif text-3xl mb-3">Index a folder of documents</div>
              <p className="text-ink-300 max-w-lg mx-auto leading-relaxed">
                Point at a folder — PDFs, Word, Excel, PowerPoint, email (.eml/.msg) and text — and get a
                fast, full-text searchable index. It all happens on your computer; nothing is uploaded.
              </p>
              <button
                onClick={() => void onPickClick()}
                disabled={busy}
                className="mt-6 rounded-md bg-accent hover:bg-accent-600 disabled:opacity-50 text-ink-900 font-medium px-5 py-2.5 transition"
              >
                + Index a folder
              </button>
              {!supported && (
                <div className="mt-4 text-[12px] text-ink-400">
                  Your browser will open a folder-picker dialog (upload mode). For the smoothest experience use
                  Chrome or Edge over HTTPS/localhost.
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <h1 className="font-serif text-2xl">{active.name}</h1>
                <div className="text-sm text-ink-400">{active.fileCount} documents indexed</div>
              </div>
              {/* Tabs */}
              <div className="flex gap-1 border-b border-white/10 mb-4 text-sm">
                <button
                  onClick={() => setView('docs')}
                  className={`px-3 py-2 -mb-px border-b-2 ${view === 'docs' ? 'border-accent text-ink-50' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
                >
                  Documents
                </button>
                <button
                  onClick={() => setView('highlights')}
                  className={`px-3 py-2 -mb-px border-b-2 ${view === 'highlights' ? 'border-accent text-ink-50' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
                >
                  Highlights{index?.highlights.length ? ` (${index.highlights.length})` : ''}
                </button>
              </div>

              {view === 'docs' ? (
                <>
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search the documents…"
                    className="w-full rounded-md bg-white/5 border border-white/15 focus:border-accent outline-none px-4 py-3 text-[15px]"
                  />
                  <div className="mt-3 text-sm text-ink-400">
                    {query.trim()
                      ? `${results.length} result${results.length === 1 ? '' : 's'}`
                      : `Showing all ${index?.docs.length ?? 0} document${(index?.docs.length ?? 0) === 1 ? '' : 's'}`}
                  </div>
                  <div className="mt-2 space-y-2">
                    {(query.trim() ? results : (index?.docs ?? []).map((d) => ({ doc: d, score: 0, snippet: '' }))).map((h) => (
                      <div key={h.doc.id} className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-[15px] truncate">{h.doc.subject || h.doc.name}</div>
                          <div className="text-[11px] text-ink-400 shrink-0 flex items-center gap-2">
                            {h.doc.kind === 'email' && (
                              <button
                                onClick={() => void exportEmailPdf(h.doc)}
                                className="rounded border border-white/15 hover:bg-white/10 px-2 py-0.5 text-ink-200"
                                title="Render this email to PDF"
                              >
                                → PDF
                              </button>
                            )}
                            <span>
                              {h.doc.kind === 'email' ? '✉︎ ' : ''}
                              {h.doc.ext.replace('.', '').toUpperCase()} · {fmtBytes(h.doc.size)}
                            </span>
                          </div>
                        </div>
                        {h.doc.from && (
                          <div className="text-[12px] text-ink-400 truncate">
                            {h.doc.from}
                            {h.doc.date ? ` · ${h.doc.date}` : ''}
                          </div>
                        )}
                        <div className="text-[12px] text-ink-400 truncate">{h.doc.path}</div>
                        {h.snippet && <div className="mt-1 text-sm text-ink-200 leading-snug">{h.snippet}</div>}
                      </div>
                    ))}
                    {query.trim() && results.length === 0 && (
                      <div className="text-sm text-ink-400 py-6 text-center">No matches.</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm text-ink-400">
                      {(index?.highlights.length ?? 0)} highlighted passage{(index?.highlights.length ?? 0) === 1 ? '' : 's'} across .docx / .pdf
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={!index?.highlights.length}
                        onClick={() => exportCsv(highlightRows(), `${active.name}-highlights.csv`)}
                        className="rounded-md border border-white/15 hover:bg-white/5 disabled:opacity-40 px-3 py-1.5 text-sm"
                      >
                        Export CSV
                      </button>
                      <button
                        disabled={!index?.highlights.length}
                        onClick={() => void exportXlsx(highlightRows(), `${active.name}-highlights.xlsx`, 'Highlights')}
                        className="rounded-md border border-white/15 hover:bg-white/5 disabled:opacity-40 px-3 py-1.5 text-sm"
                      >
                        Export Excel
                      </button>
                    </div>
                  </div>
                  {!index?.highlights.length ? (
                    <div className="text-sm text-ink-400 py-10 text-center">
                      No reviewer highlights found in this set's .docx / .pdf files.
                    </div>
                  ) : (
                    <div className="overflow-auto rounded-md border border-white/10">
                      <table className="w-full text-sm">
                        <thead className="bg-white/5 text-ink-300 text-left">
                          <tr>
                            <th className="px-3 py-2 font-medium">Document</th>
                            <th className="px-3 py-2 font-medium">Pg</th>
                            <th className="px-3 py-2 font-medium">Colour</th>
                            <th className="px-3 py-2 font-medium">Highlighted text</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(index?.highlights ?? []).map((h, i) => (
                            <tr key={i} className="border-t border-white/10 align-top">
                              <td className="px-3 py-2 text-ink-300 whitespace-nowrap max-w-[180px] truncate" title={h.docName}>{h.docName}</td>
                              <td className="px-3 py-2 text-ink-400">{h.page ?? ''}</td>
                              <td className="px-3 py-2 text-ink-400 whitespace-nowrap">{h.color}</td>
                              <td className="px-3 py-2 text-ink-100">{h.text}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
