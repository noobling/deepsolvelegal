import { useStore } from '../state/store'
import { ShieldAlert } from 'lucide-react'

export default function PermissionModal(): JSX.Element | null {
  const { pendingPermission, resolvePermission } = useStore()
  if (!pendingPermission) return null
  const { title, detail } = pendingPermission

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6">
      <div className="w-full max-w-md bg-ink-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-start gap-3 border-b border-ink-700/60">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-400 grid place-items-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-medium text-slate-100">Permission needed</h3>
            <p className="text-[13px] text-ink-600 mt-0.5">Quantum Law Group wants to: {title}</p>
          </div>
        </div>
        <pre className="px-6 py-4 text-[12.5px] text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {detail}
        </pre>
        <div className="px-6 py-4 border-t border-ink-700/60 flex items-center justify-end gap-2">
          <button
            onClick={() => resolvePermission('deny')}
            className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-ink-800"
          >
            Deny
          </button>
          <button
            onClick={() => resolvePermission('allow-always')}
            className="px-4 py-2 rounded-lg text-sm text-slate-300 border border-ink-700 hover:bg-ink-800"
          >
            Always allow
          </button>
          <button
            onClick={() => resolvePermission('allow')}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-ink-950 hover:bg-accent-soft"
          >
            Allow once
          </button>
        </div>
      </div>
    </div>
  )
}
