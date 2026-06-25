import { useState } from 'react'
import { useStore } from '../state/store'
import ProgressBar from '../components/ProgressBar'
import { formatEta } from '../lib/format'
import type { Collection, ProcessFeatures, ProcessingRules } from '@shared/types'
import {
  FolderCog,
  FolderPlus,
  FolderOpen,
  FolderInput,
  RefreshCw,
  Trash2,
  Loader2,
  Plus,
  Sparkles,
  X,
  FileStack,
  FileUp,
  HardDrive,
  Mail,
  FileSpreadsheet,
  Send,
  Highlighter,
  Hash,
  Pause,
  Play
} from 'lucide-react'

export default function Library(): JSX.Element {
  const { collections, indexProgress, openCollection, reindexCollection, deleteCollection, pauseCollection, resumeCollection } = useStore()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold text-slate-100 flex items-center gap-3">
              <FolderCog className="w-7 h-7 text-accent" /> Process documents
            </h1>
            <p className="text-ink-600 mt-2 text-[15px]">
              Point at a group of documents, pick what to produce — searchable index, email→PDF, a review index or a
              production for opposing counsel, highlights — and get one output bundle.
            </p>
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
              <HardDrive className="w-3.5 h-3.5" /> Everything runs 100% on your computer — no documents leave the device
              <span className="text-emerald-300/60">(unless you enable AI summaries)</span>
            </div>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent text-ink-950 font-medium text-sm hover:bg-accent-soft"
          >
            <Plus className="w-4 h-4" /> New document set
          </button>
        </div>

        {collections.length === 0 && !showNew && (
          <div className="mt-12 text-center text-ink-600">
            <FileStack className="w-12 h-12 mx-auto opacity-40" />
            <p className="mt-3">No document sets yet. Create one to process a folder of documents.</p>
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
              onPause={() => void pauseCollection(c.id)}
              onResume={() => void resumeCollection(c.id)}
            />
          ))}
        </div>
      </div>

      {showNew && <NewJob onClose={() => setShowNew(false)} />}
    </div>
  )
}

function FeatureChips({ c }: { c: Collection }): JSX.Element | null {
  const f = c.features
  if (!f) return null
  const chips: { on: boolean; icon: JSX.Element; label: string }[] = [
    { on: f.emailToPdf, icon: <Mail className="w-3 h-3" />, label: 'Email→PDF' },
    { on: f.reviewIndex, icon: <FileSpreadsheet className="w-3 h-3" />, label: 'Review' },
    { on: f.loadFile, icon: <Send className="w-3 h-3" />, label: 'Production' },
    { on: f.highlights, icon: <Highlighter className="w-3 h-3" />, label: 'Highlights' },
    { on: f.aiEnrich, icon: <Sparkles className="w-3 h-3" />, label: 'AI' }
  ]
  const active = chips.filter((ch) => ch.on)
  if (!active.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {active.map((ch) => (
        <span key={ch.label} className="inline-flex items-center gap-1 text-[10.5px] text-accent/90 bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5">
          {ch.icon}
          {ch.label}
        </span>
      ))}
    </div>
  )
}

function CollectionCard({
  c,
  progress,
  onOpen,
  onReindex,
  onDelete,
  onPause,
  onResume
}: {
  c: Collection
  progress?: { phase: string; done: number; total: number; pct: number; currentFile?: string; etaMs?: number }
  onOpen: () => void
  onReindex: () => void
  onDelete: () => void
  onPause: () => void
  onResume: () => void
}): JSX.Element {
  const indexing = c.status === 'indexing'
  const isPaused = c.status === 'paused'
  const pct = progress?.pct ?? 0
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-4 hover:border-ink-600 transition">
      <button onClick={onOpen} className="block text-left w-full" title="Open">
        <div className="font-medium text-slate-100 truncate">{c.name}</div>
        <div className="text-[12px] text-ink-600 mt-0.5 truncate">{c.folders.join(', ')}</div>
      </button>

      <FeatureChips c={c} />

      <div className="mt-3 flex items-center justify-between">
        <div className="text-[12px] text-ink-600">
          {indexing ? (
            <span className="text-accent flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {/* Show the count only when there's a real total; otherwise just the phase. */}
              {progress ? `${progress.phase}…${progress.total > 0 ? ` ${progress.done}/${progress.total}` : ''}` : 'Processing…'}
              {progress && formatEta(progress.etaMs) && (
                <span className="text-ink-600">· {formatEta(progress.etaMs)}</span>
              )}
            </span>
          ) : isPaused ? (
            <span className="text-amber-300 flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" /> Paused
              {c.production ? ` · ${c.production.pdfCount} produced` : ''}
            </span>
          ) : c.status === 'error' ? (
            <span className="text-red-400">Error: {c.error}</span>
          ) : (
            <span className="flex items-center gap-1.5 flex-wrap">
              <span>
                {c.fileCount} document{c.fileCount === 1 ? '' : 's'}
              </span>
              {c.production?.batesRange && (
                <span className="inline-flex items-center gap-1 text-ink-600">
                  <Hash className="w-3 h-3" /> {c.production.batesRange.begin}–{c.production.batesRange.end}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {indexing && (
            <button onClick={onPause} title="Pause" className="p-1.5 rounded text-ink-600 hover:text-amber-300 hover:bg-ink-800">
              <Pause className="w-4 h-4" />
            </button>
          )}
          {isPaused && (
            <button onClick={onResume} className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-accent border border-accent/40 hover:bg-accent/10">
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          )}
          {!indexing && !isPaused && (
            <>
              <button onClick={onOpen} title="Open" className="p-1.5 rounded text-ink-600 hover:text-slate-200 hover:bg-ink-800">
                <FolderOpen className="w-4 h-4" />
              </button>
              <button onClick={onReindex} title="Re-run" className="p-1.5 rounded text-ink-600 hover:text-slate-200 hover:bg-ink-800">
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
          <button onClick={onDelete} title="Delete" className="p-1.5 rounded text-ink-600 hover:text-red-400 hover:bg-ink-800">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {indexing && <ProgressBar pct={pct} className="mt-2" />}
      {indexing && progress?.currentFile && (
        <div className="mt-1.5 text-[11px] text-ink-600 truncate" title={progress.currentFile}>
          {progress.currentFile}
        </div>
      )}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  icon,
  title,
  desc
}: {
  checked: boolean
  onChange: (v: boolean) => void
  icon: JSX.Element
  title: string
  desc: string
}): JSX.Element {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer rounded-lg p-2 hover:bg-ink-950/50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[#c9a24b]" />
      <span className="text-[13px] text-slate-300 min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-slate-200">
          {icon}
          {title}
        </span>
        <span className="text-ink-600">{desc}</span>
      </span>
    </label>
  )
}

function NewJob({ onClose }: { onClose: () => void }): JSX.Element {
  const { createCollection, settings, setToast } = useStore()
  const [name, setName] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [output, setOutput] = useState('')
  const [outputTouched, setOutputTouched] = useState(false)
  // Defaults: exclude attachments/logos, the review index, and the production load file
  // are on; everything else (convert emails to PDF, combine, highlights, AI) is off.
  const [emailToPdf, setEmailToPdf] = useState(false)
  const [reviewIndex, setReviewIndex] = useState(true)
  const [loadFile, setLoadFile] = useState(true)
  const [highlights, setHighlights] = useState(false)
  const [aiEnrich, setAiEnrich] = useState(false)
  const [combine, setCombine] = useState(false)
  const [excludeSignatures, setExcludeSignatures] = useState(true)
  const [excludeAttachmentsText, setExcludeAttachmentsText] = useState('')
  const [batesPrefix, setBatesPrefix] = useState('DOC-')
  const [batesStart, setBatesStart] = useState('1')
  const [busy, setBusy] = useState(false)
  // A `.dslrules.json` imported here pre-fills the form below AND carries the full attachment
  // exclude/keep lists (which the form can't show) into the new set on create.
  const [importedRules, setImportedRules] = useState<ProcessingRules | null>(null)
  const [importedName, setImportedName] = useState('')

  const importConfig = async (): Promise<void> => {
    const r = await window.api.library.pickRules()
    if (r.cancelled) return
    if (!r.ok || !r.rules) {
      setToast(`Import failed: ${r.error || 'Could not read that config file.'}`)
      return
    }
    const rules = r.rules
    setImportedRules(rules)
    setImportedName(r.fileName || 'config')
    if (rules.features) {
      setEmailToPdf(!!rules.features.emailToPdf)
      setReviewIndex(!!rules.features.reviewIndex)
      setLoadFile(!!rules.features.loadFile)
      setHighlights(!!rules.features.highlights)
      setAiEnrich(!!rules.features.aiEnrich)
    }
    if ('combineAttachments' in rules) setCombine(!!rules.combineAttachments)
    if ('excludeSignatures' in rules) setExcludeSignatures(!!rules.excludeSignatures)
    if (rules.bates) {
      setBatesPrefix(rules.bates.prefix ?? 'DOC-')
      setBatesStart(String(rules.bates.start ?? 1))
    }
    if (Array.isArray(rules.excludeAttachments)) setExcludeAttachmentsText(rules.excludeAttachments.join('\n'))
    const n =
      (rules.excludeAttachments?.length ?? 0) +
      (rules.excludeFingerprints?.length ?? 0) +
      (rules.keepAttachments?.length ?? 0) +
      (rules.keepNames?.length ?? 0)
    setToast(`Config imported${n ? ` · ${n} attachment rule${n === 1 ? '' : 's'}` : ''}.`)
  }
  // Count of attachment rules the imported config will carry (shown on the chip).
  const importedRuleCount = importedRules
    ? (importedRules.excludeAttachments?.length ?? 0) +
      (importedRules.excludeFingerprints?.length ?? 0) +
      (importedRules.keepAttachments?.length ?? 0) +
      (importedRules.keepNames?.length ?? 0)
    : 0

  const wantsOutput = emailToPdf || reviewIndex || loadFile || highlights
  const wantsBates = reviewIndex || loadFile || emailToPdf

  // Default the output to the matter folder + the set name, so the user never
  // has to open a picker. They can edit the text or Browse to override it.
  const matterRoot = (settings?.matterRoot || '').replace(/[/\\]+$/, '')
  const sep = matterRoot.includes('\\') ? '\\' : '/'
  const defaultOutput = matterRoot ? `${matterRoot}${sep}${name.trim() || 'Untitled document set'}` : ''
  const outputValue = outputTouched ? output : defaultOutput

  const pickInputs = async (): Promise<void> => {
    const picked = await window.api.library.pickFolders()
    if (picked.length) setFolders((f) => Array.from(new Set([...f, ...picked])))
  }
  const pickOutput = async (): Promise<void> => {
    const dir = await window.api.library.pickOutput()
    if (dir) {
      setOutput(dir)
      setOutputTouched(true)
    }
  }

  const canCreate = folders.length > 0 && (!wantsOutput || !!outputValue.trim()) && !busy

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setBusy(true)
    const features: ProcessFeatures = { emailToPdf, reviewIndex, loadFile, highlights, aiEnrich }
    await createCollection({
      name: name.trim() || 'Untitled document set',
      folders,
      output: wantsOutput ? outputValue.trim() || undefined : undefined,
      features,
      bates: wantsBates ? { prefix: batesPrefix, start: Math.max(1, parseInt(batesStart, 10) || 1) } : undefined,
      combineAttachments: combine,
      excludeSignatures,
      excludeAttachments: excludeAttachmentsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      aiEnrich,
      importedRules: importedRules ?? undefined
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/70 grid place-items-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-slate-100">New document set</h2>
          <button onClick={onClose} className="text-ink-600 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block mt-5 text-[13px] text-ink-600">Input folders</label>
        <button
          onClick={() => void pickInputs()}
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

        <label className="block mt-5 text-[13px] text-ink-600">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme production — set 1"
          className="mt-1 w-full rounded-lg bg-ink-950 border border-ink-700 px-3 py-2 text-sm text-slate-100 focus:border-accent outline-none"
        />

        <div className="mt-5 text-[13px] text-ink-600">Produce</div>
        <div className="mt-1 rounded-lg border border-ink-700/70 bg-ink-900/40 divide-y divide-ink-800/70">
          <Toggle checked={emailToPdf} onChange={setEmailToPdf} icon={<Mail className="w-3.5 h-3.5 text-accent" />} title="Convert emails to PDF" desc="Render emails to Bates-ready PDFs. Every other document type is indexed and produced as its native original — no conversion." />
          <Toggle checked={reviewIndex} onChange={setReviewIndex} icon={<FileSpreadsheet className="w-3.5 h-3.5 text-accent" />} title="Review index (Excel)" desc="Bates, date, type, from/to, subject — for your own review team." />
          <Toggle checked={loadFile} onChange={setLoadFile} icon={<Send className="w-3.5 h-3.5 text-accent" />} title="Production load file (.DAT + .CSV)" desc="For opposing counsel / their review platform; family ranges + Bates." />
          <Toggle checked={highlights} onChange={setHighlights} icon={<Highlighter className="w-3.5 h-3.5 text-accent" />} title="Highlights table" desc="Extract every reviewer highlight to a spreadsheet." />
          <Toggle checked={aiEnrich} onChange={setAiEnrich} icon={<Sparkles className="w-3.5 h-3.5 text-accent" />} title="AI summaries" desc="One-line summary, type, and parties per doc (uses the API; slower)." />
        </div>

        {(reviewIndex || loadFile) && (
          <p className="mt-2 text-[11.5px] text-ink-600">
            A review index or production includes <span className="text-slate-400">every</span> document with a Bates number —{' '}
            {emailToPdf ? (
              <>emails rendered to a Bates-stamped PDF, every other type kept as its <span className="text-slate-400">original native</span>.</>
            ) : (
              <>copied as the <span className="text-slate-400">original native</span> with a document-level Bates number (no PDF conversion).</>
            )}
          </p>
        )}

        {wantsOutput && (
          <>
            <label className="block mt-4 text-[13px] text-ink-600">Output folder (the deliverable bundle)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={outputValue}
                onChange={(e) => {
                  setOutput(e.target.value)
                  setOutputTouched(true)
                }}
                placeholder="Choose or type an output folder…"
                className="flex-1 min-w-0 rounded-lg bg-ink-950 border border-ink-700 px-3 py-2 text-[12.5px] text-slate-200 focus:border-accent outline-none"
              />
              <button
                onClick={() => void pickOutput()}
                title="Browse…"
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ink-700 text-sm text-slate-300 hover:bg-ink-800"
              >
                <FolderInput className="w-4 h-4" /> Browse
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-600">
              Defaults to your matter folder + the set name. The bundle (PDFs, indexes, load file) is written here.
            </p>
          </>
        )}

        {wantsBates && (
          <div className="mt-4 rounded-lg border border-ink-700/70 bg-ink-900/40 p-3 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer text-[12.5px] text-slate-300">
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} className="mt-0.5 accent-[#c9a24b]" />
              <span>
                Combine attachments into one PDF
                <span className="text-ink-600"> · off by default — each attachment becomes its own Bates-numbered document (the e-discovery standard); on merges them into one family PDF sharing the email’s Bates span</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer text-[12.5px] text-slate-300">
              <input type="checkbox" checked={excludeSignatures} onChange={(e) => setExcludeSignatures(e.target.checked)} className="mt-0.5 accent-[#c9a24b]" />
              <span>
                Exclude email signatures &amp; logos
                <span className="text-ink-600"> · sets aside <span className="text-slate-400">images that repeat across the set</span> (recurring signature graphics) <span className="text-slate-400">and</span> files under 3 KB, + strips footer boilerplate; keeps content photos &amp; text</span>
              </span>
            </label>
            <div>
              <div className="text-[12.5px] text-slate-300">
                Exclude attachments by filename
                <span className="text-ink-600"> · one per line (e.g. logos / letterheads like TPL4AL.pdf, image001.png)</span>
              </div>
              <textarea
                value={excludeAttachmentsText}
                onChange={(e) => setExcludeAttachmentsText(e.target.value)}
                placeholder={'TPL4AL.pdf\nimage001.png'}
                rows={3}
                className="mt-1 w-full rounded-lg bg-ink-950 border border-ink-700 px-2.5 py-1.5 text-[12px] text-slate-200 font-mono outline-none focus:border-accent/60 resize-y"
              />
              <div className="text-[11px] text-ink-600">
                Excluded files go to an <span className="text-slate-400">Excluded/</span> folder so you can review them all and restore any you want to keep.
              </div>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <Hash className="w-3.5 h-3.5 text-ink-600" />
              <span className="text-ink-600">Bates prefix</span>
              <input value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} className="w-24 bg-ink-950 border border-ink-700 rounded px-2 py-1 text-slate-200 outline-none focus:border-accent/60" />
              <span className="text-ink-600">start</span>
              <input value={batesStart} onChange={(e) => setBatesStart(e.target.value.replace(/[^0-9]/g, ''))} className="w-20 bg-ink-950 border border-ink-700 rounded px-2 py-1 text-slate-200 outline-none focus:border-accent/60" />
              <span className="text-ink-600">e.g. {batesPrefix}{String(Math.max(1, parseInt(batesStart, 10) || 1)).padStart(6, '0')}</span>
            </div>
          </div>
        )}

        {/* Reuse a saved config (.dslrules.json) — pre-fills every setting above, including
            the hand-curated attachment exclude/keep lists. Secondary, so it sits at the end. */}
        <div className="mt-6 pt-4 border-t border-ink-800/70">
          {importedRules ? (
            <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/[0.07] px-3 py-2 text-[12.5px]">
              <FileUp className="w-4 h-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-slate-200">
                Using config <span className="font-medium">{importedName}</span>
                {importedRuleCount > 0 && (
                  <span className="text-ink-500"> · {importedRuleCount} attachment rule{importedRuleCount === 1 ? '' : 's'}</span>
                )}
              </span>
              <button
                onClick={() => importConfig()}
                className="shrink-0 text-[11.5px] text-ink-500 hover:text-slate-200"
                title="Choose a different config file"
              >
                Replace
              </button>
              <button
                onClick={() => {
                  setImportedRules(null)
                  setImportedName('')
                }}
                className="shrink-0 text-ink-600 hover:text-red-400"
                title="Stop using this config (settings already filled in are kept)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => void importConfig()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 px-3 py-2 text-[12.5px] text-ink-500 hover:border-accent hover:text-accent"
              title="Load settings from a previously exported .dslrules.json config"
            >
              <FileUp className="w-4 h-4" /> Import config…
            </button>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm text-slate-300 hover:bg-ink-800">
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={!canCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-ink-950 font-medium text-sm hover:bg-accent-soft disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileStack className="w-4 h-4" />}
            Process
          </button>
        </div>
      </div>
    </div>
  )
}
