import { create } from 'zustand'
import type {
  AgentEvent,
  Collection,
  CollectionDetail,
  CreateCollectionInput,
  IndexEvent,
  LibrarySearchHit,
  Matter,
  ProcessFeatures,
  Settings,
  ThreadMessage,
  ToolActivity
} from '@shared/types'

export type Route = 'launchpad' | 'workspace' | 'settings' | 'library' | 'collection' | 'highlights' | 'superdoc-spike' | 'syncfusion-spike' | 'dotnet-word-spike'

/**
 * Live IPC subscriptions. Held at module scope so `init()` is idempotent:
 * React StrictMode (and any double-mount) invokes the init effect twice, and
 * without this guard each call would register another `agent:event`/`index:event`
 * listener — causing every streamed delta and activity to be applied twice
 * (e.g. "TheThe organization organization").
 */
let unsubscribers: Array<() => void> = []

/** Throttle for streaming the open set's docs in while it indexes. */
let lastDetailRefresh = 0

/**
 * Per-collection timing anchors for the progress ETA. We measure throughput
 * within a single phase only (each phase resets `done`/`total`), anchoring on
 * the first sample of a phase and smoothing the estimate as work accrues.
 */
const indexTiming: Record<string, { phase: string; anchorTime: number; anchorDone: number; etaMs?: number }> = {}

/**
 * Collections whose exclude/restore lists changed while a re-run was already in
 * flight. The backend drops a re-run requested mid-run, so we remember it and
 * fire one more re-run when the current one finishes — no attachment change is lost.
 */
const rerunWhenIdle = new Set<string>()
// An Outputs toggle persists via setFeatures (an async IPC round-trip) but the UI lets
// the user click Re-run immediately after. reindex reads the collection FROM DISK in the
// main process, so it must not start until that save has landed — otherwise the run uses
// the pre-toggle features and silently skips the just-enabled deliverable. Track the
// in-flight save per set so reindexCollection can await it first.
const pendingFeatureSave = new Map<string, Promise<unknown>>()

// A run streams several sequential phases (index → optional summarize → production:
// scan → check → render → number). To show ONE continuous bar instead of each phase
// refilling from 0, every phase owns a fixed slice of the whole, sized by its rough
// share of the work. Overall % = the slices fully before this phase + this phase's own
// slice scaled by its done/total. Phases that don't run for a given set (no AI
// summaries, native mode, nothing changed) are simply skipped — the bar steps forward
// over their slice, never backward. The last phase's slice lands the bar on 100%.
const PHASE_WEIGHTS: { phase: string; weight: number }[] = [
  { phase: 'Reading documents', weight: 3 },
  { phase: 'Summarizing', weight: 3 },
  { phase: 'Scanning for repeated logos', weight: 2 },
  { phase: 'Checking for changes', weight: 1 },
  { phase: 'Rendering documents', weight: 5 },
  { phase: 'Numbering documents', weight: 1 }
]
const TOTAL_WEIGHT = PHASE_WEIGHTS.reduce((s, p) => s + p.weight, 0)

/** Map a phase + its in-phase progress to an overall 0–100 across the whole run. */
function overallPct(phase: string, done: number, total: number): number {
  const idx = PHASE_WEIGHTS.findIndex((p) => p.phase === phase)
  if (idx < 0) return total > 0 ? Math.round((done / total) * 100) : 0 // unknown phase — fall back
  let before = 0
  for (let i = 0; i < idx; i++) before += PHASE_WEIGHTS[i].weight
  const frac = total > 0 ? Math.min(1, done / total) : 0
  return Math.round(((before + PHASE_WEIGHTS[idx].weight * frac) / TOTAL_WEIGHT) * 100)
}

/** Highest overall % shown for a run so far — the bar must never retreat within a run.
 *  Cleared when the run ends (done/paused/error) so the next run starts fresh. */
const progressFloor: Record<string, number> = {}

/** Compute a smoothed ETA (ms) for the current phase from observed throughput. */
function estimateEtaMs(collectionId: string, phase: string, done: number, total: number): number | undefined {
  const now = Date.now()
  let t = indexTiming[collectionId]
  // Reset the anchor when the phase changes or progress rewinds (a new phase).
  if (!t || t.phase !== phase || done < t.anchorDone) {
    t = { phase, anchorTime: now, anchorDone: done }
    indexTiming[collectionId] = t
  }
  const elapsed = now - t.anchorTime
  const processed = done - t.anchorDone
  if (processed <= 0 || elapsed < 400 || done >= total) return t.etaMs
  const rate = processed / elapsed // files per ms
  const raw = (total - done) / rate
  // Exponential smoothing keeps the countdown from jittering between samples.
  t.etaMs = t.etaMs == null ? raw : t.etaMs * 0.6 + raw * 0.4
  return t.etaMs
}

/** Optimistically flip a set (and the open detail) to 'indexing' on re-run/resume,
 *  so the Pause/Resume buttons switch immediately instead of after the first event. */
function markIndexing(get: () => AppState, set: (partial: Partial<AppState>) => void, id: string): void {
  const { collections, currentCollectionId, collectionDetail } = get()
  set({
    collections: collections.map((c) => (c.id === id ? { ...c, status: 'indexing' } : c)),
    collectionDetail:
      currentCollectionId === id && collectionDetail ? { ...collectionDetail, status: 'indexing' } : collectionDetail
  })
}

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
  /** Overall 0–100 across ALL phases of the run (continuous, monotonic) — for the bar. */
  pct: number
  /** Name of the file currently being processed (when known). */
  currentFile?: string
  /** Estimated milliseconds remaining for the current phase, smoothed (when known). */
  etaMs?: number
}

/**
 * A queued attachment include/exclude change, awaiting the next (manual) re-run.
 * Re-running is a long operation, so toggles accumulate here instead of firing a
 * render each — the user reviews the list and applies them all at once. Cleared
 * when the run that applies them finishes.
 */
export interface PendingOp {
  /** 'include' = will be produced; 'exclude' = will be set aside on the next run. */
  kind: 'include' | 'exclude'
  /** Display file name. */
  file: string
  /** The rule's scope: 'name' = every file of this name, 'file' = this exact file
   *  (name + size). Undefined for an undo (removing a rule), which has no scope. */
  scope?: 'file' | 'name'
  /** Produced folder(s) an included/restored file lands in (when known). */
  paths?: string[]
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
  /** Per-collection queue of attachment changes awaiting the next manual re-run. */
  pendingOps: Record<string, PendingOp[]>
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
  pauseCollection: (id: string) => Promise<void>
  resumeCollection: (id: string) => Promise<void>
  openCollection: (id: string) => Promise<void>
  searchCollection: (query: string) => Promise<void>
  clearSearch: () => void
  exportIndex: (format: 'xlsx' | 'docx') => Promise<void>
  exportHighlights: (format: 'csv' | 'xlsx') => Promise<void>
  /** Replace the open collection's excluded-attachment filename list (applied on Re-run). */
  setExcludedAttachments: (names: string[]) => Promise<void>
  /** Replace the open collection's restored-attachment fingerprint list (applied on Re-run).
   *  Optional record stores a display path for a "just this file" rule. */
  setKeptAttachments: (fingerprints: string[], record?: { fp: string; path: string }) => Promise<void>
  /** Replace the open collection's per-file exclude list (name|size fingerprints). */
  setExcludedFingerprints: (fingerprints: string[], record?: { fp: string; path: string }) => Promise<void>
  /** Replace the open collection's keep-by-name list. */
  setKeptNames: (names: string[]) => Promise<void>
  setFeatures: (features: ProcessFeatures) => Promise<void>
  /** Toggle keeping the open set's attachments as separate native files (they're always
   *  merged into the PDF too). Persists immediately; applied on the next Re-run. */
  setAttachmentMode: (combine: boolean, separate: boolean) => Promise<void>
  /** Toggle per-family item-number prefixes on the open set. Persists immediately; applied
   *  on the next Re-run. */
  setItemNumbering: (enabled: boolean) => Promise<void>
  /** Export the open set's processing rules to a file. Returns a status for the UI. */
  exportRules: () => Promise<{ ok: boolean; error?: string }>
  /** Import processing rules from a file into the open set. Returns a status for the UI. */
  importRules: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string; ruleCount?: number }>
  /** Queue an attachment include/exclude change for the open set's next re-run. */
  queueAttachmentOp: (op: PendingOp) => void
  /** Drop all queued attachment changes for a collection (e.g. after they're applied). */
  clearAttachmentOps: (id: string) => void
  /** Pick source folders/files and add them to the open set; resolves to how many were added. */
  addSources: () => Promise<number>
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
  pendingOps: {},
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
    // Jump straight into the set so you can browse the documents as they process.
    await get().openCollection(c.id)
  },
  async deleteCollection(id) {
    await window.api.library.delete(id)
    await get().refreshCollections()
    if (get().currentCollectionId === id) {
      set({ route: 'library', currentCollectionId: null, collectionDetail: null })
    }
  },
  async reindexCollection(id) {
    // A run is already in flight (buildIndex drops a concurrent re-run): remember to
    // re-run once it finishes so a change made mid-render still gets produced.
    const c = get().collections.find((x) => x.id === id)
    const busy = c?.status === 'indexing' || !!get().indexProgress[id]
    if (busy) {
      rerunWhenIdle.add(id)
      return
    }
    rerunWhenIdle.delete(id)
    // Don't start the run until a just-toggled Outputs change has been written to disk,
    // or the run reads stale features and skips the newly-enabled deliverable.
    const pending = pendingFeatureSave.get(id)
    if (pending) await pending.catch(() => {})
    await window.api.library.reindex(id)
    markIndexing(get, set, id)
  },
  async pauseCollection(id) {
    // Status flips to 'paused' when the run actually stops (index-paused event).
    await window.api.library.pause(id)
  },
  async resumeCollection(id) {
    await window.api.library.resume(id)
    markIndexing(get, set, id)
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
  async setExcludedAttachments(names) {
    const id = get().currentCollectionId
    if (!id) return
    const detail = await window.api.library.setExcluded(id, names)
    if (detail) {
      set({ collectionDetail: detail })
      // Keep the library card's copy in sync so re-runs read the new list.
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, excludeAttachments: detail.excludeAttachments } : c)) })
    }
  },
  async setKeptAttachments(fingerprints, record) {
    const id = get().currentCollectionId
    if (!id) return
    const detail = await window.api.library.setKept(id, fingerprints, record)
    if (detail) {
      set({ collectionDetail: detail })
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, keepAttachments: detail.keepAttachments, attachmentPaths: detail.attachmentPaths } : c)) })
    }
  },
  async setExcludedFingerprints(fingerprints, record) {
    const id = get().currentCollectionId
    if (!id) return
    const detail = await window.api.library.setExcludedFps(id, fingerprints, record)
    if (detail) {
      set({ collectionDetail: detail })
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, excludeFingerprints: detail.excludeFingerprints, attachmentPaths: detail.attachmentPaths } : c)) })
    }
  },
  async setKeptNames(names) {
    const id = get().currentCollectionId
    if (!id) return
    const detail = await window.api.library.setKeptNames(id, names)
    if (detail) {
      set({ collectionDetail: detail })
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, keepNames: detail.keepNames } : c)) })
    }
  },
  async setFeatures(features) {
    const id = get().currentCollectionId
    if (!id) return
    // Record the save so a fast Re-run waits for it (see pendingFeatureSave).
    const p = window.api.library.setFeatures(id, features)
    pendingFeatureSave.set(id, p)
    try {
      const detail = await p
      if (detail) {
        set({ collectionDetail: detail })
        set({ collections: get().collections.map((c) => (c.id === id ? { ...c, features: detail.features } : c)) })
      }
    } finally {
      if (pendingFeatureSave.get(id) === p) pendingFeatureSave.delete(id)
    }
  },
  async setAttachmentMode(combine, separate) {
    const id = get().currentCollectionId
    if (!id) return
    // Reuse the feature-save gate so a fast Re-run waits for this write to land (the run
    // reads the collection from disk; see reindexCollection).
    const p = window.api.library.setAttachmentMode(id, combine, separate)
    pendingFeatureSave.set(id, p)
    try {
      const detail = await p
      if (detail) {
        set({ collectionDetail: detail })
        set({
          collections: get().collections.map((c) =>
            c.id === id ? { ...c, combineAttachments: detail.combineAttachments, separateAttachments: detail.separateAttachments } : c
          )
        })
      }
    } finally {
      if (pendingFeatureSave.get(id) === p) pendingFeatureSave.delete(id)
    }
  },
  async setItemNumbering(enabled) {
    const id = get().currentCollectionId
    if (!id) return
    const p = window.api.library.setItemNumbering(id, enabled)
    pendingFeatureSave.set(id, p)
    try {
      const detail = await p
      if (detail) {
        set({ collectionDetail: detail })
        set({ collections: get().collections.map((c) => (c.id === id ? { ...c, itemNumbering: detail.itemNumbering } : c)) })
      }
    } finally {
      if (pendingFeatureSave.get(id) === p) pendingFeatureSave.delete(id)
    }
  },
  async exportRules() {
    const id = get().currentCollectionId
    if (!id) return { ok: false, error: 'No set open.' }
    const res = await window.api.library.exportRules(id)
    // A user-cancelled save dialog isn't worth a toast.
    if (res.ok) set({ toast: `Rules exported to ${res.path}` })
    else if (res.error && res.error !== 'Cancelled.') set({ toast: `Export failed: ${res.error}` })
    return { ok: res.ok, error: res.ok ? undefined : res.error }
  },
  async importRules() {
    const id = get().currentCollectionId
    if (!id) return { ok: false, error: 'No set open.' }
    const res = await window.api.library.importRules(id)
    if (res.ok && res.detail) {
      const detail = res.detail
      set({ collectionDetail: detail })
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, features: detail.features } : c)) })
      set({ toast: `Rules imported — ${res.ruleCount ?? 0} attachment rule${res.ruleCount === 1 ? '' : 's'}. Re-run to apply.` })
    } else if (!res.cancelled && res.error) {
      set({ toast: `Import failed: ${res.error}` })
    }
    return { ok: res.ok, cancelled: res.cancelled, error: res.error, ruleCount: res.ruleCount }
  },
  queueAttachmentOp(op) {
    const id = get().currentCollectionId
    if (!id) return
    const cur = get().pendingOps[id] ?? []
    const key = op.file.toLowerCase()
    // Two ops collide (replace/cancel) only when they act on the same target: a plain
    // undo (no scope) cancels any queued op for that filename, but a scoped op collides
    // only with the same scope. This keeps "keep just this file" (scope 'file') from
    // cancelling a separate "exclude all named" (scope 'name') for the same filename —
    // they're different rules and both belong in the pending list.
    const collides = (o: PendingOp): boolean =>
      o.file.toLowerCase() === key && (!op.scope || !o.scope || o.scope === op.scope)
    // A toggle back to the opposite direction cancels the queued op (no net change). When
    // a filename carries two ops (e.g. "exclude all named" + "keep just this file"), a
    // scope-less undo collides with both — so prefer cancelling an opposite-kind op (the
    // real undo) before falling back to refreshing a same-kind one. Otherwise it's new.
    const opposite = cur.find((o) => collides(o) && o.kind !== op.kind)
    const prior = opposite ?? cur.find(collides)
    const next = opposite
      ? cur.filter((o) => o !== opposite)
      : prior
        ? cur.map((o) => (o === prior ? op : o))
        : [...cur, op]
    set({ pendingOps: { ...get().pendingOps, [id]: next } })
  },
  clearAttachmentOps(id) {
    if (!get().pendingOps[id]) return
    const next = { ...get().pendingOps }
    delete next[id]
    set({ pendingOps: next })
  },
  async addSources() {
    const id = get().currentCollectionId
    if (!id) return 0
    const picked = await window.api.library.pickSources()
    if (!picked.length) return 0
    const before = get().collectionDetail?.folders.length ?? 0
    const detail = await window.api.library.addSources(id, picked)
    if (!detail) return 0
    set({ collectionDetail: detail })
    set({ collections: get().collections.map((c) => (c.id === id ? { ...c, folders: detail.folders } : c)) })
    return detail.folders.length - before
  },
  async exportIndex(format) {
    const id = get().currentCollectionId
    if (!id) return
    const res = await window.api.library.exportIndex(id, format)
    set({ toast: res.ok ? `Exported to ${res.path}` : `Export failed: ${res.error}` })
  },
  async exportHighlights(format) {
    const id = get().currentCollectionId
    if (!id) return
    const res = await window.api.library.exportHighlights(id, format)
    set({ toast: res.ok ? `Exported to ${res.path}` : `Export failed: ${res.error}` })
  },
  handleIndexEvent(e) {
    const ip = { ...get().indexProgress }
    if (e.type === 'index-progress') {
      const etaMs = estimateEtaMs(e.collectionId, e.phase, e.done, e.total)
      // One continuous bar: clamp the overall % so a new phase never rewinds it.
      const pct = Math.max(overallPct(e.phase, e.done, e.total), progressFloor[e.collectionId] ?? 0)
      progressFloor[e.collectionId] = pct
      ip[e.collectionId] = { phase: e.phase, done: e.done, total: e.total, currentFile: e.currentFile, etaMs, pct }
      set({ indexProgress: ip })
      // Stream freshly-indexed docs into the open set (throttled) so the list fills in live.
      if (get().currentCollectionId === e.collectionId && Date.now() - lastDetailRefresh > 900) {
        lastDetailRefresh = Date.now()
        void window.api.library.get(e.collectionId).then((detail) => {
          if (detail && get().currentCollectionId === e.collectionId) set({ collectionDetail: detail })
        })
      }
    } else if (e.type === 'index-done') {
      delete ip[e.collectionId]
      delete indexTiming[e.collectionId]
      delete progressFloor[e.collectionId]
      // The run that just finished applied any queued attachment changes — clear them.
      const pendingOps = { ...get().pendingOps }
      delete pendingOps[e.collectionId]
      set({ indexProgress: ip, pendingOps })
      // An exclude/restore toggle landed mid-render — the run that just finished didn't
      // include it, so immediately run once more so the output + index catch up. Skip
      // the idle refresh (we're not idle), else its async status write would race the
      // re-run's optimistic 'indexing' flip and briefly show the set as done.
      if (rerunWhenIdle.has(e.collectionId)) {
        rerunWhenIdle.delete(e.collectionId)
        void window.api.library.reindex(e.collectionId)
        markIndexing(get, set, e.collectionId)
      } else {
        void get().refreshCollections()
        if (get().currentCollectionId === e.collectionId) {
          void window.api.library.get(e.collectionId).then((detail) => set({ collectionDetail: detail }))
        }
      }
    } else if (e.type === 'index-paused') {
      delete ip[e.collectionId]
      delete indexTiming[e.collectionId]
      delete progressFloor[e.collectionId]
      rerunWhenIdle.delete(e.collectionId)
      set({ indexProgress: ip })
      void get().refreshCollections()
      if (get().currentCollectionId === e.collectionId) {
        void window.api.library.get(e.collectionId).then((detail) => set({ collectionDetail: detail }))
      }
    } else if (e.type === 'index-error') {
      delete ip[e.collectionId]
      delete indexTiming[e.collectionId]
      delete progressFloor[e.collectionId]
      rerunWhenIdle.delete(e.collectionId)
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
