import { useMemo } from 'react'
import { SuperDocEditor } from '@superdoc-dev/react'
import { superdocFonts } from '@superdoc-dev/fonts'
import '@superdoc-dev/react/style.css'
import { FileText, Loader2 } from 'lucide-react'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function base64ToFile(b64: string): File {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new File([bytes], 'document.docx', { type: DOCX_MIME })
}

/**
 * The document pane for redline workflows: a real Word editor (SuperDoc) showing
 * the contract with the AI's redlines as native tracked changes. The docx is
 * re-rendered from the matter's document whenever the AI edits it; we remount on
 * change (keyed by the base64) so the new suggestions load.
 */
export default function SuperDocPane({ docxBase64, running }: { docxBase64: string; running: boolean }): JSX.Element {
  const file = useMemo(() => (docxBase64 ? base64ToFile(docxBase64) : null), [docxBase64])

  if (!file) {
    return (
      <div className="h-full grid place-items-center text-ink-600 bg-paper">
        <div className="flex flex-col items-center gap-2">
          {running ? <Loader2 className="w-6 h-6 text-accent animate-spin" /> : <FileText className="w-7 h-7 opacity-40" />}
          <span className="text-sm">{running ? 'Reading the document…' : 'The document will appear here.'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-paper">
      <SuperDocEditor
        key={docxBase64.length + ':' + docxBase64.slice(-24)}
        document={file}
        documentMode="suggesting"
        fonts={superdocFonts}
        telemetry={{ enabled: false }}
      />
    </div>
  )
}
