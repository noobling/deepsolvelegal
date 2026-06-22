import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { ProcessFeatures } from '@shared/types'
import ProgressBar from '../components/ProgressBar'
import FileExplorer from '../components/FileExplorer'
import IndexingRules from '../components/IndexingRules'
import { formatEta } from '../lib/format'
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Loader2,
  Highlighter,
  FolderOpen,
  FileStack,
  Pause,
  Play,
  Mail,
  Send,
  Sparkles,
  Check,
  ChevronDown,
  SlidersHorizontal,
  Paperclip,
  Hash
} from 'lucide-react'

const DEFAULT_FEATURES: ProcessFeatures = { emailToPdf: false, reviewIndex: false, loadFile: false, highlights: false, aiEnrich: false }

/** A dropdown to turn deliverables on/off after the first run, so a set can gain (or
 *  drop) a review index / production load file / highlights / AI summaries without being
 *  recreated. The change persists immediately; the next Re-run produces it. */
function OutputsMenu({
  features,
  separate,
  itemNumbering,
  busy,
  onChange,
  onSeparate,
  onItemNumbering
}: {
  features: ProcessFeatures
  separate: boolean
  itemNumbering: boolean
  busy: boolean
  onChange: (f: ProcessFeatures) => void
  onSeparate: (separate: boolean) => void
  onItemNumbering: (enabled: boolean) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const items: { key: keyof ProcessFeatures; label: string; desc: string; icon: JSX.Element }[] = [
    { key: 'emailToPdf', label: 'Convert to PDF', desc: 'Render emails + docs to Bates-ready PDFs (off: copy natives).', icon: <FileText className="w-3.5 h-3.5 text-accent" /> },
    { key: 'reviewIndex', label: 'Review index (Excel)', desc: 'Internal index over the whole set — for your review team.', icon: <FileSpreadsheet className="w-3.5 h-3.5 text-accent" /> },
    { key: 'loadFile', label: 'Production load file', desc: '.DAT + .CSV with family ranges — for opposing counsel.', icon: <Send className="w-3.5 h-3.5 text-accent" /> },
    { key: 'highlights', label: 'Highlights table', desc: 'Every reviewer highlight, flattened to a spreadsheet.', icon: <Highlighter className="w-3.5 h-3.5 text-accent" /> },
    { key: 'aiEnrich', label: 'AI summaries', desc: 'Summary / type / parties per doc (uses the API; slower).', icon: <Sparkles className="w-3.5 h-3.5 text-accent" /> }
  ]
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-50"
        title="Add or remove the deliverables this set produces"
      >
        <SlidersHorizontal className="w-4 h-4" /> Outputs <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-[22rem] rounded-lg border border-ink-700 bg-ink-900 shadow-xl p-1.5">
          <div className="px-2 py-1.5 text-[11px] text-ink-600">Toggle a deliverable, then Re-run to produce it.</div>
          {items.map((it) => {
            const on = !!features[it.key]
            return (
              <button
                key={it.key}
                onClick={() => onChange({ ...features, [it.key]: !on })}
                className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded hover:bg-ink-800 text-left"
              >
                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-accent border-accent' : 'border-ink-600'}`}>
                  {on && <Check className="w-3 h-3 text-ink-950" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[12.5px] text-slate-200">
                    {it.icon}
                    {it.label}
                  </span>
                  <span className="block text-[11px] text-ink-600 leading-snug">{it.desc}</span>
                </span>
              </button>
            )
          })}
          {features.emailToPdf && (
            <>
              <div className="my-1 border-t border-ink-700/70" />
              <div className="px-2 py-1.5 text-[11px] text-ink-600">Document handling — Re-run to re-render.</div>
              {[
                {
                  on: separate,
                  icon: <Paperclip className="w-3.5 h-3.5 text-accent" />,
                  label: 'Save attachments separately',
                  desc: 'Also write attachments as native files beside the PDF (they’re always merged into it too).',
                  toggle: () => onSeparate(!separate)
                },
                {
                  on: itemNumbering,
                  icon: <Hash className="w-3.5 h-3.5 text-accent" />,
                  label: 'Item numbers',
                  desc: 'Prefix every document with a per-family number, e.g. 0001 - Smith Contract.pdf.',
                  toggle: () => onItemNumbering(!itemNumbering)
                }
              ].map((it) => (
                <button
                  key={it.label}
                  onClick={it.toggle}
                  className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded text-left hover:bg-ink-800"
                >
                  <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${it.on ? 'bg-accent border-accent' : 'border-ink-600'}`}>
                    {it.on && <Check className="w-3 h-3 text-ink-950" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12.5px] text-slate-200">
                      {it.icon}
                      {it.label}
                    </span>
                    <span className="block text-[11px] text-ink-600 leading-snug">{it.desc}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Collection(): JSX.Element {
  const {
    collectionDetail,
    indexProgress,
    exportIndex,
    reindexCollection,
    pauseCollection,
    resumeCollection,
    setFeatures,
    setAttachmentMode,
    setItemNumbering,
    setRoute
  } = useStore()
  const openHighlights = (): void => setRoute('highlights')

  const c = collectionDetail
  const indexing = c?.status === 'indexing' || !!(c && indexProgress[c.id])
  const isPaused = c?.status === 'paused'
  const prog = c ? indexProgress[c.id] : undefined
  const pct = prog?.pct ?? 0

  // An output toggle persists immediately but only takes effect on the next run, so we
  // flag that a re-run is pending and clear it once a run starts.
  const [outputsDirty, setOutputsDirty] = useState(false)
  useEffect(() => {
    if (indexing) setOutputsDirty(false)
  }, [indexing])

  const hasHighlights = useMemo(() => (c?.docs ?? []).some((d) => d.highlights?.length), [c])

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
            <OutputsMenu
              features={{ ...DEFAULT_FEATURES, ...(c.features ?? {}) }}
              separate={!!c.separateAttachments}
              itemNumbering={!!c.itemNumbering}
              busy={indexing}
              onChange={(f) => {
                setOutputsDirty(true)
                void setFeatures(f)
              }}
              onSeparate={(separate) => {
                setOutputsDirty(true)
                void setAttachmentMode(true, separate)
              }}
              onItemNumbering={(enabled) => {
                setOutputsDirty(true)
                void setItemNumbering(enabled)
              }}
            />
          )}
          {!indexing && !isPaused && (
            <button
              onClick={() => void reindexCollection(c.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium ${
                outputsDirty ? 'bg-accent text-ink-950 hover:bg-accent-soft' : 'border border-ink-700 text-slate-300 hover:bg-ink-800'
              }`}
              title={outputsDirty ? 'Apply the changed outputs' : undefined}
            >
              <RefreshCw className="w-4 h-4" /> {outputsDirty ? 'Re-run to apply' : 'Re-run'}
            </button>
          )}
          {c.output && (
            <button
              onClick={() => c.output && void window.api.files.reveal(c.output)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800"
              title={c.output}
            >
              <FolderOpen className="w-4 h-4" /> Output folder
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
          <div className="flex justify-between items-center text-[12px] mb-1.5">
            <span className="text-accent flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {prog ? `${prog.phase}…` : 'Processing…'}
            </span>
            <span className="text-slate-200 tabular-nums flex items-center gap-2">
              {prog && formatEta(prog.etaMs) && <span className="text-slate-400">{formatEta(prog.etaMs)}</span>}
              {/* Only show the count when there's a real total to count against. */}
              {prog && prog.total > 0 ? `${prog.done} / ${prog.total} files` : ''}
            </span>
          </div>
          <ProgressBar pct={pct} />
          {prog?.currentFile && (
            <div className="mt-1.5 text-[11.5px] text-slate-400 truncate" title={prog.currentFile}>
              {prog.currentFile}
            </div>
          )}
        </div>
      )}

      <IndexingRules c={c} />

      <div className="px-5 pt-3 pb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-600">
        <FileStack className="w-3.5 h-3.5" /> Files
      </div>
      <FileExplorer c={c} />
    </div>
  )
}

