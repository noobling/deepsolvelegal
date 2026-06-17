import { useEffect } from 'react'
import { useStore } from './state/store'
import Sidebar from './components/Sidebar'
import Launchpad from './pages/Launchpad'
import Workspace from './pages/Workspace'
import Settings from './pages/Settings'
import Library from './pages/Library'
import Collection from './pages/Collection'
import Highlights from './pages/Highlights'
import SuperDocSpike from './pages/SuperDocSpike'
import SyncfusionSpike from './pages/SyncfusionSpike'
import DotnetWordSpike from './pages/DotnetWordSpike'
import IntakePanel from './components/IntakePanel'
import PermissionModal from './components/PermissionModal'
import Toast from './components/Toast'

export default function App(): JSX.Element {
  const { ready, route, init, intakeWorkflowId } = useStore()

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) {
    return (
      <div className="h-full grid place-items-center text-ink-600">
        <div className="text-sm tracking-wide">Loading DeepSolve Legal…</div>
      </div>
    )
  }

  return (
    <div className="h-full flex bg-ink-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {route === 'launchpad' && <Launchpad />}
        {route === 'workspace' && <Workspace />}
        {route === 'settings' && <Settings />}
        {route === 'library' && <Library />}
        {route === 'collection' && <Collection />}
        {route === 'highlights' && <Highlights />}
        {route === 'superdoc-spike' && <SuperDocSpike />}
        {route === 'syncfusion-spike' && <SyncfusionSpike />}
        {route === 'dotnet-word-spike' && <DotnetWordSpike />}
      </main>
      {intakeWorkflowId && <IntakePanel workflowId={intakeWorkflowId} />}
      <PermissionModal />
      <Toast />
    </div>
  )
}
