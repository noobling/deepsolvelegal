import { useStore, providerReady } from '../state/store'
import { Scale, LayoutGrid, Library, Settings as SettingsIcon, FileText, KeyRound, Cpu, Loader2 } from 'lucide-react'

export default function Sidebar(): JSX.Element {
  const { route, setRoute, matters, openMatter, currentMatterId, settings, keyPresent, runningMatters } = useStore()
  const ready = providerReady(settings, keyPresent)
  const isLocal = settings?.provider === 'ollama'

  return (
    <aside className="w-64 shrink-0 bg-ink-900 border-r border-ink-700/60 flex flex-col">
      <div className="px-4 py-4 flex items-center gap-2 border-b border-ink-700/60">
        <div className="w-9 h-9 rounded-lg bg-accent/15 grid place-items-center">
          <Scale className="w-5 h-5 text-accent" />
        </div>
        <div>
          <div className="font-serif text-[15px] leading-tight font-semibold">DeepSolve</div>
          <div className="text-[11px] tracking-widest text-accent/80 uppercase">Legal</div>
        </div>
      </div>

      <nav className="px-3 py-3 space-y-1">
        <NavItem active={route === 'launchpad'} onClick={() => setRoute('launchpad')} icon={<LayoutGrid className="w-4 h-4" />}>
          Workflows
        </NavItem>
        <NavItem active={route === 'library' || route === 'collection'} onClick={() => setRoute('library')} icon={<Library className="w-4 h-4" />}>
          Library
        </NavItem>
        <NavItem active={route === 'settings'} onClick={() => setRoute('settings')} icon={<SettingsIcon className="w-4 h-4" />}>
          Settings
        </NavItem>
        <NavItem active={route === 'superdoc-spike'} onClick={() => setRoute('superdoc-spike')} icon={<FileText className="w-4 h-4" />}>
          SuperDoc spike
        </NavItem>
        <NavItem active={route === 'syncfusion-spike'} onClick={() => setRoute('syncfusion-spike')} icon={<FileText className="w-4 h-4" />}>
          Syncfusion spike
        </NavItem>
        <NavItem active={route === 'dotnet-word-spike'} onClick={() => setRoute('dotnet-word-spike')} icon={<FileText className="w-4 h-4" />}>
          Word + .NET spike
        </NavItem>
      </nav>

      <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-ink-600">Recent matters</div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {matters.length === 0 && (
          <div className="px-2 py-2 text-xs text-ink-600">No matters yet. Pick a workflow to start.</div>
        )}
        {matters.map((m) => (
          <button
            key={m.id}
            onClick={() => void openMatter(m.id)}
            className={`w-full text-left px-2.5 py-2 rounded-md flex gap-2 items-start hover:bg-ink-800 transition ${
              currentMatterId === m.id ? 'bg-ink-800' : ''
            }`}
          >
            {runningMatters.includes(m.id) ? (
              <Loader2 className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5 mt-0.5 text-ink-600 shrink-0" />
            )}
            <span className="text-[12.5px] leading-snug text-slate-300 line-clamp-2">{m.title}</span>
          </button>
        ))}
      </div>

      {!ready && (
        <button
          onClick={() => setRoute('settings')}
          className="m-3 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2 hover:bg-amber-500/20"
        >
          {isLocal ? (
            <>
              <Cpu className="w-3.5 h-3.5" /> Select a local model to begin
            </>
          ) : (
            <>
              <KeyRound className="w-3.5 h-3.5" /> Add your API key to begin
            </>
          )}
        </button>
      )}
    </aside>
  )
}

function NavItem({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition ${
        active ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:bg-ink-800'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
