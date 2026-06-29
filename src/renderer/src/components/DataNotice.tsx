import { useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { useStore } from '../state/store'

const DISMISS_KEY = 'dsl-datanotice-dismissed-v1'

/**
 * Visible data-handling banner so users see how data flows without digging into
 * Settings. Adapts to the active provider: "fully local" for Ollama, "sent to
 * Anthropic" for the cloud provider. `compact` = a slim always-on workspace line.
 */
export default function DataNotice({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const setRoute = useStore((s) => s.setRoute)
  const local = useStore((s) => s.settings?.provider) === 'ollama'
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-5 py-1.5 bg-ink-900/40 border-b border-ink-700/40 text-[11.5px] text-ink-600">
        <ShieldCheck className="w-3.5 h-3.5 text-accent/80 shrink-0" />
        <span>
          {local
            ? 'This workflow runs entirely on your computer via a local model — nothing is sent to any server.'
            : "This workflow sends the task's content to Anthropic over an encrypted connection to generate the result — not used to train models. Everything else stays on this computer."}
        </span>
        <button onClick={() => setRoute('settings')} className="ml-auto text-accent/90 hover:underline shrink-0">
          Privacy
        </button>
      </div>
    )
  }

  if (dismissed) return null
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-ink-700/70 bg-ink-900/60 px-4 py-3">
      <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-0.5" />
      <div className="flex-1 text-[12.5px] text-slate-300 leading-relaxed">
        {local ? (
          <>
            <span className="font-medium text-emerald-300">Fully local.</span> The model runs on this computer via Ollama —
            your matters, documents, the Library index, and every workflow are processed entirely on-device. Nothing is sent
            to any server.
          </>
        ) : (
          <>
            <span className="font-medium text-slate-100">Your data stays on this computer.</span> Matters, documents, and the
            Library index are stored locally — there is no Quantum Law Group server. Running a workflow sends only that task&apos;s
            content to Anthropic over an encrypted connection (not used to train models; Zero Data Retention available).
          </>
        )}
        <button onClick={() => setRoute('settings')} className="ml-1 text-accent hover:underline">
          Privacy details →
        </button>
      </div>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1')
          setDismissed(true)
        }}
        className="shrink-0 text-ink-600 hover:text-slate-200"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
