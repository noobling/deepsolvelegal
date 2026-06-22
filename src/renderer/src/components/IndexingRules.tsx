import { useState } from 'react'
import type { CollectionDetail } from '@shared/types'
import { useStore } from '../state/store'
import {
  Info,
  ChevronDown,
  ChevronRight,
  FileText,
  Paperclip,
  Scissors,
  Ban,
  Check,
  Hash,
  Sparkles,
  Download,
  Upload
} from 'lucide-react'

const fpName = (fp: string): string => fp.slice(0, fp.lastIndexOf('|')) || fp
const fpSize = (fp: string): number => Number(fp.slice(fp.lastIndexOf('|') + 1)) || 0
const sizeLabel = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`

/** One processing rule: an icon, the rule, and an optional qualifying clause. */
function Rule({ icon, children, note }: { icon: JSX.Element; children: React.ReactNode; note?: React.ReactNode }): JSX.Element {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-500">{icon}</span>
      <span className="min-w-0 text-slate-200">
        {children}
        {note && <span className="text-ink-500"> — {note}</span>}
      </span>
    </li>
  )
}

type AttRule = { kind: 'skip' | 'exclude' | 'keep'; text: React.ReactNode; note?: React.ReactNode }

/**
 * A read-only panel spelling out exactly how the open set is processed: which
 * documents get rendered, how attachments are handled, the automatic skip rules, the
 * user's own exclude/keep rules (one combined list), how Bates numbers are assigned,
 * and which deliverables come out. Reads straight from the saved options, so it always
 * matches the real behaviour.
 */
export default function IndexingRules({ c }: { c: CollectionDetail }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { exportRules, importRules } = useStore()
  const f = c.features

  // Export/import the whole rule set so the hand-curated exclude/keep lists can be
  // reused on another set. stopPropagation keeps the panel from toggling on click.
  const onExport = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    setBusy(true)
    try {
      await exportRules()
    } finally {
      setBusy(false)
    }
  }
  const onImport = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    setBusy(true)
    try {
      await importRules()
    } finally {
      setBusy(false)
    }
  }
  const emailToPdf = f?.emailToPdf ?? false
  const separate = !!c.separateAttachments
  const itemNumbering = !!c.itemNumbering
  const autoExclude = !!c.excludeSignatures
  const excludeNames = c.excludeAttachments ?? []
  const excludeFiles = c.excludeFingerprints ?? []
  const keptFps = c.keepAttachments ?? []
  const keptNames = c.keepNames ?? []
  const paths = c.attachmentPaths ?? {}
  const bates = c.bates
  // Size + (for a single-file rule) the folder it points at — same name+size can recur
  // across emails, so the path says which one.
  const fileNote = (fp: string): React.ReactNode => {
    const where = paths[fp]
    return (
      <>
        {sizeLabel(fpSize(fp))}
        {where && (
          <>
            {' '}in <span className="font-mono text-slate-400">{where}/</span>
          </>
        )}
      </>
    )
  }

  // One combined list of attachment rules, top to bottom in the order they apply:
  // automatic skips first, then the user's excludes (with any keep shown as an
  // exception to it), then standalone keeps.
  const attRules: AttRule[] = []
  if (autoExclude) {
    attRules.push({ kind: 'skip', text: 'Skip files under 3 KB', note: 'too small to be substantive' })
    attRules.push({ kind: 'skip', text: 'Skip images repeated across the set', note: 'letterhead / logos re-attached to many emails' })
  }
  const excludedNameSet = new Set(excludeNames.map((s) => s.toLowerCase()))
  for (const name of excludeNames) {
    const lower = name.toLowerCase()
    // A keep exception identifies WHICH copy survives the exclude. The folder it sits in
    // is what disambiguates it (the size is the same across copies and tells you nothing);
    // fall back to size only when no path was recorded for the rule.
    const exceptions: React.ReactNode[] = [
      ...(keptNames.some((k) => k.toLowerCase() === lower) ? ['every copy (kept by name)'] : []),
      ...keptFps
        .filter((fp) => fpName(fp).toLowerCase() === lower)
        .map((fp) => {
          const where = paths[fp]
          return where ? (
            <>
              the copy in <span className="font-mono text-slate-400">{where}/</span>
            </>
          ) : (
            `the ${sizeLabel(fpSize(fp))} copy`
          )
        })
    ]
    attRules.push({
      kind: 'exclude',
      text: (
        <>
          Exclude every file named <span className="font-mono text-amber-200/90">{name}</span>
        </>
      ),
      note: exceptions.length ? (
        <>
          except{' '}
          {exceptions.map((e, i) => (
            <span key={i}>
              {i > 0 ? ' and ' : ''}
              {e}
            </span>
          ))}
        </>
      ) : undefined
    })
  }
  for (const fp of excludeFiles) {
    attRules.push({
      kind: 'exclude',
      text: (
        <>
          Exclude this one file <span className="font-mono text-amber-200/90">{fpName(fp)}</span>
        </>
      ),
      note: fileNote(fp)
    })
  }
  // Keeps already named as an exception above aren't repeated.
  for (const k of keptNames) {
    if (!excludedNameSet.has(k.toLowerCase()))
      attRules.push({ kind: 'keep', text: <>Always keep every file named <span className="font-mono text-emerald-200/90">{k}</span></> })
  }
  for (const fp of keptFps) {
    if (!excludedNameSet.has(fpName(fp).toLowerCase()))
      attRules.push({ kind: 'keep', text: <>Always keep this one file <span className="font-mono text-emerald-200/90">{fpName(fp)}</span></>, note: fileNote(fp) })
  }

  const ruleIcon = (kind: AttRule['kind']): JSX.Element =>
    kind === 'keep' ? <Check className="w-3.5 h-3.5 text-emerald-400/80" /> : kind === 'skip' ? <Scissors className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5 text-amber-400/80" />

  return (
    <div className="mx-5 mt-3 rounded-lg border border-ink-700/60 bg-ink-900/40">
      <div className="w-full flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left min-w-0">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" />}
          <Info className="w-3.5 h-3.5 text-accent/80 shrink-0" />
          <span className="text-[12px] font-medium text-slate-200">How this set is processed</span>
          <span className="text-[11px] text-ink-600 truncate">— the rules applied on each run</span>
        </button>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            onClick={onImport}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-50"
            title="Replace this set's rules from a .dslrules.json file"
          >
            <Upload className="w-3 h-3" /> Import
          </button>
          <button
            onClick={onExport}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-50"
            title="Save this set's rules to a .dslrules.json file to reuse on another set"
          >
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
      </div>

      {open && (
        <ul className="px-3.5 pb-3 pt-0.5 space-y-2 text-[12px] leading-relaxed border-t border-ink-700/40">
          <Rule icon={<FileText className="w-3.5 h-3.5" />} note="a file that can't be rendered gets a Bates-numbered slip-sheet so the sequence stays intact">
            {emailToPdf ? 'Render every email and document to a PDF, in folder order' : 'Index files in place; copy natives through without PDF conversion'}
          </Rule>

          <Rule icon={<Paperclip className="w-3.5 h-3.5" />}>
            {separate
              ? 'Merge each email’s attachments onto the end of its PDF (one Bates range per family) and also save them as separate native files'
              : 'Merge each email’s attachments onto the end of its PDF — one document, one Bates range per family'}
          </Rule>
          {itemNumbering && (
            <Rule icon={<Paperclip className="w-3.5 h-3.5" />}>
              Prefix every document with a per-family item number (e.g. <span className="font-mono text-slate-400">0001 - …</span>)
            </Rule>
          )}

          {/* Combined attachment rules: automatic skips, then your excludes/keeps. */}
          <li className="pt-1 text-[10.5px] uppercase tracking-wider text-ink-600">Attachment rules</li>
          {attRules.length === 0 ? (
            <Rule icon={<Paperclip className="w-3.5 h-3.5" />}>Every attachment is produced — no skip, exclude or keep rules set.</Rule>
          ) : (
            attRules.map((r, i) => (
              <Rule key={i} icon={ruleIcon(r.kind)} note={r.note}>
                {r.text}
              </Rule>
            ))
          )}
          {attRules.some((r) => r.kind === 'keep') && (
            <li className="pl-6 text-[11px] text-ink-600">A “keep” rule always wins over a skip or exclude.</li>
          )}

          <Rule icon={<Hash className="w-3.5 h-3.5" />}>
            {bates
              ? `Bates: sequential, stamped on every page from ${bates.prefix}${String(bates.start).padStart(6, '0')} — each document follows the one before it`
              : 'No Bates numbering for this set'}
          </Rule>

          <Rule icon={<Sparkles className="w-3.5 h-3.5" />}>
            Produce:{' '}
            {[
              f?.reviewIndex && 'internal review index (Excel/Word)',
              f?.loadFile && 'external load file (.DAT + .CSV)',
              f?.highlights && 'reviewer-highlights table',
              f?.aiEnrich && 'AI summary / type / parties per document'
            ]
              .filter(Boolean)
              .join(', ') || 'index only — no production bundle'}
          </Rule>
        </ul>
      )}
    </div>
  )
}
