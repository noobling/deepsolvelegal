import { useEffect, useState } from 'react'
import { SuperDocEditor } from '@superdoc-dev/react'
import { superdocFonts } from '@superdoc-dev/fonts'
import '@superdoc-dev/react/style.css'

/**
 * SPIKE: proof-of-concept embedding the SuperDoc .docx editor in the Electron
 * renderer. Loads a sample contract so we can verify it renders, edits with
 * tracked changes, and exports — before committing to the integration.
 *
 * Telemetry is disabled (privacy), and the bundled web-fonts are skipped (they
 * failed to decode in this setup; system fonts render fine).
 */
export default function SuperDocSpike(): JSX.Element {
  const [status, setStatus] = useState('loading sample.docx…')
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    void fetch('/sample.docx')
      .then((r) => r.blob())
      .then((b) => setFile(new File([b], 'sample.docx', { type: b.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })))
      .catch((e) => setStatus('fetch failed: ' + String(e)))
  }, [])

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-paper">
      <div className="h-10 shrink-0 border-b border-black/10 flex items-center px-4 text-[12px] text-ink-700 gap-3">
        <span className="font-medium">SuperDoc spike</span>
        <span className="text-ink-500">status: {status}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {file && (
          <SuperDocEditor
            document={file}
            documentMode="editing"
            fonts={superdocFonts}
            telemetry={{ enabled: false }}
            onReady={() => setStatus('ready ✓ — try typing & the review (track-changes) toggle, top-right')}
            onException={(e) => setStatus('exception: ' + JSON.stringify(e).slice(0, 140))}
            onContentError={() => setStatus('content parse error')}
          />
        )}
      </div>
    </div>
  )
}
