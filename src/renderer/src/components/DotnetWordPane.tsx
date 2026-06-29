import { useEffect, useRef, useState } from 'react'
import { DocumentEditorContainerComponent, Toolbar, Inject } from '@syncfusion/ej2-react-documenteditor'
import { registerLicense } from '@syncfusion/ej2-base'
import '../lib/syncfusion-styles'
import { FileText, Loader2, ServerCog, RotateCw } from 'lucide-react'

registerLicense(import.meta.env.VITE_SYNCFUSION_LICENSE ?? '')

// The local .NET sidecar (spike/DocEditorServer) converts a real tracked-changes
// .docx → SFDT with full Word fidelity (tables, styles, numbering) AND preserves
// the AI's <w:ins>/<w:del> redlines as native tracked-change revisions
// (verified: author "Quantum Law Group AI", accept/reject suggestions, no watermark).
const SERVICE = 'http://localhost:5111/api/documenteditor/'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function base64ToFile(b64: string): File {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new File([bytes], 'document.docx', { type: DOCX_MIME })
}

/**
 * Highest-fidelity redline document pane: renders the matter's tracked-changes
 * .docx via the .NET import service, so the AI's redlines appear as native Word
 * tracked changes on a faithful copy of the contract. Drops into the same
 * Workspace slot as SuperDocPane/SyncfusionPane, so the real chat (ActivityRail)
 * sits beside it unchanged and redlines flow in through `documentDocx`.
 *
 * Opt-in (Settings → Document editor → Word .NET): needs the local service
 * running. If it's unreachable the pane shows a retry card instead of breaking
 * the workspace; the user can switch back to SuperDoc/Syncfusion in Settings.
 */
export default function DotnetWordPane({
  documentDocx,
  running
}: {
  documentDocx: string
  running: boolean
}): JSX.Element {
  const ref = useRef<DocumentEditorContainerComponent>(null)
  // The docx we last started importing — dedupes the created+effect double-fire
  // and lets a newer redline supersede an in-flight import.
  const lastDocxRef = useRef<string>('')
  const [status, setStatus] = useState<'idle' | 'importing' | 'ready' | 'error'>('idle')
  const [err, setErr] = useState('')

  const importViaDotnet = async (b64: string): Promise<void> => {
    const editor = ref.current?.documentEditor
    if (!editor || !b64) return
    if (lastDocxRef.current === b64) return // already importing/imported this exact doc
    lastDocxRef.current = b64
    setStatus('importing')
    setErr('')
    try {
      const form = new FormData()
      form.append('files', base64ToFile(b64)) // field name must match the .NET endpoint
      const res = await fetch(SERVICE + 'Import', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`document service responded ${res.status}`)
      const sfdt = await res.text()
      if (lastDocxRef.current !== b64) return // a newer redline superseded this import
      editor.open(sfdt)
      editor.enableTrackChanges = true
      // Keep the chat (ActivityRail) the conversation surface — close Syncfusion's
      // own review/properties panes so they don't crowd it.
      setTimeout(() => editor.commentReviewPane?.showHidePane(false, 'Changes'), 0)
      setStatus('ready')
    } catch (e) {
      lastDocxRef.current = '' // allow Retry to re-attempt this same doc
      setErr(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  // Re-import whenever the AI edits the document (documentDocx changes).
  useEffect(() => {
    void importViaDotnet(documentDocx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentDocx])

  // No document yet (or still loading) — match SuperDoc/Syncfusion placeholders.
  if (!documentDocx) {
    return (
      <div className="h-full grid place-items-center text-ink-600 bg-paper">
        <div className="flex flex-col items-center gap-2">
          {running ? <Loader2 className="w-6 h-6 text-accent animate-spin" /> : <FileText className="w-7 h-7 opacity-40" />}
          <span className="text-sm">{running ? 'Reading the document…' : 'The document will appear here.'}</span>
        </div>
      </div>
    )
  }

  // The local service is down — degrade gracefully instead of a blank editor.
  if (status === 'error') {
    return (
      <div className="h-full grid place-items-center bg-paper px-8">
        <div className="max-w-md text-center flex flex-col items-center gap-3">
          <ServerCog className="w-8 h-8 text-amber-500" />
          <div className="text-ink-800 font-medium">Can’t reach the document service</div>
          <div className="text-[12.5px] text-ink-600 leading-relaxed">
            The Word (.NET) editor needs the local conversion service running ({err}). Start it, then retry — or switch
            to SuperDoc / Syncfusion in Settings.
          </div>
          <code className="text-[11.5px] bg-ink-100 text-ink-800 rounded px-2.5 py-1.5">
            dotnet run --project spike/DocEditorServer --urls http://localhost:5111
          </code>
          <button
            onClick={() => void importViaDotnet(documentDocx)}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] bg-accent text-ink-950 hover:bg-accent-soft"
          >
            <RotateCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-paper">
      <DocumentEditorContainerComponent
        ref={ref}
        height="100%"
        enableToolbar
        showPropertiesPane={false}
        // We import via our own fetch+open; an empty serviceUrl stops the
        // container from making its own (failing) spellcheck/paste calls.
        serviceUrl=""
        created={() => void importViaDotnet(documentDocx)}
      >
        <Inject services={[Toolbar]} />
      </DocumentEditorContainerComponent>
    </div>
  )
}
