import { useRef, useState } from 'react'
import { DocumentEditorContainerComponent, Toolbar, Inject } from '@syncfusion/ej2-react-documenteditor'
import { registerLicense } from '@syncfusion/ej2-base'
import '../lib/syncfusion-styles'
import { Loader2, Send, ServerCog } from 'lucide-react'

registerLicense(import.meta.env.VITE_SYNCFUSION_LICENSE ?? '')

// The .NET sidecar (spike/DocEditorServer) — converts a real .docx to SFDT with
// full Word fidelity (tables, styles, numbering) that markdown→SFDT can't do.
const SERVICE = 'http://localhost:5111/api/documenteditor/'
const SAMPLE = '/msa-fidelity.docx' // bundled fidelity-rich doc (table + styles)

interface ChatLine {
  role: 'you' | 'system'
  text: string
}

/**
 * Spike: Syncfusion Word editor backed by the .NET import service, beside a
 * lightweight chat redline harness. Proves (1) a real .docx imports with full
 * fidelity via the sidecar and (2) a chat instruction applies as a native
 * tracked change on that high-fidelity document — no markdown round-trip.
 */
export default function DotnetWordSpike(): JSX.Element {
  const ref = useRef<DocumentEditorContainerComponent>(null)
  const [status, setStatus] = useState<'idle' | 'importing' | 'ready' | 'error'>('idle')
  const [err, setErr] = useState('')
  const [input, setInput] = useState('unlimited for any breach => capped at the fees paid in the prior 12 months')
  const [log, setLog] = useState<ChatLine[]>([
    {
      role: 'system',
      text: 'Imported via the .NET service. Type a redline as "old text => new text" — it applies as a tracked change on the full-fidelity document. Try the table: $300/hr => $275/hr.'
    }
  ])

  // Pull the bundled .docx, hand it to the .NET service, render the returned SFDT.
  const importViaDotnet = async (): Promise<void> => {
    const editor = ref.current?.documentEditor
    if (!editor) return
    setStatus('importing')
    setErr('')
    try {
      const fileRes = await fetch(SAMPLE)
      const blob = await fileRes.blob()
      const form = new FormData()
      form.append('files', new File([blob], 'msa-fidelity.docx'))
      const res = await fetch(SERVICE + 'Import', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`service ${res.status}`)
      const sfdt = await res.text()
      editor.open(sfdt)
      editor.enableTrackChanges = true
      setTimeout(() => editor.commentReviewPane?.showHidePane(false, 'Changes'), 0)
      setStatus('ready')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  // Apply a redline as a tracked change via the editor's search/replace API.
  const applyRedline = (): void => {
    const editor = ref.current?.documentEditor
    if (!editor) return
    const m = input.split(/=>|->/)
    if (m.length !== 2) {
      setLog((l) => [...l, { role: 'system', text: 'Use the form: old text => new text' }])
      return
    }
    const find = m[0].trim()
    const replace = m[1].trim()
    setLog((l) => [...l, { role: 'you', text: input }])

    editor.enableTrackChanges = true
    editor.search.findAll(find)
    if (editor.search.searchResults.length === 0) {
      setLog((l) => [...l, { role: 'system', text: `Couldn't find "${find}" in the document.` }])
      return
    }
    editor.search.searchResults.replace(replace)
    setLog((l) => [
      ...l,
      { role: 'system', text: `Redlined: "${find}" → "${replace}" (tracked change applied).` }
    ])
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-paper">
      <div className="h-10 shrink-0 border-b border-black/10 flex items-center px-4 text-[12px] text-ink-700 gap-3">
        <ServerCog className="w-4 h-4 text-accent" />
        <span className="font-medium">Word + .NET spike</span>
        <span className="text-ink-600">service: {SERVICE}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {status === 'importing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {status === 'ready' && <span className="text-emerald-600">imported (full fidelity)</span>}
          {status === 'error' && <span className="text-red-600">error: {err}</span>}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Editor */}
        <div className="flex-1 min-w-0">
          <DocumentEditorContainerComponent
            ref={ref}
            height="100%"
            enableToolbar
            showPropertiesPane={false}
            serviceUrl={SERVICE}
            created={() => void importViaDotnet()}
          >
            <Inject services={[Toolbar]} />
          </DocumentEditorContainerComponent>
        </div>

        {/* Lightweight chat redline harness */}
        <div className="w-80 shrink-0 border-l border-black/10 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-black/10 text-[12px] font-medium text-ink-800">
            Redline chat
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {log.map((line, i) => (
              <div
                key={i}
                className={
                  line.role === 'you'
                    ? 'text-[12.5px] text-ink-900 bg-accent/10 rounded-lg px-3 py-2'
                    : 'text-[12px] text-ink-600 leading-relaxed'
                }
              >
                {line.text}
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-black/10">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    applyRedline()
                  }
                }}
                placeholder="old text => new text"
                className="flex-1 resize-none text-[12.5px] bg-ink-50 border border-black/10 rounded-lg px-3 py-2 outline-none focus:border-accent/60 text-ink-900"
              />
              <button
                onClick={applyRedline}
                disabled={status !== 'ready'}
                className="h-9 w-9 grid place-items-center rounded-lg bg-accent text-ink-950 disabled:opacity-40"
                title="Apply redline as a tracked change"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
