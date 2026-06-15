import { useState } from 'react'
import { workflowById } from '@shared/workflows'
import { useStore, providerReady } from '../state/store'
import Icon from './Icon'
import { X, Paperclip, FileText, Play } from 'lucide-react'

export default function IntakePanel({ workflowId }: { workflowId: string }): JSX.Element | null {
  const { closeIntake, startWorkflow, settings, keyPresent, setRoute } = useStore()
  const workflow = workflowById(workflowId)
  const ready = providerReady(settings, keyPresent)
  const isLocal = settings?.provider === 'ollama'
  const [values, setValues] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<string[]>([])
  const [error, setError] = useState('')

  if (!workflow) return null

  const set = (k: string, v: string): void => setValues((prev) => ({ ...prev, [k]: v }))

  const addFiles = async (): Promise<void> => {
    const picked = await window.api.files.pick()
    if (picked.length) setFiles((f) => Array.from(new Set([...f, ...picked])))
  }

  const submit = async (): Promise<void> => {
    if (!ready) {
      setError(
        isLocal
          ? 'Select a local model in Settings first.'
          : 'Add your Anthropic API key in Settings first.'
      )
      return
    }
    for (const f of workflow.intakeFields) {
      if (f.required) {
        if (f.type === 'files' && files.length === 0) {
          setError(`${f.label} is required.`)
          return
        }
        if (f.type !== 'files' && !values[f.key]?.trim()) {
          setError(`${f.label} is required.`)
          return
        }
      }
    }
    await startWorkflow(workflow.id, values, files)
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-6" onClick={closeIntake}>
      <div
        className="w-full max-w-2xl bg-ink-900 border border-ink-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 py-5 border-b border-ink-700/60">
          <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
            <Icon name={workflow.icon} className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-xl font-semibold">{workflow.title}</h2>
            <p className="text-[13px] text-ink-600 mt-0.5">{workflow.description}</p>
          </div>
          <button onClick={closeIntake} className="text-ink-600 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {workflow.intakeFields.map((field) => (
            <div key={field.key}>
              <label className="block text-[13px] font-medium text-slate-300 mb-1.5">
                {field.label}
                {field.required && <span className="text-accent ml-1">*</span>}
              </label>

              {field.type === 'files' ? (
                <div>
                  <button
                    onClick={() => void addFiles()}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-ink-600 text-sm text-slate-300 hover:border-accent/60 hover:text-accent transition w-full justify-center"
                  >
                    <Paperclip className="w-4 h-4" /> Attach documents
                  </button>
                  {files.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {files.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-[12.5px] text-slate-400">
                          <FileText className="w-3.5 h-3.5 text-accent/70" />
                          <span className="truncate">{f.split(/[\\/]/).pop()}</span>
                          <button
                            className="ml-auto text-ink-600 hover:text-red-400"
                            onClick={() => setFiles((arr) => arr.filter((x) => x !== f))}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={4}
                  value={values[field.key] ?? ''}
                  onChange={(e) => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60 resize-none"
                />
              ) : field.type === 'select' ? (
                <select
                  value={values[field.key] ?? ''}
                  onChange={(e) => set(field.key, e.target.value)}
                  className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60"
                >
                  <option value="">Select…</option>
                  {field.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={(e) => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60"
                />
              )}
              {field.help && <p className="text-[11.5px] text-ink-600 mt-1">{field.help}</p>}
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-ink-700/60 flex items-center gap-3">
          {error && <span className="text-[12.5px] text-red-400 flex-1">{error}</span>}
          {!error && !ready && (
            <button onClick={() => setRoute('settings')} className="text-[12.5px] text-amber-300 flex-1 text-left">
              {isLocal ? 'No local model selected — open Settings →' : 'No API key yet — open Settings →'}
            </button>
          )}
          {!error && ready && <div className="flex-1" />}
          <button onClick={closeIntake} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-ink-800">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-ink-950 hover:bg-accent-soft flex items-center gap-2"
          >
            <Play className="w-4 h-4" /> Start
          </button>
        </div>
      </div>
    </div>
  )
}
