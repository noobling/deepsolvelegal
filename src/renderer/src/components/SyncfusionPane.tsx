import { useEffect, useRef } from 'react'
import { DocumentEditorContainerComponent, Toolbar, Inject } from '@syncfusion/ej2-react-documenteditor'
import { registerLicense } from '@syncfusion/ej2-base'
import '../lib/syncfusion-styles'
import { markdownToSfdt } from '../lib/sfdt'
import { FileText, Loader2 } from 'lucide-react'

// Register the Syncfusion license from an env var (VITE_SYNCFUSION_LICENSE).
// Without it the editor shows a trial banner/nag but still works.
registerLicense(import.meta.env.VITE_SYNCFUSION_LICENSE ?? '')

/**
 * Word-grade document pane backed by Syncfusion's Document Editor. We convert
 * the matter's Markdown document (with <ins>/<del> redlines) to SFDT in the
 * renderer — no docx→SFDT server — so the AI's redlines show as native
 * tracked-change suggestions. Mirrors SuperDocPane's contract (same empty /
 * loading states) so the two editors are interchangeable.
 */
export default function SyncfusionPane({
  documentText,
  running
}: {
  documentText: string
  running: boolean
}): JSX.Element {
  const ref = useRef<DocumentEditorContainerComponent>(null)

  const open = (md: string): void => {
    const editor = ref.current?.documentEditor
    if (!editor || !md.trim()) return
    editor.open(markdownToSfdt(md))
    editor.enableTrackChanges = true // user edits are tracked too
    // Keep Syncfusion's own review pane closed: the chat (Activity rail) is the
    // conversation surface and redlines already show inline, so the pane would
    // just crowd the chat off-screen. Defer past open()'s async layout.
    setTimeout(() => editor.commentReviewPane?.showHidePane(false, 'Changes'), 0)
  }

  // Reload when the AI edits the document.
  useEffect(() => {
    open(documentText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentText])

  // Match SuperDocPane: show a placeholder until the document exists, so the
  // pane doesn't flash an empty editor (and trial nag) before content arrives.
  if (!documentText.trim()) {
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
    <div className="h-full bg-paper">
      <DocumentEditorContainerComponent
        ref={ref}
        height="100%"
        enableToolbar
        showPropertiesPane={false}
        serviceUrl=""
        created={() => open(documentText)}
      >
        <Inject services={[Toolbar]} />
      </DocumentEditorContainerComponent>
    </div>
  )
}
