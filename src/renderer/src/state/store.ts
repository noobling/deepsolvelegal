import { create } from 'zustand'
import type {
  AgentEvent,
  Collection,
  CollectionDetail,
  CreateCollectionInput,
  IndexEvent,
  LibrarySearchHit,
  Matter,
  Settings,
  ThreadMessage,
  ToolActivity
} from '@shared/types'

export type Route = 'launchpad' | 'workspace' | 'settings' | 'library' | 'collection' | 'superdoc-spike'

/**
 * Live IPC subscriptions. Held at module scope so `init()` is idempotent:
 * React StrictMode (and any double-mount) invokes the init effect twice, and
 * without this guard each call would register another `agent:event`/`index:event`
 * listener — causing every streamed delta and activity to be applied twice
 * (e.g. "TheThe organization organization").
 */
let unsubscribers: Array<() => void> = []

/**
 * Whether the active provider is ready to run a workflow. For Anthropic that
 * means an API key is saved (`keyPresent`); for the local provider it means a
 * model has been selected (there is no key to set).
 */
export function providerReady(settings: Settings | null, keyPresent: boolean): boolean {
  if (!settings) return false
  return settings.provider === 'ollama' ? !!settings.ollamaModel : keyPresent
}

/**
 * Split the thread into the document (the work product shown in the main pane)
 * and the chat conversation (the side panel).
 *
 * When `documentOverride` is set (redline workflows), the document is the
 * uploaded contract — edited in place by apply_redline — and every message,
 * including the review, belongs to the chat. Otherwise the first assistant turn
 * IS the deliverable shown in the pane, and the rest is chat.
 */
export function deriveDocAndChat(
  messages: ThreadMessage[],
  documentOverride = ''
): {
  documentText: string
  documentId: string | null
  chat: ThreadMessage[]
} {
  const firstAssistantIdx = messages.findIndex((m) => m.role === 'assistant')
  const firstAssistant = firstAssistantIdx >= 0 ? messages[firstAssistantIdx] : null
  if (documentOverride) {
    return { documentText: documentOverride, documentId: firstAssistant?.id ?? null, chat: messages }
  }
  return {
    documentText: firstAssistant?.text ?? '',
    documentId: firstAssistant?.id ?? null,
    chat: messages.filter((_, i) => i !== firstAssistantIdx)
  }
}

interface IndexProgress {
  phase: string
  done: number
  total: number
}

interface PendingPermission {
  requestId: string
  tool: string
  title: string
  detail: string
}

interface AppState {
  route: Route
  ready: boolean
  settings: Settings | null
  keyPresent: boolean
  matters: Matter[]

  intakeWorkflowId: string | null

  currentMatterId: string | null
  currentTitle: string
  messages: ThreadMessage[]
  /** The stored/edited document for the open matter (empty until the first turn). */
  documentText: string
  /** Base64 .docx of the document with tracked changes, for the SuperDoc editor. */
  documentDocx: string
  activities: ToolActivity[]
  running: boolean
  /** Matter ids with an in-flight agent run (tracked across navigation). */
  runningMatters: string[]
  pendingPermission: PendingPermission | null
  toast: string | null

  // Library / document index
  collections: Collection[]
  currentCollectionId: string | null
  collectionDetail: CollectionDetail | null
  indexProgress: Record<string, IndexProgress>
  searchHits: LibrarySearchHit[] | null

  init: () => Promise<void>
  setRoute: (r: Route) => void
  refreshSettings: () => Promise<void>
  refreshMatters: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  refreshKey: () => Promise<void>

  refreshCollections: () => Promise<void>
  createCollection: (input: CreateCollectionInput) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  reindexCollection: (id: string) => Promise<void>
  openCollection: (id: string) => Promise<void>
  searchCollection: (query: string) => Promise<void>
  clearSearch: () => void
  exportIndex: (format: 'xlsx' | 'docx') => Promise<void>
  handleIndexEvent: (e: IndexEvent) => void

  openIntake: (workflowId: string) => void
  closeIntake: () => void
  startWorkflow: (workflowId: string, intake: Record<string, unknown>, files: string[]) => Promise<void>
  openMatter: (id: string) => Promise<void>
  deleteMatter: (id: string) => Promise<void>
  sendFollow: (text: string) => Promise<void>
  cancelRun: () => Promise<void>
  resolvePermission: (decision: 'allow' | 'allow-always' | 'deny') => void
  setToast: (msg: string | null) => void
  handleEvent: (e: AgentEvent) => void
}

export const useStore = create<AppState>((set, get) => ({
  route: 'launchpad',
  ready: false,
  settings: null,
  keyPresent: false,
  matters: [],
  intakeWorkflowId: null,
  currentMatterId: null,
  currentTitle: '',
  messages: [],
  documentText: '',
  documentDocx: '',
  activities: [],
  running: false,
  runningMatters: [],
  pendingPermission: null,
  toast: null,

  collections: [],
  currentCollectionId: null,
  collectionDetail: null,
  indexProgress: {},
  searchHits: null,

  async init() {
    // Tear down any prior subscriptions so a repeated init() (StrictMode
    // double-mount) never leaves two listeners feeding the same handler.
    for (const off of unsubscribers) off()
    unsubscribers = [
      window.api.agent.onEvent((e) => get().handleEvent(e)),
      window.api.library.onEvent((e) => get().handleIndexEvent(e))
    ]
    const [settings, key, matters, collections] = await Promise.all([
      window.api.settings.get(),
      window.api.key.status(),
      window.api.matters.list(),
      window.api.library.list()
    ])
    set({ settings, keyPresent: key.present, matters, collections, ready: true })
  },

  setRoute: (route) => set({ route }),

  async refreshSettings() {
    set({ settings: await window.api.settings.get() })
  },
  async refreshMatters() {
    set({ matters: await window.api.matters.list() })
  },
  async saveSettings(patch) {
    const settings = await window.api.settings.set(patch)
    set({ settings })
  },
  async refreshKey() {
    const key = await window.api.key.status()
    set({ keyPresent: key.present })
  },

  openIntake: (workflowId) => set({ intakeWorkflowId: workflowId }),
  closeIntake: () => set({ intakeWorkflowId: null }),

  async startWorkflow(workflowId, intake, files) {
    const { matterId } = await window.api.agent.start({ workflowId, intake, files })
    set({
      intakeWorkflowId: null,
      currentMatterId: matterId,
      messages: [],
      documentText: '',
      documentDocx: '',
      activities: [],
      running: true,
      runningMatters: [...get().runningMatters, matterId],
      route: 'workspace'
    })
    void get().refreshMatters()
  },

  async openMatter(id) {
    // Returning to the matter already open preserves the live in-memory
    // session (streaming text, activities) instead of reloading stale disk state.
    if (id === get().currentMatterId) {
      set({ route: 'workspace' })
      return
    }
    const detail = await window.api.matters.get(id)
    if (!detail) return
    set({
      currentMatterId: id,
      currentTitle: detail.title,
      messages: detail.messages,
      documentText: detail.document ?? '',
      documentDocx: '',
      activities: detail.activities,
      running: get().runningMatters.includes(id),
      route: 'workspace'
    })
    // Render the stored document as a tracked-changes .docx for the SuperDoc pane.
    if (detail.document?.trim()) {
      void window.api.matters.documentDocx(id).then((docx) => {
        if (docx && get().currentMatterId === id) set({ documentDocx: docx })
      })
    }
  },

  async deleteMatter(id) {
    await window.api.matters.delete(id)
    await get().refreshMatters()
    if (get().currentMatterId === id) set({ route: 'launchpad', currentMatterId: null })
  },

  async sendFollow(text) {
    const matterId = get().currentMatterId
    if (!matterId || !text.trim()) return
    const userMsg: ThreadMessage = {
      id: `local_${Date.now()}`,
      role: 'user',
      text,
      createdAt: Date.now()
    }
    set({ messages: [...get().messages, userMsg], running: true })
    await window.api.agent.send({ matterId, text })
  },

  async cancelRun() {
    const matterId = get().currentMatterId
    if (matterId) await window.api.agent.cancel(matterId)
    set({ running: false, pendingPermission: null })
  },

  resolvePermission(decision) {
    const p = get().pendingPermission
    if (p) window.api.agent.resolvePermission(p.requestId, decision)
    set({ pendingPermission: null })
  },

  setToast: (toast) => set({ toast }),

  async refreshCollections() {
    set({ collections: await window.api.library.list() })
  },
  async createCollection(input) {
    const c = await window.api.library.create(input)
    set({ collections: [c, ...get().collections] })
  },
  async deleteCollection(id) {
    await window.api.library.delete(id)
    await get().refreshCollections()
    if (get().currentCollectionId === id) {
      set({ route: 'library', currentCollectionId: null, collectionDetail: null })
    }
  },
  async reindexCollection(id) {
    await window.api.library.reindex(id)
    set({
      collections: get().collections.map((c) => (c.id === id ? { ...c, status: 'indexing' } : c))
    })
  },
  async openCollection(id) {
    const detail = await window.api.library.get(id)
    set({ currentCollectionId: id, collectionDetail: detail, searchHits: null, route: 'collection' })
  },
  async searchCollection(query) {
    const id = get().currentCollectionId
    if (!id) return
    if (!query.trim()) {
      set({ searchHits: null })
      return
    }
    const hits = await window.api.library.search(id, query)
    set({ searchHits: hits })
  },
  clearSearch: () => set({ searchHits: null }),
  async exportIndex(format) {
    const id = get().currentCollectionId
    if (!id) return
    const res = await window.api.library.exportIndex(id, format)
    set({ toast: res.ok ? `Exported to ${res.path}` : `Export failed: ${res.error}` })
  },
  handleIndexEvent(e) {
    const ip = { ...get().indexProgress }
    if (e.type === 'index-progress') {
      ip[e.collectionId] = { phase: e.phase, done: e.done, total: e.total }
      set({ indexProgress: ip })
    } else if (e.type === 'index-done') {
      delete ip[e.collectionId]
      set({ indexProgress: ip })
      void get().refreshCollections()
      if (get().currentCollectionId === e.collectionId) {
        void window.api.library.get(e.collectionId).then((detail) => set({ collectionDetail: detail }))
      }
    } else if (e.type === 'index-error') {
      delete ip[e.collectionId]
      set({ indexProgress: ip, toast: `Indexing failed: ${e.message}` })
      void get().refreshCollections()
    }
  },

  handleEvent(e) {
    // Track run state for ALL matters, even ones not currently open, so a
    // background run is never "lost" when the user navigates away.
    if (e.type === 'turn-start' && !get().runningMatters.includes(e.matterId)) {
      set({ runningMatters: [...get().runningMatters, e.matterId] })
    } else if (e.type === 'done') {
      set({ runningMatters: get().runningMatters.filter((id) => id !== e.matterId) })
    }
    // Only mutate the visible thread for the matter currently open.
    if ('matterId' in e && e.matterId !== get().currentMatterId) return
    switch (e.type) {
      case 'turn-start': {
        const msg: ThreadMessage = { id: e.messageId, role: 'assistant', text: '', createdAt: Date.now() }
        set({ messages: [...get().messages, msg], running: true })
        break
      }
      case 'text': {
        set({
          messages: get().messages.map((m) =>
            m.id === e.messageId ? { ...m, text: m.text + e.delta } : m
          )
        })
        break
      }
      case 'tool-start': {
        const act: ToolActivity = { id: e.toolId, name: e.name, input: e.input, startedAt: Date.now() }
        set({ activities: [...get().activities, act] })
        break
      }
      case 'tool-end': {
        set({
          activities: get().activities.map((a) =>
            a.id === e.toolId ? { ...a, ok: e.ok, summary: e.summary, endedAt: Date.now() } : a
          )
        })
        break
      }
      case 'permission-request': {
        set({
          pendingPermission: { requestId: e.requestId, tool: e.tool, title: e.title, detail: e.detail }
        })
        break
      }
      case 'document':
        set(e.docx ? { documentText: e.text, documentDocx: e.docx } : { documentText: e.text })
        break
      case 'turn-end':
        break
      case 'error': {
        // Surface the failure persistently in the deliverable pane if the current
        // assistant turn produced nothing — a toast alone vanishes and the run
        // looks silently idle (e.g. the selected local model was uninstalled).
        const msgs = get().messages
        const last = msgs[msgs.length - 1]
        const note = `> ⚠️ **Run failed:** ${e.message}`
        if (last && last.role === 'assistant' && !last.text.trim()) {
          set({
            messages: msgs.map((m) => (m.id === last.id ? { ...m, text: note } : m)),
            toast: `Error: ${e.message}`
          })
        } else {
          set({ toast: `Error: ${e.message}` })
        }
        break
      }
      case 'done': {
        set({ running: false })
        void get().refreshMatters()
        break
      }
    }
  }
}))
