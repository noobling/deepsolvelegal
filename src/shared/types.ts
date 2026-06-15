// Shared types used by both the main and renderer processes.
// This file is the single source of truth for the IPC contract.

export type PracticeArea = 'commercial' | 'litigation' | 'privacy' | 'corporate'

export type OutputType = 'document' | 'table' | 'memo'

export type FieldType = 'text' | 'textarea' | 'select' | 'date' | 'files'

export interface WorkflowField {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  help?: string
  required?: boolean
  options?: string[] // for select
}

export interface Workflow {
  id: string
  area: PracticeArea
  title: string
  /** Action-card verb phrase, e.g. "Review a contract". */
  cta: string
  description: string
  /** lucide-react icon name */
  icon: string
  intakeFields: WorkflowField[]
  outputType: OutputType
  /** Tool names from the catalog this workflow is allowed to use. */
  tools: string[]
  /** System prompt adapted from the matching claude-for-legal skill. */
  systemPrompt: string
  /** Optional one-liner shown while running. */
  runningLabel?: string
}

export interface PracticeAreaMeta {
  id: PracticeArea
  label: string
  blurb: string
  icon: string
  accent: string
}

// ---- Settings ----

export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' }
] as const

export type ModelId = (typeof MODELS)[number]['id']

export type LlmProvider = 'anthropic' | 'ollama'

export interface Settings {
  /** Which LLM backend to use. */
  provider: LlmProvider
  model: ModelId
  /** Local Ollama server URL (when provider === 'ollama'). */
  ollamaBaseUrl: string
  /** Selected local model name (when provider === 'ollama'). */
  ollamaModel: string
  /** Default folder where matters & deliverables are written. */
  matterRoot: string
  /** Practice profile (the claude-for-legal CLAUDE.md analog). */
  profile: string
  /** Auto-approve read-only tools (always true; reads never prompt). */
  autoApproveReads: boolean
}

export interface KeyStatus {
  present: boolean
}

export interface TestConnectionResult {
  ok: boolean
  error?: string
  model?: string
}

// ---- Matters & threads ----

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  /** Rendered text (the deliverable for assistant turns). */
  text: string
  createdAt: number
}

export interface ToolActivity {
  id: string
  name: string
  input: unknown
  ok?: boolean
  summary?: string
  startedAt: number
  endedAt?: number
}

export interface Matter {
  id: string
  title: string
  workflowId: string
  area: PracticeArea
  outputType: OutputType
  createdAt: number
  updatedAt: number
  folder: string
}

export interface MatterDetail extends Matter {
  messages: ThreadMessage[]
  activities: ToolActivity[]
}

// ---- Agent streaming events (main -> renderer) ----

export type AgentEvent =
  | { type: 'turn-start'; matterId: string; messageId: string }
  | { type: 'text'; matterId: string; messageId: string; delta: string }
  | { type: 'tool-start'; matterId: string; messageId: string; toolId: string; name: string; input: unknown }
  | { type: 'tool-end'; matterId: string; toolId: string; ok: boolean; summary: string }
  | {
      type: 'permission-request'
      matterId: string
      requestId: string
      tool: string
      title: string
      detail: string
    }
  | { type: 'turn-end'; matterId: string; messageId: string }
  | { type: 'error'; matterId: string; message: string }
  | { type: 'done'; matterId: string }

export interface StartThreadInput {
  workflowId: string
  intake: Record<string, unknown>
  /** Absolute paths of files the user attached in the intake. */
  files: string[]
}

export interface SendMessageInput {
  matterId: string
  text: string
}

export interface ExportInput {
  matterId: string
  messageId: string
  format: 'docx' | 'pdf' | 'xlsx'
}

export interface ExportResult {
  ok: boolean
  path?: string
  error?: string
}

export type PermissionDecision = 'allow' | 'allow-always' | 'deny'

// ---- Library / document index ----

export type CollectionStatus = 'idle' | 'indexing' | 'ready' | 'error'

export interface Collection {
  id: string
  name: string
  folders: string[]
  createdAt: number
  updatedAt: number
  fileCount: number
  status: CollectionStatus
  /** Whether to enrich each doc with a Claude-generated summary/type/parties. */
  aiEnrich: boolean
  error?: string
}

export type DocKind = 'email' | 'doc'

export interface IndexedDoc {
  id: string
  path: string
  name: string
  ext: string
  size: number
  modifiedAt: number
  kind: DocKind
  textChars: number
  // Parsed (emails) / enriched (AI) fields — all optional.
  date?: string
  from?: string
  to?: string
  subject?: string
  title?: string
  summary?: string
  docType?: string
  parties?: string[]
}

export interface CollectionDetail extends Collection {
  docs: IndexedDoc[]
}

export interface LibrarySearchHit {
  doc: IndexedDoc
  score: number
  snippet: string
}

export interface CreateCollectionInput {
  name: string
  folders: string[]
  aiEnrich: boolean
}

export type IndexEvent =
  | { type: 'index-progress'; collectionId: string; phase: string; done: number; total: number }
  | { type: 'index-done'; collectionId: string; fileCount: number }
  | { type: 'index-error'; collectionId: string; message: string }

// The typed surface exposed on window.api by the preload bridge.
export interface Api {
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
    pickMatterRoot: () => Promise<string | null>
  }
  key: {
    status: () => Promise<KeyStatus>
    set: (apiKey: string) => Promise<KeyStatus>
    clear: () => Promise<KeyStatus>
    test: () => Promise<TestConnectionResult>
  }
  ollama: {
    models: () => Promise<string[]>
  }
  matters: {
    list: () => Promise<Matter[]>
    get: (id: string) => Promise<MatterDetail | null>
    delete: (id: string) => Promise<void>
  }
  agent: {
    start: (input: StartThreadInput) => Promise<{ matterId: string }>
    send: (input: SendMessageInput) => Promise<void>
    cancel: (matterId: string) => Promise<void>
    resolvePermission: (requestId: string, decision: PermissionDecision) => void
    onEvent: (cb: (e: AgentEvent) => void) => () => void
  }
  files: {
    pick: () => Promise<string[]>
    reveal: (path: string) => Promise<void>
  }
  library: {
    list: () => Promise<Collection[]>
    create: (input: CreateCollectionInput) => Promise<Collection>
    get: (id: string) => Promise<CollectionDetail | null>
    delete: (id: string) => Promise<void>
    reindex: (id: string) => Promise<void>
    cancel: (id: string) => Promise<void>
    search: (id: string, query: string) => Promise<LibrarySearchHit[]>
    exportIndex: (id: string, format: 'xlsx' | 'docx') => Promise<ExportResult>
    pickFolders: () => Promise<string[]>
    onEvent: (cb: (e: IndexEvent) => void) => () => void
  }
  export: (input: ExportInput) => Promise<ExportResult>
}
