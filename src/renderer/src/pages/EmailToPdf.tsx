import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { EmailToPdfProgress, EmailToPdfResult } from '@shared/types'
import { Mail, FolderOpen, FileType, Loader2, ArrowRight, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react'

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

/**
 * Human-facing batch tool: pick a folder of emails and a destination, and
 * convert every .eml (including in subfolders) to PDF, mirroring the structure.
 * Non-email files are skipped. Same engine as the convert_emails_to_pdf agent
 * tool — this just gives people a direct way to run it.
 */
export default function EmailToPdf(): JSX.Element {
  const { setToast } = useStore()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<EmailToPdfResult | null>(null)
  // Counsel-review production options.
  const [combine, setCombine] = useState(true)
  const [bates, setBates] = useState(true)
  const [batesPrefix, setBatesPrefix] = useState('DOC-')
  const [batesStart, setBatesStart] = useState('1')
  const [index, setIndex] = useState(true)
  const [loadFile, setLoadFile] = useState(false)
  const [progress, setProgress] = useState<EmailToPdfProgress | null>(null)
  const startRef = useRef(0)

  // Live progress events from the converter (per email).
  useEffect(() => window.api.emailToPdf.onProgress(setProgress), [])

  const pick = async (which: 'in' | 'out'): Promise<void> => {
    const dir = await window.api.emailToPdf.pickFolder()
    if (!dir) return
    if (which === 'in') setInput(dir)
    else setOutput(dir)
    setResult(null)
  }

  const convert = async (): Promise<void> => {
    if (!input || !output) return
    setRunning(true)
    setResult(null)
    setProgress(null)
    startRef.current = Date.now()
    try {
      const r = await window.api.emailToPdf.convert(input, output, {
        combineAttachments: combine,
        bates: bates ? { prefix: batesPrefix, start: Math.max(1, parseInt(batesStart, 10) || 1) } : null,
        index,
        loadFile
      })
      setResult(r)
      setToast(`Converted ${r.converted} email${r.converted === 1 ? '' : 's'} to PDF.`)
    } catch (e) {
      setToast(`Conversion failed: ${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-10 space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-semibold flex items-center gap-2">
            <Mail className="w-6 h-6 text-accent" /> Email → PDF
          </h1>
          <p className="text-[13px] text-ink-600 mt-2">
            Convert a folder of emails (.eml) to PDFs — subfolders included. The output mirrors the input structure;
            non-email files are skipped.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3.5 flex gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-slate-300 leading-relaxed">
            Runs entirely on this computer — nothing is uploaded.
          </div>
        </div>

        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6 space-y-4">
          <FolderRow label="Emails folder (input)" path={input} onPick={() => void pick('in')} />
          <div className="flex justify-center text-ink-600">
            <ArrowRight className="w-4 h-4 rotate-90" />
          </div>
          <FolderRow label="Output folder (PDFs)" path={output} onPick={() => void pick('out')} />

          {/* Counsel-review production options */}
          <div className="rounded-lg border border-ink-700 bg-ink-950/40 p-3.5 space-y-2.5">
            <div className="text-[11px] uppercase tracking-wider text-ink-600">For counsel review</div>
            <label className="flex items-start gap-2.5 text-[12.5px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>Combine each email + its attachments into one PDF <span className="text-ink-600">(native files still saved alongside)</span></span>
            </label>
            <label className="flex items-start gap-2.5 text-[12.5px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={bates} onChange={(e) => setBates(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>Bates-number every page</span>
            </label>
            {bates && (
              <div className="ml-7 flex items-center gap-2 text-[12px]">
                <span className="text-ink-600">Prefix</span>
                <input value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} className="w-24 bg-ink-950 border border-ink-700 rounded px-2 py-1 text-slate-200 outline-none focus:border-accent/60" />
                <span className="text-ink-600">Start at</span>
                <input value={batesStart} onChange={(e) => setBatesStart(e.target.value.replace(/[^0-9]/g, ''))} className="w-20 bg-ink-950 border border-ink-700 rounded px-2 py-1 text-slate-200 outline-none focus:border-accent/60" />
                <span className="text-ink-600">e.g. {batesPrefix}{String(Math.max(1, parseInt(batesStart, 10) || 1)).padStart(6, '0')}</span>
              </div>
            )}
            <label className="flex items-start gap-2.5 text-[12.5px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={index} onChange={(e) => setIndex(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>
                Internal review index (Excel) — Bates range, date, from, to, subject, attachments
                <span className="text-ink-600"> · for your own team</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-[12.5px] text-slate-300 cursor-pointer">
              <input type="checkbox" checked={loadFile} onChange={(e) => setLoadFile(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>
                External production load file (.DAT + .CSV) — for opposing counsel / review platforms
                <span className="text-ink-600"> · standard fields + family ranges (BegAttach/EndAttach)</span>
              </span>
            </label>
            {loadFile && !bates && (
              <div className="ml-7 -mt-1 text-[11.5px] text-amber-300/80">
                Turn on Bates numbering — a production load file needs Bates numbers in its BEGBATES/ENDBATES fields.
              </div>
            )}
          </div>

          <button
            onClick={() => void convert()}
            disabled={!input || !output || running}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-ink-950 hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-accent"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileType className="w-4 h-4" />}
            {running ? 'Converting…' : 'Convert emails to PDF'}
          </button>

          {running && progress && progress.total > 0 && (
            <div className="mt-3">
              <div className="flex justify-between items-center gap-3 text-[12px] text-ink-600 mb-1.5">
                <span className="truncate">
                  Converting {progress.done} of {progress.total}
                  {progress.file ? ` · ${progress.file}` : ''}
                </span>
                <span className="shrink-0">
                  {progress.done > 0
                    ? `~${fmtDuration(((Date.now() - startRef.current) / progress.done) * (progress.total - progress.done))} left`
                    : 'starting…'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {result && (
          <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
            <div className="flex items-center gap-2 text-slate-100 font-medium">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              {result.converted} email{result.converted === 1 ? '' : 's'} converted
            </div>
            <div className="mt-1.5 text-[12.5px] text-ink-600">
              {result.attachments} attachment{result.attachments === 1 ? '' : 's'} extracted
              {' · '}
              {result.skipped} non-email file{result.skipped === 1 ? '' : 's'} skipped
              {result.errors.length > 0 && ` · ${result.errors.length} failed`}
            </div>
            {result.batesRange && (
              <div className="mt-1 text-[12.5px] text-slate-300">
                Bates: <span className="font-mono">{result.batesRange.begin}</span> – <span className="font-mono">{result.batesRange.end}</span>
              </div>
            )}
            {result.indexPath && (
              <div className="mt-0.5 text-[12.5px] text-ink-600">Internal index: {result.indexPath.split('/').pop()}</div>
            )}
            {result.loadFilePath && (
              <div className="mt-0.5 text-[12.5px] text-ink-600">
                Production load file: {result.loadFilePath.split('/').pop()} + .csv
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3 text-[12px] text-amber-200/90">
                <div className="flex items-center gap-1.5 font-medium mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Could not convert
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.file.split('/').pop()} — {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.outputs.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wider text-ink-600 mb-1.5">Written</div>
                <ul className="text-[12px] text-slate-300 space-y-1 max-h-64 overflow-auto font-mono">
                  {result.outputs.map((o) => (
                    <li key={o} className="truncate" title={o}>
                      {output && o.startsWith(output) ? o.slice(output.length + 1) : o}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void window.api.files.reveal(result.outputs[0])}
                  className="mt-3 text-[12px] text-accent hover:underline"
                >
                  Reveal in Finder
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function FolderRow({ label, path, onPick }: { label: string; path: string; onPick: () => void }): JSX.Element {
  return (
    <div>
      <label className="block text-[12.5px] text-ink-600 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-[12.5px] text-slate-300 truncate">
          {path || 'No folder selected'}
        </code>
        <button
          onClick={onPick}
          className="px-3 py-2 rounded-lg text-sm border border-ink-700 text-slate-300 hover:bg-ink-800 flex items-center gap-1.5 shrink-0"
        >
          <FolderOpen className="w-4 h-4" /> Choose
        </button>
      </div>
    </div>
  )
}
