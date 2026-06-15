import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { workflowById } from '@shared/workflows'
import Deliverable from '../components/Deliverable'
import ActivityRail from '../components/ActivityRail'
import DataNotice from '../components/DataNotice'
import { ArrowLeft, FileDown, Loader2, FileText, FileSpreadsheet, FileType } from 'lucide-react'

export default function Workspace(): JSX.Element {
  const { messages, running, currentMatterId, matters, setRoute, setToast } = useStore()
  const [exporting, setExporting] = useState('')

  const matter = matters.find((m) => m.id === currentMatterId)
  const workflow = matter ? workflowById(matter.workflowId) : undefined

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]
    return undefined
  }, [messages])

  const doExport = async (format: 'docx' | 'pdf' | 'xlsx'): Promise<void> => {
    if (!currentMatterId || !lastAssistant) return
    setExporting(format)
    const res = await window.api.export({ matterId: currentMatterId, messageId: lastAssistant.id, format })
    setExporting('')
    setToast(res.ok ? `Exported to ${res.path}` : `Export failed: ${res.error}`)
  }

  const isTable = workflow?.outputType === 'table'

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <header className="h-14 shrink-0 border-b border-ink-700/60 bg-ink-900/60 flex items-center gap-3 px-5">
        <button onClick={() => setRoute('launchpad')} className="text-ink-600 hover:text-slate-200" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-slate-100 truncate">{matter?.title ?? 'Matter'}</div>
          <div className="text-[11px] text-ink-600">{workflow?.title}</div>
        </div>
        {running && (
          <span className="flex items-center gap-1.5 text-[12px] text-accent ml-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {workflow?.runningLabel ?? 'Working…'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ExportBtn label="Word" icon={<FileText className="w-4 h-4" />} busy={exporting === 'docx'} disabled={!lastAssistant?.text} onClick={() => void doExport('docx')} />
          <ExportBtn label="PDF" icon={<FileType className="w-4 h-4" />} busy={exporting === 'pdf'} disabled={!lastAssistant?.text} onClick={() => void doExport('pdf')} />
          {isTable && (
            <ExportBtn label="Excel" icon={<FileSpreadsheet className="w-4 h-4" />} busy={exporting === 'xlsx'} disabled={!lastAssistant?.text} onClick={() => void doExport('xlsx')} />
          )}
        </div>
      </header>

      <DataNotice compact />

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <Deliverable
            text={lastAssistant?.text ?? ''}
            running={running}
            emptyHint={workflow?.runningLabel ?? 'Working…'}
          />
        </div>
        <ActivityRail />
      </div>
    </div>
  )
}

function ExportBtn({
  label,
  icon,
  onClick,
  busy,
  disabled
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  busy: boolean
  disabled: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border border-ink-700 text-slate-300 hover:bg-ink-800 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      <FileDown className="w-3 h-3 -ml-0.5 opacity-60" />
      {label}
    </button>
  )
}
