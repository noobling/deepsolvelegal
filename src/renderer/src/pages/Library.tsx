import { useState } from 'react'
import { useStore } from '../state/store'
import type { Collection } from '@shared/types'
import {
  Library as LibraryIcon,
  FolderPlus,
  FolderOpen,
  RefreshCw,
  Trash2,
  Loader2,
  Plus,
  Sparkles,
  X,
  FileStack,
  HardDrive
} from 'lucide-react'

export default function Library(): JSX.Element {
  const { collections, indexProgress, openCollection, reindexCollection, deleteCollection } = useStore()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold text-slate-100 flex items-center gap-3">
              <LibraryIcon className="w-7 h-7 text-accent" /> Library
            </h1>
            <p className="text-ink-600 mt-2 text-[15px]">
              Index a folder of documents — emails, contracts, anything — into a searchable, exportable catalog.
            </p>
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
              <HardDrive className="w-3.5 h-3.5" /> Indexing &amp; search run 100% on your computer — no documents leave the device
              <span className="text-emerald-300/60">(unless you enable AI summaries)</span>
            </div>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent text-ink-950 font-medium text-sm hover:bg-accent-soft"
          >
            <Plus className="w-4 h-4" /> New collection
          </button>
        </div>

        {collections.length === 0 && !showNew && (
          <div className="mt-12 text-center text-ink-600">
            <FileStack className="w-12 h-12 mx-auto opacity-40" />
            <p className="mt-3">No collections yet. Create one to index a folder of documents.</p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              c={c}
              progress={indexProgress[c.id]}
              onOpen={() => void openCollection(c.id)}
              onReindex={() => void reindexCollection(c.id)}
              onDelete={() => void deleteCollection(c.id)}
            />
          ))}
        </div>
      </div>

      {showNew && <NewCollection onClose={() => setShowNew(false)} />}
    </div>
  )
}

function CollectionCard({
  c,
  progress,
  onOpen,
  onReindex,
  onDelete
}: {
  c: Collection
  progress?: { phase: string; done: number; total: number }
  onOpen: () => void
  onReindex: () => void
  onDelete: () => void
}): JSX.Element {
  const indexing = c.status === 'indexing'
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-4 hover:border-ink-600 transition">
      <button onClick={onOpen} className="block text-left w-full" disabled={indexing}>
        <div className="font-medium text-slate-100 truncate">{c.name}</div>
        <div className="text-[12px] text-ink-600 mt-0.5 truncate">{c.folders.join(', ')}</div>
      </button>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-[12px] text-ink-600">
          {indexing ? (
            <span className="text-accent flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {progress ? `${progress.phase}… ${progress.done}/${progress.total}` : 'Indexing…'}
            </span>
          ) : c.status === 'error' ? (
            <span className="text-red-400">Error: {c.error}</span>
          ) : (
            <span>
              {c.fileCount} document{c.fileCount === 1 ? '' : 's'}
              {c.aiEnrich ? ' · AI summaries' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!indexing && (
            <>
              <button onClick={onOpen} title="Open index" className="p-1.5 rounded text-ink-600 hover:text-slate-200 hover:bg-ink-800">
                <FolderOpen className="w-4 h-4" />
              </button>
              <button onClick={onReindex} title="Re-index" className="p-1.5 rounded text-ink-600 hover:text-slate-200 hover:bg-ink-800">
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
          <button onClick={onDelete} title="Delete" className="p-1.5 rounded text-ink-600 hover:text-red-400 hover:bg-ink-800">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {indexing && (
        <div className="mt-2 h-1.5 rounded-full bg-ink-800 overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function NewCollection({ onClose }: { onClose: () => void }): JSX.Element {
  const { createCollection } = useStore()
  const [name, setName] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [aiEnrich, setAiEnrich] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const picked = await window.api.library.pickFolders()
    if (picked.length) setFolders((f) => Array.from(new Set([...f, ...picked])))
  }

  const create = async (): Promise<void> => {
    if (!folders.length || busy) return
    setBusy(true)
    await createCollection({ name: name.trim() || 'Untitled collection', folders, aiEnrich })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/70 grid place-items-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-slate-100">New collection</h2>
          <button onClick={onClose} className="text-ink-600 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block mt-5 text-[13px] text-ink-600">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme correspondence"
          className="mt-1 w-full rounded-lg bg-ink-950 border border-ink-700 px-3 py-2 text-sm text-slate-100 focus:border-accent outline-none"
        />

        <label className="block mt-4 text-[13px] text-ink-600">Folders to index</label>
        <button
          onClick={() => void pick()}
          className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-ink-600 text-sm text-slate-300 hover:border-accent hover:text-accent w-full justify-center"
        >
          <FolderPlus className="w-4 h-4" /> Add folder…
        </button>
        {folders.length > 0 && (
          <ul className="mt-2 space-y-1">
            {folders.map((f) => (
              <li key={f} className="flex items-center justify-between text-[12px] text-slate-400 bg-ink-950 rounded px-2 py-1">
                <span className="truncate">{f}</span>
                <button onClick={() => setFolders((x) => x.filter((p) => p !== f))} className="text-ink-600 hover:text-red-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={aiEnrich} onChange={(e) => setAiEnrich(e.target.checked)} className="mt-0.5 accent-[#c9a24b]" />
          <span className="text-[13px] text-slate-300">
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-accent" /> Generate AI summaries
            </span>
            <span className="text-ink-600">Adds a one-line summary, document type, and parties per document (uses the API; slower).</span>
          </span>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm text-slate-300 hover:bg-ink-800">
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={!folders.length || busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-ink-950 font-medium text-sm hover:bg-accent-soft disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileStack className="w-4 h-4" />}
            Create & index
          </button>
        </div>
      </div>
    </div>
  )
}
