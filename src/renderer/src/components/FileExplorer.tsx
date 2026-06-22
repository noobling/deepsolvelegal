import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useStore } from '../state/store'
import type { CollectionDetail, DirEntry, FilePreview } from '@shared/types'
import {
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  Folder,
  FolderOpen,
  FolderPlus,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  FileX,
  Loader2,
  ExternalLink,
  RefreshCw,
  Search,
  Ban,
  Undo2,
  Check,
  X
} from 'lucide-react'

type Tab = 'source' | 'output'

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Stream a local file through the main-process dsfile:// protocol. Used for
// pdf/image previews — the native PDF viewer and <img> can load this, whereas
// renderer-created blob: URLs are rejected as "local resources" by Electron.
const dsfileUrl = (absPath: string): string => `dsfile://file/${encodeURIComponent(absPath)}`

const iconFor = (e: DirEntry): JSX.Element => {
  if (e.ext === '.pdf') return <FileText className="w-3.5 h-3.5 text-rose-300/80" />
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(e.ext))
    return <ImageIcon className="w-3.5 h-3.5 text-sky-300/80" />
  if (['.docx', '.xlsx', '.xlsm', '.xls', '.pptx', '.ppsx', '.ppt'].includes(e.ext))
    return <FileText className="w-3.5 h-3.5 text-emerald-300/70" />
  return <FileIcon className="w-3.5 h-3.5 text-ink-500" />
}

/** A flattened, visible tree node: an entry plus its indent depth. */
type FlatNode = { entry: DirEntry; depth: number }

/** One row in the flat tree (no recursion / local state — the parent owns it all).
 *  Memoized + given the entry-taking callbacks so that selecting/toggling one row in a
 *  large expanded tree re-renders only the rows whose props actually changed, not all
 *  of them. */
const Row = memo(function Row({
  entry,
  depth,
  selected,
  expanded,
  loading,
  excluded,
  innerRef,
  onSelect,
  onToggle
}: {
  entry: DirEntry
  depth: number
  selected: boolean
  expanded: boolean
  loading: boolean
  excluded: boolean
  innerRef?: (el: HTMLDivElement | null) => void
  onSelect: (entry: DirEntry) => void
  onToggle: (entry: DirEntry) => void
}): JSX.Element {
  const pad = { paddingLeft: `${depth * 14 + 8}px` }
  const reveal = (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void window.api.files.reveal(entry.path)
      }}
      title="Reveal in Finder"
      className="shrink-0 flex items-center px-2 text-ink-600 opacity-0 group-hover:opacity-100 hover:text-accent"
    >
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  )
  return (
    <div ref={innerRef} className={`group flex items-stretch rounded ${selected ? 'bg-accent/15' : 'hover:bg-ink-800/50'}`}>
      <button
        onClick={entry.isDir ? () => { onSelect(entry); onToggle(entry) } : () => onSelect(entry)}
        style={pad}
        className={`flex-1 min-w-0 flex items-center gap-1.5 py-1 pr-2 text-left text-[12.5px] ${selected ? 'text-slate-100' : 'text-slate-300'}`}
      >
        {entry.isDir ? (
          expanded ? <ChevronDown className="w-3.5 h-3.5 text-ink-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {entry.isDir ? (
          expanded ? <FolderOpen className="w-3.5 h-3.5 text-accent/80 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-accent/70 shrink-0" />
        ) : (
          iconFor(entry)
        )}
        <span className={`truncate ${excluded ? 'line-through text-ink-600' : ''}`}>{entry.name}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-ink-500 ml-1" />}
        {excluded && <Ban className="w-3 h-3 text-amber-400/80 shrink-0" />}
      </button>
      {reveal}
    </div>
  )
})

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
const TEXT_EXTS = ['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.htm', '.eml', '.rtf', '.tsv', '.yml', '.yaml']
const OFFICE_EXTS = ['.docx', '.xlsx', '.xlsm', '.xls', '.pptx', '.ppsx', '.ppt']
type PreviewKind = 'pdf' | 'image' | 'text' | 'office' | 'unsupported'
const kindOf = (ext: string): PreviewKind =>
  ext === '.pdf'
    ? 'pdf'
    : IMAGE_EXTS.includes(ext)
      ? 'image'
      : OFFICE_EXTS.includes(ext)
        ? 'office'
        : TEXT_EXTS.includes(ext)
          ? 'text'
          : 'unsupported'

// Styling for the injected Office HTML (mammoth/exceljs/pptx fragments).
const OFFICE_CSS = `
.office-preview { line-height: 1.5; }
.office-preview table { border-collapse: collapse; margin: 4px 0 16px; }
.office-preview td { border: 1px solid #2a3344; padding: 3px 8px; vertical-align: top; white-space: pre-wrap; }
.office-preview h1, .office-preview h2, .office-preview h3 { color: #cbd5e1; font-weight: 600; margin: 14px 0 6px; }
.office-preview p { margin: 4px 0; }
.office-preview a { color: #c9a24b; }
.office-preview img { max-width: 100%; height: auto; }
.office-preview .slide-no { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin-top: 14px; }
.office-preview section { border-left: 2px solid #2a3344; padding-left: 10px; margin: 8px 0; }
.office-preview .muted { color: #64748b; font-style: italic; }
`
const PREVIEW_CAP = 25 * 1024 * 1024 // keep huge files out of the inline preview

// Excluded/ copies are written decorated with their size and perceptual hash, e.g.
// "image018 (69004 bytes, dh=c1d497e9e0f0f0c0).png" (older runs: just "(69004 bytes)").
// Strip that decoration to recover the original attachment name. Keep both shapes working.
const DECOR_RE = /^(.*) \(\d+ bytes(?:, dh=[^)]*)?\)(\.[^.]*)$/
// Produced documents are prefixed with a per-family item number when that's on, e.g.
// "0097 - image004.png". Strip that leading prefix so the fingerprint matches the original
// attachment name the resolver works in (only when item numbering is on, so a real filename
// that genuinely starts with "1234 - " isn't mangled). Removes a single leading prefix only.
const ITEMNO_RE = /^\d+ - /
const undecorateName = (name: string, itemNumbering = false): string => {
  const base = itemNumbering ? name.replace(ITEMNO_RE, '') : name
  const m = base.match(DECOR_RE)
  return m ? m[1] + m[2] : base
}
// Pointer to the attachment the user clicked (name|size), matching the resolver's fpOf in
// production.ts. It's only a POINTER: the resolver maps it to the file's actual bytes and
// excludes/keeps by content (this file + every similar/identical copy).
const fingerprintOf = (entry: DirEntry, itemNumbering = false): string => {
  return undecorateName(entry.name, itemNumbering).trim().toLowerCase() + '|' + entry.size
}
// The original attachment name for a file, stripping the decoration that Excluded/ copies
// carry (and any item-number prefix), so it matches the by-name exclude/keep lists.
const baseNameOf = (entry: DirEntry, itemNumbering = false): string => undecorateName(entry.name, itemNumbering)

/** Undo choice for a file excluded by a by-name rule: drop the whole name rule, or keep
 *  just this one file (a per-file keep that overrides the name exclusion for this path). */
function ExcludedUndoMenu({ base, onKeepFile, onIncludeAll }: { base: string; onKeepFile: () => void; onIncludeAll: () => void }): JSX.Element {
  return (
    <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-md border border-ink-700 bg-ink-900 shadow-xl py-1">
      <button onClick={onKeepFile} className="w-full text-left px-3 py-1.5 hover:bg-ink-800">
        <span className="text-[12px] text-slate-100">Keep just this file</span>
        <span className="block text-[11px] text-ink-600">Produce this exact file; the rest named “{base}” stay excluded</span>
      </button>
      <button onClick={onIncludeAll} className="w-full text-left px-3 py-1.5 hover:bg-ink-800">
        <span className="text-[12px] text-slate-100">Include all named “{base}”</span>
        <span className="block text-[11px] text-ink-600">Stop excluding every file with this name</span>
      </button>
    </div>
  )
}

/** Preview pane for a single selected file. */
function Preview({
  entry,
  excludedNames,
  excludedFps,
  matchedFps,
  matchedKeptFps,
  excludedDir,
  keptFps,
  keptNames,
  intendedDirs,
  itemNumbering,
  busy,
  onExclude,
  onUnexclude,
  onKeepFile,
  onRestore,
  onUnrestore
}: {
  entry: DirEntry | null
  excludedNames: Set<string>
  excludedFps: Set<string>
  /** Fingerprints the current rules would exclude by CONTENT (incl. copies under other
   *  filenames). A file in here but not in excludedNames/excludedFps is matched, not ruled. */
  matchedFps: Set<string>
  /** Fingerprints the current keep rules would RESTORE by CONTENT (incl. look-alike copies).
   *  A file in here but not in keptFps/keptNames is restored by match, not by its own rule. */
  matchedKeptFps: Set<string>
  /** Absolute path of the output's Excluded/ folder, so a restore button can show for files inside it. */
  excludedDir: string | null
  keptFps: Set<string>
  keptNames: Set<string>
  /** For a file in Excluded/: the produced folder(s) a restore would put it back into. */
  intendedDirs?: string[]
  /** Produced files carry an item-number prefix — strip it when computing fingerprints. */
  itemNumbering: boolean
  /** A re-run is in flight — block toggling so changes can't queue onto a half-built output. */
  busy: boolean
  onExclude: (name: string, fp: string, paths?: string[]) => void
  onUnexclude: (name: string, fp: string, paths?: string[]) => void
  /** Keep just this one file, overriding a by-name exclusion (the rest stay excluded). */
  onKeepFile: (name: string, fp: string) => void
  onRestore: (name: string, fp: string, scope: 'file' | 'name', paths?: string[]) => void
  onUnrestore: (name: string, fp: string, paths?: string[]) => void
}): JSX.Element {
  // pdf/image stream through dsfile:// directly (no byte read); text is pulled in
  // as a string; office docs are converted to HTML in the main process.
  const [text, setText] = useState<FilePreview | null>(null)
  const [loadingText, setLoadingText] = useState(false)
  const [office, setOffice] = useState<{ loading: boolean; html?: string; error?: string } | null>(null)
  // Which menu (exclude scope / restore scope / excluded-undo) is open; reset on selection change.
  const [menu, setMenu] = useState<null | 'undo'>(null)
  useEffect(() => setMenu(null), [entry])
  const kind = entry && !entry.isDir ? kindOf(entry.ext) : 'unsupported'

  useEffect(() => {
    setOffice(null)
    if (!entry || entry.isDir || kindOf(entry.ext) !== 'office' || entry.size > PREVIEW_CAP) return
    let alive = true
    setOffice({ loading: true })
    window.api.files
      .renderOffice(entry.path)
      .then((r) => {
        if (alive) setOffice({ loading: false, html: r.ok ? r.html : undefined, error: r.ok ? undefined : r.error || 'Could not render this document.' })
      })
      .catch((e: Error) => {
        if (alive) setOffice({ loading: false, error: e.message })
      })
    return () => {
      alive = false
    }
  }, [entry])

  useEffect(() => {
    setText(null)
    if (!entry || entry.isDir || kindOf(entry.ext) !== 'text' || entry.size > PREVIEW_CAP) return
    let alive = true
    setLoadingText(true)
    window.api.files
      .read(entry.path)
      .then((p) => {
        if (alive) setText(p)
      })
      .catch((e: Error) => {
        if (alive) setText({ ok: false, kind: 'text', mime: '', size: 0, data: '', error: e.message })
      })
      .finally(() => {
        if (alive) setLoadingText(false)
      })
    return () => {
      alive = false
    }
  }, [entry])

  if (!entry || entry.isDir) {
    return (
      <div className="h-full grid place-items-center text-ink-600 text-[12.5px]">
        Select a file to preview it.
      </div>
    )
  }

  const base = baseNameOf(entry, itemNumbering)
  const fp = fingerprintOf(entry, itemNumbering)
  // A per-file or by-name "keep" overrides every exclusion rule (matches production).
  const isRestoredDirect = keptFps.has(fp) || keptNames.has(base.toLowerCase())
  // Restored only because a look-alike copy was restored (no keep rule on this file itself).
  const isRestoredByMatch = !isRestoredDirect && matchedKeptFps.has(fp)
  const isRestored = isRestoredDirect || isRestoredByMatch
  const excludedByName = excludedNames.has(base.toLowerCase())
  const excludedByFp = excludedFps.has(fp)
  // Excluded because it matches an exclude rule by CONTENT (e.g. the same image excluded
  // under a different filename), not because a rule was set on this file directly.
  const excludedByMatch = !excludedByName && !excludedByFp && matchedFps.has(fp)
  const isExcluded = !isRestored && (excludedByName || excludedByFp || excludedByMatch)
  const tooLarge = entry.size > PREVIEW_CAP
  const src = dsfileUrl(entry.path)
  // A file living under the output's Excluded/ folder was set aside by a filename
  // rule or the signature/logo detection — offer to restore it (and keep it kept).
  const inExcludedFolder = !!excludedDir && (entry.path === excludedDir || entry.path.startsWith(excludedDir + '/') || entry.path.startsWith(excludedDir + '\\'))

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-ink-700/50 px-3 py-2 flex items-center gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] text-slate-100 truncate" title={entry.name}>{entry.name}</div>
          <div className="text-[11px] text-ink-600">{fmtSize(entry.size)}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {inExcludedFolder ? (
            isRestoredDirect ? (
              <button
                onClick={() => onUnrestore(base, fp, intendedDirs)}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={busy ? 'A re-run is in progress…' : 'Cancel restore — leave this attachment (and its look-alikes) excluded'}
              >
                <Check className="w-3.5 h-3.5" /> Restoring — undo
              </button>
            ) : isRestoredByMatch ? (
              // Will be restored because a look-alike copy was restored — no rule on THIS file
              // to undo (undo it from the file you restored). Show the state, not a dead button.
              <span
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-emerald-500/40 text-emerald-300"
                title="A copy that looks the same was restored, so this one comes back too. Undo it from the file you restored."
              >
                <Check className="w-3.5 h-3.5" /> Restoring (look-alike)
              </span>
            ) : (
              <button
                onClick={() => onRestore(base, fp, 'file', intendedDirs)}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
                title={busy ? 'A re-run is in progress…' : 'Restore this attachment, and every copy that looks the same, to the production'}
              >
                <Undo2 className="w-3.5 h-3.5" /> Restore similar
              </button>
            )
          ) : isRestoredDirect ? (
            // Kept back from a by-name exclusion (this one file is produced; the rest stay out).
            <button
              onClick={() => onUnrestore(base, fp, intendedDirs)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title={busy ? 'A re-run is in progress…' : 'Stop keeping this file — re-apply the exclusion'}
            >
              <Check className="w-3.5 h-3.5" /> Kept — undo
            </button>
          ) : isExcluded ? (
            excludedByName ? (
              // Excluded by a by-name rule — undo the whole rule, or keep just this file.
              <div className="relative">
                <button
                  onClick={() => setMenu(menu === 'undo' ? null : 'undo')}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={busy ? 'A re-run is in progress…' : 'Undo the exclusion'}
                >
                  <X className="w-3.5 h-3.5" /> Excluded — undo <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
                {menu === 'undo' && (
                  <ExcludedUndoMenu
                    base={base}
                    onKeepFile={() => { setMenu(null); onKeepFile(base, fp) }}
                    onIncludeAll={() => { setMenu(null); onUnexclude(base, fp, intendedDirs) }}
                  />
                )}
              </div>
            ) : excludedByFp ? (
              // Excluded by content ("this attachment + every copy that looks the same") — single undo.
              <button
                onClick={() => onUnexclude(base, fp, intendedDirs)}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={busy ? 'A re-run is in progress…' : 'Stop excluding this attachment and ones like it'}
              >
                <X className="w-3.5 h-3.5" /> Excluded — undo
              </button>
            ) : (
              // Excluded because it matches a rule set on another copy — there's no rule on
              // THIS file to undo, so the action is a per-file keep (produce this one anyway).
              <button
                onClick={() => onKeepFile(base, fp)}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={busy ? 'A re-run is in progress…' : 'Matches an exclude rule (same image) — keep this copy in the production'}
              >
                <X className="w-3.5 h-3.5" /> Excluded (match) — keep this
              </button>
            )
          ) : (
            <button
              onClick={() => onExclude(base, fp, intendedDirs)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title={busy ? 'A re-run is in progress…' : 'Exclude this attachment, and every copy that looks the same, from the production (shortcut: X)'}
            >
              <FileX className="w-3.5 h-3.5" /> Exclude similar
              <kbd className="ml-0.5 px-1 py-px rounded border border-ink-600 bg-ink-800 text-[10px] text-ink-400">X</kbd>
            </button>
          )}
          <button
            onClick={() => void window.api.files.reveal(entry.path)}
            title="Reveal in Explorer"
            className="p-1.5 rounded-md border border-ink-700 text-ink-500 hover:text-slate-200 hover:bg-ink-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {inExcludedFolder && intendedDirs && intendedDirs.length > 0 && (
        <div className="shrink-0 border-b border-ink-700/50 px-3 py-2 text-[11.5px] text-ink-500">
          <span className="text-ink-600">Restored {intendedDirs.length === 1 ? 'copy appears' : 'copies appear'} in </span>
          {intendedDirs.slice(0, 4).map((d, i) => (
            <span key={d}>
              {i > 0 ? ', ' : ''}
              <span className="text-slate-300 font-mono break-all">{d}/</span>
            </span>
          ))}
          {intendedDirs.length > 4 && <span className="text-ink-600"> +{intendedDirs.length - 4} more</span>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-ink-950/40">
        {tooLarge ? (
          <div className="h-full grid place-items-center text-center text-ink-600 text-[12.5px] px-6">
            <div>
              This file is {fmtSize(entry.size)} — too large to preview inline.
              <br />
              Use <span className="text-slate-300">Reveal in Explorer</span> to open it.
            </div>
          </div>
        ) : kind === 'pdf' ? (
          <iframe title={entry.name} src={src} className="w-full h-full border-0" />
        ) : kind === 'image' ? (
          <div className="min-h-full grid place-items-center p-4">
            <img src={src} alt={entry.name} className="max-w-full h-auto rounded shadow" />
          </div>
        ) : kind === 'office' ? (
          office?.loading ? (
            <div className="h-full grid place-items-center text-ink-600">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : office?.html ? (
            <>
              <style>{OFFICE_CSS}</style>
              <div className="office-preview p-4 text-[12.5px] text-slate-200" dangerouslySetInnerHTML={{ __html: office.html }} />
            </>
          ) : (
            <div className="h-full grid place-items-center text-center text-ink-600 text-[12.5px] px-6">
              <div>
                Couldn&apos;t render this document{office?.error ? `: ${office.error}` : ''}.
                <br />
                Use <span className="text-slate-300">Reveal in Explorer</span> to open it.
              </div>
            </div>
          )
        ) : kind === 'text' ? (
          loadingText ? (
            <div className="h-full grid place-items-center text-ink-600">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : text && text.ok ? (
            <pre className="text-[12px] text-slate-300 whitespace-pre-wrap break-words p-4 font-mono">{text.data}</pre>
          ) : (
            <div className="h-full grid place-items-center text-ink-600 text-[12.5px]">
              {text?.error ? `Couldn't read this file: ${text.error}` : 'Nothing to preview.'}
            </div>
          )
        ) : (
          <div className="h-full grid place-items-center text-center text-ink-600 text-[12.5px] px-6">
            <div>
              No inline preview for this file type.
              <br />
              Use <span className="text-slate-300">Reveal in Explorer</span> to open it.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function FileExplorer({ c }: { c: CollectionDetail }): JSX.Element {
  const {
    setExcludedAttachments,
    addSources,
    reindexCollection,
    setKeptAttachments,
    setExcludedFingerprints,
    setKeptNames,
    queueAttachmentOp,
    indexProgress,
    pendingOps
  } = useStore()
  const hasOutput = !!c.output
  const [tab, setTab] = useState<Tab>(hasOutput ? 'output' : 'source')
  const [selected, setSelected] = useState<DirEntry | null>(null)
  // Adding sources or toggling an attachment queues a change; the user applies them
  // all with one manual Re-run (re-rendering is a long operation, so we don't fire it
  // per click). `busy` is true while that run is in flight.
  const [pending, setPending] = useState<'sources' | null>(null)
  const busy = !!indexProgress[c.id]
  const attachmentOps = useMemo(() => pendingOps[c.id] ?? [], [pendingOps, c.id])
  // A source path can be a folder or a single file; stat resolves which (and its size).
  const [sourceKinds, setSourceKinds] = useState<Record<string, { isDir: boolean; size: number }>>({})
  // Central tree state (one model, so arrow keys can walk a flat visible list).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [childCache, setChildCache] = useState<Record<string, DirEntry[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  // Filename search: a full one-time walk of the active roots, then a flat filtered list.
  const [query, setQuery] = useState('')
  const [fullScan, setFullScan] = useState<DirEntry[] | null>(null)
  const [scanning, setScanning] = useState(false)
  // Bumped by Refresh to force the source-root stat probe to re-run.
  const [refreshNonce, setRefreshNonce] = useState(0)
  // Excluded-file → produced folder(s) a restore lands in, read from Excluded/.restore-map.json.
  const [restoreMap, setRestoreMap] = useState<Record<string, string[]> | null>(null)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)

  const excludedList = useMemo(() => c.excludeAttachments ?? [], [c.excludeAttachments])
  const excludedSet = useMemo(() => new Set(excludedList.map((s) => s.toLowerCase())), [excludedList])
  const excludedFpList = useMemo(() => c.excludeFingerprints ?? [], [c.excludeFingerprints])
  const excludedFpSet = useMemo(() => new Set(excludedFpList), [excludedFpList])

  // Content-based preview of what the current rules would set aside, keyed by fingerprint
  // (name|size) so the tree can cross out EVERY matching copy — including ones with a
  // different filename or a re-encoded variant — the instant a rule changes, without waiting
  // for a re-run. The renderer can't hash file contents, so the main process resolves it
  // with the same resolver the production run uses (they can't disagree).
  const [resolvedExcludedFps, setResolvedExcludedFps] = useState<Set<string>>(new Set())
  // Companion of resolvedExcludedFps for KEEP rules: every copy a restore reaches, including
  // perceptually-similar twins under other filenames — so restoring one image visibly
  // restores its look-alikes too, before a re-run.
  const [resolvedKeptFps, setResolvedKeptFps] = useState<Set<string>>(new Set())
  useEffect(() => {
    let alive = true
    void window.api.library.resolveExcluded(c.id).then((fps) => {
      if (alive) setResolvedExcludedFps(new Set(fps))
    })
    void window.api.library.resolveKept(c.id).then((fps) => {
      if (alive) setResolvedKeptFps(new Set(fps))
    })
    return () => {
      alive = false
    }
  }, [c.id, c.excludeFingerprints, c.excludeAttachments, c.keepAttachments, c.keepNames, c.excludeSignatures, c.production])
  const keptList = useMemo(() => c.keepAttachments ?? [], [c.keepAttachments])
  const keptSet = useMemo(() => new Set(keptList), [keptList])
  const keptNamesList = useMemo(() => c.keepNames ?? [], [c.keepNames])
  const keptNamesSet = useMemo(() => new Set(keptNamesList.map((s) => s.toLowerCase())), [keptNamesList])
  const sep = c.output?.includes('\\') ? '\\' : '/'
  const excludedDir = c.output ? c.output.replace(/[/\\]+$/, '') + sep + 'Excluded' : null

  // Probe each source path once so a file root renders as a file, a folder as a folder.
  useEffect(() => {
    let alive = true
    void Promise.all(
      c.folders.map(async (p) => {
        const s = await window.api.files.stat(p)
        return [p, { isDir: s?.isDir ?? true, size: s?.size ?? 0 }] as const
      })
    ).then((pairs) => {
      if (alive) setSourceKinds(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [c.folders, refreshNonce])

  // Load the Excluded/ restore map so the preview can name the produced folder a
  // restored attachment will land in. Re-read after each run (c.production changes).
  useEffect(() => {
    setRestoreMap(null)
    if (!excludedDir) return
    let alive = true
    void window.api.files.read(`${excludedDir}${sep}.restore-map.json`).then((r) => {
      if (!alive || !r.ok || r.kind !== 'text' || !r.data) return
      try {
        setRestoreMap(JSON.parse(r.data) as Record<string, string[]>)
      } catch {
        /* missing/invalid map — the restore hint just won't show */
      }
    })
    return () => {
      alive = false
    }
  }, [excludedDir, sep, c.production, refreshNonce])

  // Roots for the active tab: every input source (Source) or the single bundle (Output).
  const roots: DirEntry[] = useMemo(() => {
    const base = (p: string): string => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p
    if (tab === 'output') {
      return c.output ? [{ name: base(c.output), path: c.output, isDir: true, size: 0, ext: '' }] : []
    }
    return c.folders.map((p) => {
      const k = sourceKinds[p]
      const isDir = k?.isDir ?? true
      return { name: base(p), path: p, isDir, size: k?.size ?? 0, ext: isDir ? '' : p.slice(p.lastIndexOf('.')).toLowerCase() }
    })
  }, [tab, c.output, c.folders, sourceKinds])

  const rootPaths = useMemo(() => roots.map((r) => r.path), [roots])

  // On tab/collection change, reset the tree to its roots expanded.
  useEffect(() => {
    setExpanded(new Set(rootPaths))
    setSelected(null)
    setQuery('')
    setFullScan(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, c.id])

  // A finished run rewrites the produced output, but the tree may hold directory
  // listings cached from before/during the build (e.g. an empty Documents/ from when it
  // was first opened) — so the output tab would show stale content until a manual
  // Refresh. Drop the cached listings whenever a run completes (its production summary
  // changes), so the fresh bundle shows up on its own. Keyed on a stable signature so a
  // detail re-fetch that doesn't change the output won't churn the tree.
  const prodSig = c.production ? `${c.production.pdfCount}:${c.production.batesRange?.end ?? ''}:${c.production.excludedAttachments ?? 0}` : ''
  useEffect(() => {
    if (tab !== 'output') return
    setChildCache({})
    setLoadingDirs(new Set())
    setFullScan(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodSig])

  // Aggregate file/folder totals for the header summary, counted natively in one IPC
  // (descendants of the input folders, and of the produced bundle). Source recounts on
  // Refresh; output recounts whenever a run rewrites the bundle (prodSig) or on Refresh.
  const [srcCount, setSrcCount] = useState<{ files: number; folders: number } | null>(null)
  const [outCount, setOutCount] = useState<{ files: number; folders: number } | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.files.countTree(c.folders).then((r) => alive && setSrcCount(r))
    return () => {
      alive = false
    }
  }, [c.folders, refreshNonce])
  useEffect(() => {
    if (!c.output) {
      setOutCount(null)
      return
    }
    let alive = true
    void window.api.files.countTree([c.output]).then((r) => alive && setOutCount(r))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.output, prodSig, refreshNonce])

  // Lazily load children for any expanded directory not yet cached.
  useEffect(() => {
    for (const p of expanded) {
      if (p in childCache || loadingDirs.has(p)) continue
      setLoadingDirs((s) => new Set(s).add(p))
      window.api.files
        .listDir(p)
        .then((ch) => setChildCache((c2) => ({ ...c2, [p]: ch })))
        .catch(() => setChildCache((c2) => ({ ...c2, [p]: [] })))
        .finally(() =>
          setLoadingDirs((s) => {
            const n = new Set(s)
            n.delete(p)
            return n
          })
        )
    }
  }, [expanded, childCache, loadingDirs])

  // The visible rows, depth-first, honouring which directories are expanded.
  const flat: FlatNode[] = useMemo(() => {
    const out: FlatNode[] = []
    const walk = (entry: DirEntry, depth: number): void => {
      out.push({ entry, depth })
      if (entry.isDir && expanded.has(entry.path)) {
        for (const ch of childCache[entry.path] ?? []) walk(ch, depth + 1)
      }
    }
    for (const r of roots) walk(r, 0)
    return out
  }, [roots, expanded, childCache])

  const toggleDir = (p: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  // Stable handlers so memoized Rows don't re-render just because the parent did.
  const onRowToggle = useCallback((entry: DirEntry): void => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(entry.path)) n.delete(entry.path)
      else n.add(entry.path)
      return n
    })
  }, [])
  const onRowSelect = useCallback((entry: DirEntry): void => {
    setSelected(entry)
    treeRef.current?.focus()
  }, [])

  // Picking a search hit jumps back to the tree and reveals the file in place: expand
  // every ancestor folder, drop the search query (so the tree shows again), and select
  // it — the scroll-into-view effect then brings the row on screen. The full walk has
  // already cached every directory listing, so the ancestors render without a fetch.
  const revealInTree = useCallback(
    (entry: DirEntry): void => {
      const root = rootPaths.find((rp) => entry.path === rp || entry.path.startsWith(rp + '/') || entry.path.startsWith(rp + '\\'))
      const open: string[] = []
      if (root) {
        open.push(root)
        let cur = entry.path
        for (;;) {
          const i = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'))
          if (i <= 0) break
          const parent = cur.slice(0, i)
          if (parent.length <= root.length) break // reached the root
          open.push(parent)
          cur = parent
        }
      }
      setExpanded((s) => new Set([...s, ...open]))
      setQuery('')
      setSelected(entry)
      treeRef.current?.focus()
    },
    [rootPaths]
  )

  const collapseAll = (): void => setExpanded(new Set())
  const expandAll = async (): Promise<void> => {
    const found = new Set<string>()
    const cache: Record<string, DirEntry[]> = { ...childCache }
    const visit = async (p: string): Promise<void> => {
      if (found.has(p) || found.size > 3000) return
      found.add(p)
      let ch = cache[p]
      if (!ch) {
        ch = await window.api.files.listDir(p)
        cache[p] = ch
      }
      for (const child of ch) if (child.isDir) await visit(child.path)
    }
    for (const r of roots) if (r.isDir) await visit(r.path)
    setChildCache(cache)
    setExpanded(found)
  }

  // Re-scan from disk: drop every cached directory listing (and re-stat the roots)
  // so files added or deleted in Finder/Explorer since the last view show up.
  const refresh = (): void => {
    setSelected(null)
    setChildCache({})
    setLoadingDirs(new Set())
    setFullScan(null)
    setRefreshNonce((n) => n + 1)
  }

  // One full walk of the active roots, collecting every entry, for filename search.
  // Reuses any already-cached listings; capped so a huge set can't run away. The walk
  // drains a directory queue across a pool of workers so listings overlap instead of
  // going one-at-a-time — a deep produced-output tree (many email family folders) scans
  // far quicker. Order isn't preserved, which is fine for a filtered search result.
  const scanAll = async (): Promise<DirEntry[]> => {
    const out: DirEntry[] = []
    const cache: Record<string, DirEntry[]> = { ...childCache }
    const seen = new Set<string>()
    const queue: DirEntry[] = []
    const enqueue = (entry: DirEntry): void => {
      out.push(entry)
      if (entry.isDir && !seen.has(entry.path) && seen.size <= 5000) {
        seen.add(entry.path)
        queue.push(entry)
      }
    }
    for (const r of roots) enqueue(r)

    let head = 0
    let active = 0
    // A worker only stops once the queue is drained AND no other worker is still listing
    // a directory (which could enqueue more children).
    const worker = async (): Promise<void> => {
      for (;;) {
        if (head >= queue.length) {
          if (active === 0) return
          await new Promise((r) => setTimeout(r, 0))
          continue
        }
        const entry = queue[head++]
        active++
        try {
          let ch = cache[entry.path]
          if (!ch) {
            try {
              ch = await window.api.files.listDir(entry.path)
            } catch {
              ch = []
            }
            cache[entry.path] = ch
          }
          for (const child of ch) enqueue(child)
        } finally {
          active--
        }
      }
    }
    await Promise.all(Array.from({ length: 16 }, () => worker()))
    setChildCache(cache)
    return out
  }

  const q = query.trim().toLowerCase()

  // Lazily build the full file list the first time a search is run (per tab/refresh).
  // NOTE: `scanning` must NOT be a dependency — setScanning(true) below would re-run the
  // effect, whose cleanup flips `alive` to false, so the in-flight scan's result would be
  // discarded and the spinner would hang forever. Re-run only when the query or the
  // (cached) scan result changes.
  useEffect(() => {
    if (!q || fullScan) return
    let alive = true
    setScanning(true)
    void scanAll()
      .then((all) => {
        if (alive) setFullScan(all)
      })
      .finally(() => {
        if (alive) setScanning(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fullScan])

  const matches = useMemo(() => {
    if (!q || !fullScan) return []
    return fullScan.filter((e) => !e.isDir && e.name.toLowerCase().includes(q)).slice(0, 500)
  }, [q, fullScan])

  // Folder portion of a match's path, relative to its root, shown under the name.
  const relDir = (p: string): string => {
    const root = rootPaths.find((rp) => p === rp || p.startsWith(rp + '/') || p.startsWith(rp + '\\'))
    const rel = root ? p.slice(root.length).replace(/^[/\\]+/, '') : p
    const i = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
    return i >= 0 ? rel.slice(0, i) : ''
  }

  // Keyboard navigation: ↑/↓ move the cursor, →/← expand/collapse (or step in/out),
  // Enter toggles a folder, X excludes/undoes the selected file. Selecting a file previews it.
  const onTreeKeyDown = (e: ReactKeyboardEvent): void => {
    // X toggles exclusion of the selected file — works in the tree and in search results
    // (which can have a selection even when the flat tree below is collapsed/empty).
    if ((e.key === 'x' || e.key === 'X') && selected && !selected.isDir) {
      e.preventDefault()
      toggleExcludeSelected(selected)
      return
    }
    if (!flat.length) return
    const idx = selected ? flat.findIndex((f) => f.entry.path === selected.path) : -1
    const cur = idx >= 0 ? flat[idx].entry : null
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(flat[Math.min(flat.length - 1, idx + 1)]?.entry ?? flat[0].entry)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(flat[Math.max(0, idx - 1)]?.entry ?? flat[0].entry)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (cur?.isDir) {
        if (!expanded.has(cur.path)) toggleDir(cur.path)
        else if (flat[idx + 1]) setSelected(flat[idx + 1].entry)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (cur?.isDir && expanded.has(cur.path)) toggleDir(cur.path)
      else if (idx > 0) {
        const parent = [...flat.slice(0, idx)].reverse().find((f) => f.depth === flat[idx].depth - 1)
        if (parent) setSelected(parent.entry)
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (cur?.isDir) toggleDir(cur.path)
    }
  }

  // Keep the keyboard cursor in view as it moves.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // Excluding/restoring changes which attachments are produced (and the review-index /
  // load-file attachment columns). We persist the change and queue it for review, but
  // don't re-render here — re-running is a long operation, so the user applies all
  // queued changes at once with the manual Re-run button. Toggling is blocked while a
  // run is in flight so changes can't pile onto a half-built output.
  //
  // Each change has a scope: 'file' targets the exact file (its name|size fingerprint),
  // 'name' targets every attachment of that filename across the whole set.

  // Set a file aside, content-based: this exact file AND every copy that looks the same
  // (perceptually, for images) or is byte-identical, across the whole set. The clicked
  // file's fingerprint is stored as the pointer; production.ts resolves it to content and
  // expands the match. Record where this file lives so the pending panel shows the source.
  const excludeAttachment = (name: string, fp: string, paths?: string[]): void => {
    if (busy) return
    const where = selected ? relDir(selected.path) : ''
    queueAttachmentOp({ kind: 'exclude', scope: 'file', file: name, paths: where ? [where] : paths })
    void setExcludedFingerprints(Array.from(new Set([...excludedFpList, fp])), where ? { fp, path: where } : undefined)
  }

  // Undo any exclusion of this file — clear it from both the name and fingerprint lists.
  const unexcludeAttachment = (name: string, fp: string, paths?: string[]): void => {
    if (busy) return
    queueAttachmentOp({ kind: 'include', file: name, paths })
    void (async () => {
      if (excludedSet.has(name.toLowerCase())) await setExcludedAttachments(excludedList.filter((n) => n.toLowerCase() !== name.toLowerCase()))
      if (excludedFpSet.has(fp)) await setExcludedFingerprints(excludedFpList.filter((k) => k !== fp))
    })()
  }

  // Keep just one file out of a by-name exclusion: pin this exact file (its fingerprint)
  // so it's produced while every other file of the same name stays excluded. A keep
  // override wins over the name rule (same precedence the production uses). Record the
  // file's folder so the pending panel shows which copy is being kept.
  const keepThisFile = (name: string, fp: string): void => {
    if (busy) return
    const where = selected ? relDir(selected.path) : ''
    queueAttachmentOp({ kind: 'include', scope: 'file', file: name, paths: where ? [where] : undefined })
    void setKeptAttachments(Array.from(new Set([...keptList, fp])), where ? { fp, path: where } : undefined)
  }

  // Pin a set-aside attachment back into the production. scope 'file' → keep this exact
  // file (fingerprint); 'name' → keep every attachment of this name.
  const restoreAttachment = (name: string, fp: string, scope: 'file' | 'name', paths?: string[]): void => {
    if (busy) return
    queueAttachmentOp({ kind: 'include', scope, file: name, paths })
    // A restored file is produced at its intended folder (restoreMap), not its Excluded/ spot.
    const where = scope === 'file' ? paths?.[0] ?? '' : ''
    if (scope === 'name') void setKeptNames(Array.from(new Set([...keptNamesList, name])))
    else void setKeptAttachments(Array.from(new Set([...keptList, fp])), where ? { fp, path: where } : undefined)
  }

  // Undo a restore — clear this file from both the keep-by-fingerprint and keep-by-name lists.
  const unrestoreAttachment = (name: string, fp: string, paths?: string[]): void => {
    if (busy) return
    queueAttachmentOp({ kind: 'exclude', file: name, paths })
    void (async () => {
      if (keptSet.has(fp)) await setKeptAttachments(keptList.filter((k) => k !== fp))
      if (keptNamesSet.has(name.toLowerCase())) await setKeptNames(keptNamesList.filter((n) => n.toLowerCase() !== name.toLowerCase()))
    })()
  }

  // True if a tree entry will be set aside. Matched by the explicit rules the user set
  // (name or exact file) OR by the content-based preview — so every copy of an excluded
  // image is crossed out, even under a different filename. A keep rule pins it back in.
  const isExcludedEntry = (entry: DirEntry): boolean => {
    const name = baseNameOf(entry, !!c.itemNumbering).toLowerCase()
    const fp = fingerprintOf(entry, !!c.itemNumbering)
    // A keep rule (direct, by-name, or by look-alike match) pins it back in.
    if (keptSet.has(fp) || keptNamesSet.has(name) || resolvedKeptFps.has(fp)) return false
    return excludedSet.has(name) || excludedFpSet.has(fp) || resolvedExcludedFps.has(fp)
  }

  // Toggle the exclusion of a file from the keyboard (the X hotkey), mirroring the primary
  // action of the preview pane's button for whatever state the file is in: a normal file
  // gets excluded ("exclude similar"); an excluded one is undone; a copy excluded only
  // because it matches another file's rule is kept; a file in the output's Excluded/ folder
  // is restored (or un-restored). No-op for folders or while a re-run is in flight.
  const toggleExcludeSelected = (entry: DirEntry): void => {
    if (busy || entry.isDir) return
    const base = baseNameOf(entry, !!c.itemNumbering)
    const fp = fingerprintOf(entry, !!c.itemNumbering)
    const nameLc = base.toLowerCase()
    const intendedDirs = restoreMap?.[entry.name]
    const inExcludedFolder =
      !!excludedDir && (entry.path === excludedDir || entry.path.startsWith(excludedDir + '/') || entry.path.startsWith(excludedDir + '\\'))
    const isRestoredDirect = keptSet.has(fp) || keptNamesSet.has(nameLc)
    const isRestored = isRestoredDirect || resolvedKeptFps.has(fp)
    if (inExcludedFolder) {
      // Only a file with its OWN keep rule can be un-restored; a look-alike match restores
      // when its twin does, so the X key sets a direct keep on it (toggles cleanly next press).
      if (isRestoredDirect) unrestoreAttachment(base, fp, intendedDirs)
      else restoreAttachment(base, fp, 'file', intendedDirs)
      return
    }
    if (isRestored) return unrestoreAttachment(base, fp, intendedDirs)
    if (excludedSet.has(nameLc) || excludedFpSet.has(fp)) return unexcludeAttachment(base, fp, intendedDirs)
    if (resolvedExcludedFps.has(fp)) return keepThisFile(base, fp) // matched by another file's rule
    excludeAttachment(base, fp, intendedDirs)
  }

  const onAddSources = async (): Promise<void> => {
    const added = await addSources()
    if (added > 0) {
      setTab('source')
      setPending('sources')
    }
  }

  const rerun = (): void => {
    setPending(null)
    void reindexCollection(c.id)
  }

  // Re-mounting the tree when switching tabs resets every node's expand/children state.
  const treeKey = `${tab}:${c.id}`

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tabs + pending-exclude banner */}
      <div className="px-5 pt-3 flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-700 overflow-hidden">
          <button
            onClick={() => {
              setTab('source')
              setSelected(null)
            }}
            className={`px-3 py-1.5 text-[12.5px] ${tab === 'source' ? 'bg-ink-800 text-slate-100' : 'text-ink-500 hover:text-slate-300'}`}
          >
            Source files
          </button>
          <button
            onClick={() => {
              if (!hasOutput) return
              setTab('output')
              setSelected(null)
            }}
            disabled={!hasOutput}
            title={hasOutput ? '' : 'No output bundle yet — process the set first.'}
            className={`px-3 py-1.5 text-[12.5px] border-l border-ink-700 ${
              tab === 'output' ? 'bg-ink-800 text-slate-100' : 'text-ink-500 hover:text-slate-300'
            } ${hasOutput ? '' : 'opacity-40 cursor-not-allowed'}`}
          >
            Produced output
          </button>
        </div>
        {excludedList.length + excludedFpList.length > 0 && (
          <span className="text-[11.5px] text-ink-600">
            {excludedList.length + excludedFpList.length} exclude rule{excludedList.length + excludedFpList.length === 1 ? '' : 's'}
          </span>
        )}
        <button
          onClick={() => void onAddSources()}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-ink-700 text-slate-300 hover:bg-ink-800"
          title="Add more folders or individual files to this set"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Add source files…
        </button>
      </div>

      {(srcCount || outCount) && (
        <div className="px-5 pt-1.5 flex items-center gap-2.5 text-[11.5px] text-ink-600">
          {srcCount && (
            <span className={tab === 'source' ? 'text-slate-400' : ''}>
              Source: <span className="text-slate-300 tabular-nums">{srcCount.files.toLocaleString()}</span> file
              {srcCount.files === 1 ? '' : 's'} · <span className="text-slate-300 tabular-nums">{srcCount.folders.toLocaleString()}</span> folder
              {srcCount.folders === 1 ? '' : 's'}
            </span>
          )}
          {srcCount && outCount && <span className="text-ink-700">·</span>}
          {outCount && (
            <span className={tab === 'output' ? 'text-slate-400' : ''}>
              Output: <span className="text-slate-300 tabular-nums">{outCount.files.toLocaleString()}</span> file
              {outCount.files === 1 ? '' : 's'} · <span className="text-slate-300 tabular-nums">{outCount.folders.toLocaleString()}</span> folder
              {outCount.folders === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {(pending || attachmentOps.length > 0) && (
        <div className="mx-5 mt-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 shrink-0 text-amber-300" />
            <span className="text-[12px] font-medium text-amber-200/90">
              {busy ? 'Applying rule changes…' : 'Pending rule changes — applied on next re-run'}
            </span>
            {attachmentOps.length > 0 && (
              <span className="text-[11px] text-amber-200/60">
                {attachmentOps.length} rule change{attachmentOps.length === 1 ? '' : 's'}
              </span>
            )}
            <button
              onClick={rerun}
              disabled={busy}
              className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-accent text-ink-950 font-medium hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Re-running…' : 'Re-run now'}
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-[12px]">
            {pending && (
              <li className="flex items-center gap-1.5 text-amber-200/80">
                <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                New source files added — will be indexed and produced.
              </li>
            )}
            {attachmentOps.map((op) => {
              // Phrase each queued change as the rule it sets for the next run.
              const verb =
                op.scope === 'name'
                  ? op.kind === 'exclude'
                    ? 'Exclude all named'
                    : 'Keep all named'
                  : op.scope === 'file'
                    ? op.kind === 'exclude'
                      ? 'Exclude similar to'
                      : 'Keep only'
                    : op.kind === 'include'
                      ? 'Include'
                      : 'Exclude'
              return (
                <li key={`${op.kind}:${op.scope ?? ''}:${op.file}`} className="flex items-baseline gap-1.5 min-w-0">
                  <span className={`shrink-0 font-medium ${op.kind === 'include' ? 'text-emerald-300' : 'text-amber-300'}`}>{verb}</span>
                  <span className="font-mono text-slate-200 truncate">{op.file}</span>
                  {op.paths && op.paths.length > 0 && (
                    <span className="shrink-0 text-ink-500">
                      {op.kind === 'include' ? '→' : 'from'} <span className="font-mono text-slate-400">{op.paths[0]}/</span>
                      {op.paths.length > 1 && <span className="text-ink-600"> +{op.paths.length - 1}</span>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* The exclude/keep rules (with their folder/path context) now live in the
          read-only "How this set is processed" panel, so the chip lists were removed. */}

      <div className="flex-1 min-h-0 mt-2 px-5 pb-5 grid grid-cols-[minmax(0,18rem)_1fr] gap-3">
        {/* Tree — capped height with its own scroll, so a deep set stays compact */}
        <div className="self-start max-h-[58vh] flex flex-col rounded-lg border border-ink-700/60 bg-ink-900/40 overflow-hidden">
          <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-ink-700/50">
            <Search className="w-3.5 h-3.5 text-ink-500 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search file names…"
              className="flex-1 min-w-0 bg-transparent text-[12.5px] text-slate-200 placeholder:text-ink-600 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} title="Clear search" className="shrink-0 text-ink-500 hover:text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-ink-700/50">
            <button
              onClick={expandAll}
              disabled={!!q}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-ink-500 hover:text-slate-200 hover:bg-ink-800 disabled:opacity-40 disabled:hover:bg-transparent"
              title="Expand all folders"
            >
              <ChevronsDownUp className="w-3.5 h-3.5 rotate-180" /> Expand all
            </button>
            <button
              onClick={collapseAll}
              disabled={!!q}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-ink-500 hover:text-slate-200 hover:bg-ink-800 disabled:opacity-40 disabled:hover:bg-transparent"
              title="Collapse all folders"
            >
              <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse all
            </button>
            <button
              onClick={refresh}
              className="ml-auto flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-ink-500 hover:text-slate-200 hover:bg-ink-800"
              title="Re-scan the folder for files added or deleted since you last looked"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDirs.size || scanning ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          <div
            ref={treeRef}
            tabIndex={0}
            onKeyDown={onTreeKeyDown}
            className="min-h-0 overflow-auto py-1.5 outline-none focus:ring-1 focus:ring-accent/30 rounded-b-lg"
          >
            {q ? (
              scanning && !fullScan ? (
                <div className="px-3 py-6 flex items-center justify-center gap-2 text-[12px] text-ink-600">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                </div>
              ) : matches.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-ink-600">No files match “{query.trim()}”.</div>
              ) : (
                <>
                  <div className="px-3 pb-1 text-[10.5px] uppercase tracking-wider text-ink-600">
                    {matches.length}{matches.length === 500 ? '+' : ''} match{matches.length === 1 ? '' : 'es'}
                  </div>
                  {matches.map((entry) => {
                    const isSel = selected?.path === entry.path
                    const dir = relDir(entry.path)
                    return (
                      <button
                        key={entry.path}
                        onClick={() => revealInTree(entry)}
                        className={`group w-full flex items-center gap-1.5 px-2 py-1 text-left rounded ${
                          isSel ? 'bg-accent/15 text-slate-100' : 'text-slate-300 hover:bg-ink-800/50'
                        }`}
                      >
                        {iconFor(entry)}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[12.5px] ${isExcludedEntry(entry) ? 'line-through text-ink-600' : ''}`}>
                            {entry.name}
                          </span>
                          {dir && <span className="block truncate text-[10.5px] text-ink-600">{dir}</span>}
                        </span>
                      </button>
                    )
                  })}
                </>
              )
            ) : flat.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-ink-600">Nothing to browse.</div>
            ) : (
              flat.map(({ entry, depth }) => {
                const isSel = selected?.path === entry.path
                return (
                  <Row
                    key={entry.path}
                    entry={entry}
                    depth={depth}
                    selected={isSel}
                    expanded={expanded.has(entry.path)}
                    loading={loadingDirs.has(entry.path)}
                    excluded={!entry.isDir && isExcludedEntry(entry)}
                    innerRef={isSel ? (el) => (selectedRowRef.current = el) : undefined}
                    onSelect={onRowSelect}
                    onToggle={onRowToggle}
                  />
                )
              })
            )}
          </div>
          <div className="shrink-0 border-t border-ink-700/50 px-2.5 py-1.5 text-[10.5px] text-ink-600 flex items-center gap-1.5">
            <kbd className="px-1 py-px rounded border border-ink-700 bg-ink-800 text-[10px] text-slate-300">X</kbd>
            <span>{selected && !selected.isDir ? 'exclude / undo selected file' : 'select a file, then X to exclude'}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="min-h-0 rounded-lg border border-ink-700/60 bg-ink-900/40 overflow-hidden">
          <Preview
            entry={selected}
            excludedNames={excludedSet}
            excludedFps={excludedFpSet}
            matchedFps={resolvedExcludedFps}
            matchedKeptFps={resolvedKeptFps}
            excludedDir={excludedDir}
            keptFps={keptSet}
            keptNames={keptNamesSet}
            intendedDirs={selected ? restoreMap?.[selected.name] : undefined}
            itemNumbering={!!c.itemNumbering}
            busy={busy}
            onExclude={excludeAttachment}
            onUnexclude={unexcludeAttachment}
            onKeepFile={keepThisFile}
            onRestore={restoreAttachment}
            onUnrestore={unrestoreAttachment}
          />
        </div>
      </div>
    </div>
  )
}
