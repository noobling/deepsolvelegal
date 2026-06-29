import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { MODELS, localModelInfo } from '@shared/types'
import type { LlmProvider, LegalRiskLevel, LocalModelInfo } from '@shared/types'
import {
  KeyRound,
  Check,
  Loader2,
  FolderOpen,
  ShieldCheck,
  ExternalLink,
  HardDrive,
  Cloud,
  Lock,
  ArrowRight,
  Cpu,
  RefreshCw,
  Gauge,
  AlertTriangle,
  Scale,
  FileText,
  PenLine,
  ServerCog
} from 'lucide-react'

export default function Settings(): JSX.Element {
  const { settings, keyPresent, saveSettings, refreshKey, setToast } = useStore()
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [profile, setProfile] = useState(settings?.profile ?? '')
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  useEffect(() => {
    setProfile(settings?.profile ?? '')
  }, [settings?.profile])

  const provider = settings?.provider ?? 'anthropic'
  const baseUrl = settings?.ollamaBaseUrl

  const loadModels = async (): Promise<void> => {
    setLoadingModels(true)
    try {
      setModels(await window.api.ollama.models())
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (provider === 'ollama') void loadModels()
  }, [provider, baseUrl])

  if (!settings) return <div className="p-8 text-ink-600">Loading…</div>

  const setProvider = async (p: LlmProvider): Promise<void> => {
    await saveSettings({ provider: p })
    await refreshKey()
  }

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return
    setSavingKey(true)
    await window.api.key.set(keyInput.trim())
    await refreshKey()
    setKeyInput('')
    setSavingKey(false)
    setToast('API key saved securely.')
  }

  const clearKey = async (): Promise<void> => {
    await window.api.key.clear()
    await refreshKey()
    setToast('API key removed.')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    const res = await window.api.key.test()
    setTesting(false)
    setToast(res.ok ? `Connected — ${res.model} ready.` : `Connection failed: ${res.error}`)
  }

  const pickFolder = async (): Promise<void> => {
    const dir = await window.api.settings.pickMatterRoot()
    if (dir) await saveSettings({ matterRoot: dir })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-8">
        <h1 className="font-serif text-2xl font-semibold">Settings</h1>

        {/* Provider */}
        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
          <h2 className="font-medium mb-1">AI provider</h2>
          <p className="text-[12.5px] text-ink-600 mb-3">
            Choose where generation runs. Local keeps everything on this computer; cloud uses Anthropic for the best quality.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <ProviderCard
              active={provider === 'anthropic'}
              onClick={() => void setProvider('anthropic')}
              icon={<Cloud className="w-4 h-4" />}
              title="Anthropic (cloud)"
              sub="Best quality & tool use. Sends task content to Anthropic."
            />
            <ProviderCard
              active={provider === 'ollama'}
              onClick={() => void setProvider('ollama')}
              icon={<Cpu className="w-4 h-4" />}
              title="Local (Ollama)"
              sub="Fully offline — the model runs on this computer."
            />
          </div>
        </section>

        {/* Anthropic key */}
        {provider === 'anthropic' && (
          <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-accent" />
              <h2 className="font-medium">Anthropic API key</h2>
              {keyPresent && (
                <span className="ml-2 flex items-center gap-1 text-[12px] text-emerald-400">
                  <Check className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-ink-600 mb-3 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Stored encrypted on this PC with Windows DPAPI. Never leaves your machine except to call the API.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keyPresent ? 'Enter a new key to replace the saved one' : 'sk-ant-…'}
                className="flex-1 bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60"
              />
              <button
                onClick={() => void saveKey()}
                disabled={savingKey || !keyInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-ink-950 hover:bg-accent-soft disabled:opacity-40"
              >
                {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => void test()}
                disabled={!keyPresent || testing}
                className="text-[12.5px] text-slate-300 border border-ink-700 rounded-md px-3 py-1.5 hover:bg-ink-800 disabled:opacity-40 flex items-center gap-1.5"
              >
                {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Test connection
              </button>
              {keyPresent && (
                <button onClick={() => void clearKey()} className="text-[12.5px] text-red-400 hover:underline">
                  Remove key
                </button>
              )}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-ink-600 hover:text-accent flex items-center gap-1 ml-auto"
              >
                Get a key <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </section>
        )}

        {/* Ollama config */}
        {provider === 'ollama' && (
          <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-accent" />
              <h2 className="font-medium">Local model (Ollama)</h2>
            </div>
            <p className="text-[12.5px] text-ink-600 mb-3">
              Runs entirely on this computer. Install Ollama, then pull a tool-capable model (e.g.{' '}
              <code className="text-slate-300">ollama pull llama3.1</code>).
            </p>

            <label className="block text-[12.5px] text-ink-600">Server URL</label>
            <input
              defaultValue={settings.ollamaBaseUrl}
              onBlur={(e) => void saveSettings({ ollamaBaseUrl: e.target.value.trim() })}
              className="mt-1 w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60"
            />

            <label className="block mt-3 text-[12.5px] text-ink-600">Model</label>
            <div className="mt-1 flex gap-2">
              <select
                value={settings.ollamaModel}
                onChange={(e) => void saveSettings({ ollamaModel: e.target.value })}
                className="flex-1 bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60"
              >
                <option value="">{models.length ? 'Select a model…' : 'No models found'}</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadModels()}
                className="px-3 py-2 rounded-lg text-sm border border-ink-700 text-slate-300 hover:bg-ink-800 flex items-center gap-1.5"
              >
                {loadingModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            </div>

            {models.length === 0 && !loadingModels && (
              <p className="mt-2 text-[12px] text-amber-300/90">
                No models detected. Make sure Ollama is running, then pull one — e.g.{' '}
                <code className="text-slate-200">ollama pull llama3.1</code> — and click refresh.
              </p>
            )}

            {/* Capability + legal-risk guidance for the selected local model */}
            {settings.ollamaModel && <LocalModelGuidance model={settings.ollamaModel} />}

            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => void test()}
                disabled={testing}
                className="text-[12.5px] text-slate-300 border border-ink-700 rounded-md px-3 py-1.5 hover:bg-ink-800 disabled:opacity-40 flex items-center gap-1.5"
              >
                {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Test connection
              </button>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-ink-600 hover:text-accent flex items-center gap-1 ml-auto"
              >
                Install Ollama <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </section>
        )}

        {/* Privacy & data (provider-aware) */}
        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <h2 className="font-medium">Privacy &amp; data</h2>
          </div>
          <p className="text-[12.5px] text-ink-600 mb-4">Exactly where your information lives and what leaves this computer.</p>

          {provider === 'ollama' ? (
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/[0.08] p-4 flex gap-3">
              <HardDrive className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-slate-300 leading-relaxed">
                <span className="font-semibold text-emerald-300">Fully local.</span> The model runs on this computer via
                Ollama. Your matters, documents, the Library index, drafts, and every workflow are processed entirely
                on-device — <span className="text-slate-100">nothing is sent to any server</span>, including Anthropic.
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-ink-700 bg-ink-950/50 p-4">
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-3">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-300">
                      <HardDrive className="w-4 h-4" /> On your computer
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[12px] text-slate-300">
                      <li>Matters, documents &amp; drafts</li>
                      <li className="flex items-center gap-1.5 flex-wrap">
                        Document index &amp; search
                        <span className="text-[9.5px] font-bold tracking-wide text-emerald-300 bg-emerald-500/15 rounded px-1.5 py-0.5">
                          100% LOCAL
                        </span>
                      </li>
                      <li>Settings &amp; encrypted API key</li>
                    </ul>
                    <p className="mt-2 text-[11px] text-emerald-300/80">
                      Indexing and search run fully on-device — nothing is sent out.
                    </p>
                  </div>

                  <div className="flex flex-col items-center justify-center px-1 text-ink-600">
                    <span className="text-[9.5px] leading-tight text-center mb-1">
                      only when you
                      <br />
                      run a workflow
                    </span>
                    <ArrowRight className="w-5 h-5 text-accent" />
                    <span className="text-[9.5px] mt-1">result returns</span>
                  </div>

                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-300">
                      <Cloud className="w-4 h-4" /> Anthropic API
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[12px] text-slate-300">
                      <li>Drafting &amp; analysis of your task</li>
                      <li>Your prompt + the documents you attach</li>
                    </ul>
                    <p className="mt-2 text-[11px] text-amber-300/80">Sent over TLS · not used to train models.</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-accent/50 bg-accent/10 p-3.5 flex gap-3">
                <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <div className="text-[12.5px] text-slate-300 leading-relaxed">
                  <span className="font-semibold text-accent">Zero Data Retention available.</span> Anthropic can be configured
                  so your content is processed and then <span className="text-slate-100">not stored at all</span>, and API data
                  is never used to train their models. Enable ZDR on your Anthropic account for the strictest posture — or
                  switch to the Local provider above to keep everything on-device.
                  <a
                    href="https://www.anthropic.com/legal/commercial-terms"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline ml-1 inline-flex items-center gap-1"
                  >
                    terms &amp; DPA <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </>
          )}

          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-300">
              <Lock className="w-4 h-4 text-accent" /> Your controls
            </div>
            <ul className="text-[12px] text-slate-400 mt-1.5 space-y-1 leading-relaxed list-disc pl-4">
              <li>Quantum Law Group has no server of its own; no analytics or telemetry.</li>
              <li>File writes and shell commands always ask before running.</li>
              <li>The Library index is built locally — documents leave only if you enable “AI summaries” on a collection.</li>
              <li>Nothing is read or sent until you start a workflow.</li>
            </ul>
          </div>
        </section>

        {/* Anthropic model */}
        {provider === 'anthropic' && (
          <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
            <h2 className="font-medium mb-3">Model</h2>
            <div className="space-y-2">
              {MODELS.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                    settings.model === m.id ? 'border-accent/60 bg-accent/10' : 'border-ink-700 hover:bg-ink-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="model"
                    checked={settings.model === m.id}
                    onChange={() => void saveSettings({ model: m.id })}
                    className="accent-accent"
                  />
                  <span className="text-sm">{m.label}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Export folder */}
        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
          <h2 className="font-medium mb-1">Export folder</h2>
          <p className="text-[12.5px] text-ink-600 mb-3">Where exported Word, PDF, and Excel deliverables are saved.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-[12.5px] text-slate-300 truncate">
              {settings.matterRoot}
            </code>
            <button
              onClick={() => void pickFolder()}
              className="px-3 py-2 rounded-lg text-sm border border-ink-700 text-slate-300 hover:bg-ink-800 flex items-center gap-1.5"
            >
              <FolderOpen className="w-4 h-4" /> Change
            </button>
          </div>
        </section>

        {/* Document editor */}
        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
          <h2 className="font-medium mb-1">Document editor</h2>
          <p className="text-[12.5px] text-ink-600 mb-3">
            Which embedded editor renders redlined contracts. Both show the AI’s changes as tracked
            suggestions; you can also open any redline in Microsoft Word from the workspace.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <ProviderCard
              active={settings.documentEditor === 'superdoc'}
              onClick={() => void saveSettings({ documentEditor: 'superdoc' })}
              icon={<FileText className="w-4 h-4" />}
              title="SuperDoc"
              sub="Renders native Word docx with tracked changes. Best fidelity to the exported file."
            />
            <ProviderCard
              active={settings.documentEditor === 'syncfusion'}
              onClick={() => void saveSettings({ documentEditor: 'syncfusion' })}
              icon={<PenLine className="w-4 h-4" />}
              title="Syncfusion"
              sub="Word-grade ribbon, fully offline. Lower fidelity (no tables/styles); no server."
            />
            <ProviderCard
              active={settings.documentEditor === 'dotnet'}
              onClick={() => void saveSettings({ documentEditor: 'dotnet' })}
              icon={<ServerCog className="w-4 h-4" />}
              title="Word (.NET)"
              sub="Highest fidelity — full tables/styles via the local DocEditor service (must be running)."
            />
          </div>
        </section>

        {/* Practice profile */}
        <section className="bg-ink-900/60 border border-ink-700/60 rounded-xl p-6">
          <h2 className="font-medium mb-1">Practice profile</h2>
          <p className="text-[12.5px] text-ink-600 mb-3">
            House style, escalation rules, and preferences. Injected into every workflow so outputs match your playbook.
          </p>
          <textarea
            rows={7}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            onBlur={() => void saveSettings({ profile })}
            placeholder={'e.g. We are a Delaware C-corp. Escalate anything over $250k or with uncapped liability to the GC. Prefer mutual NDAs. House citation style: Bluebook.'}
            className="w-full bg-ink-950 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent/60 resize-none font-mono"
          />
          <p className="text-[11.5px] text-ink-600 mt-1.5">Saved automatically.</p>
        </section>
      </div>
    </div>
  )
}

const RISK_STYLES: Record<LegalRiskLevel, { label: string; cls: string }> = {
  elevated: { label: 'Elevated risk', cls: 'text-amber-300 bg-amber-500/15 border-amber-500/40' },
  high: { label: 'High risk', cls: 'text-orange-300 bg-orange-500/15 border-orange-500/40' },
  severe: { label: 'Severe risk', cls: 'text-red-300 bg-red-500/15 border-red-500/40' }
}

function PowerMeter({ power }: { power: number }): JSX.Element {
  return (
    <span className="flex items-center gap-1" title={`Capability ${power} / 5 (relative to other local models)`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-3.5 w-1.5 rounded-sm ${i <= power ? 'bg-accent' : 'bg-ink-700'}`}
        />
      ))}
    </span>
  )
}

/**
 * Shows the capability rating and legal-work risk for the selected local model,
 * plus the caution that applies to every on-device model. Unknown models fall
 * back to a generic "unrated" note rather than implying they are vetted.
 */
function LocalModelGuidance({ model }: { model: string }): JSX.Element {
  const info: LocalModelInfo | null = localModelInfo(model)
  const risk = RISK_STYLES[info?.risk ?? 'high']

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-xl border border-ink-700 bg-ink-950/50 p-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge className="w-4 h-4 text-accent" />
          <span className="text-[13px] font-medium text-slate-100">{info?.label ?? model}</span>
          <PowerMeter power={info?.power ?? 0} />
          {info && <span className="text-[11px] text-ink-600">{info.ram} in memory</span>}
          <span
            className={`ml-auto text-[10.5px] font-semibold tracking-wide border rounded-full px-2 py-0.5 ${risk.cls}`}
          >
            {risk.label}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-slate-300 leading-relaxed">
          {info?.note ??
            'Not a recognized model — capability and tool-calling reliability are unrated. Treat its output with extra caution and verify everything.'}
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] p-3.5 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div className="text-[12px] text-slate-300 leading-relaxed">
          <span className="font-semibold text-amber-300">Legal-work caution.</span> All local models are weaker than the
          cloud Claude models at clause-level reading, spotting subtle risk, and citing authority — and they hallucinate
          more. Use local models for privacy-sensitive triage and first drafts; for anything client-facing or
          high-stakes, verify against sources and have qualified counsel review. Smaller models (≤8B) are unreliable for
          tool-heavy workflows.
          <span className="inline-flex items-center gap-1 text-slate-400 mt-1">
            <Scale className="w-3.5 h-3.5" /> Output is not legal advice.
          </span>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({
  active,
  onClick,
  icon,
  title,
  sub
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  sub: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition ${
        active ? 'border-accent/60 bg-accent/10' : 'border-ink-700 hover:bg-ink-800'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
        <span className={active ? 'text-accent' : 'text-ink-600'}>{icon}</span>
        {title}
        {active && <Check className="w-3.5 h-3.5 text-accent ml-auto" />}
      </div>
      <p className="text-[11.5px] text-ink-600 mt-1 leading-snug">{sub}</p>
    </button>
  )
}
