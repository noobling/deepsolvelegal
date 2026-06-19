import { useState } from 'react'
import { useStore } from '../state/store'
import type { EmailToPdfResult } from '@shared/types'
import { Mail, FolderOpen, FileType, Loader2, ArrowRight, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react'

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
    try {
      const r = await window.api.emailToPdf.convert(input, output)
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

          <button
            onClick={() => void convert()}
            disabled={!input || !output || running}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-ink-950 hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-accent"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileType className="w-4 h-4" />}
            {running ? 'Converting…' : 'Convert emails to PDF'}
          </button>
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
