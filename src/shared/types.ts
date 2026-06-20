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
  /**
   * Extra scaffolding (coverage checklist, self-audit) appended only for weak
   * local models. Omitted for cloud models, which don't need it and do better
   * with more latitude.
   */
  localGuidance?: string
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

// ---- Local (Ollama) model guidance ----

/** How much caution a local model warrants for legal work. */
export type LegalRiskLevel = 'elevated' | 'high' | 'severe'

export interface LocalModelInfo {
  /** Lowercase substring matched against the Ollama model name (most specific first). */
  match: string
  label: string
  /** Relative local capability, 1 (weak) … 5 (strongest runnable locally). */
  power: number
  /** Approximate memory footprint while loaded. */
  ram: string
  risk: LegalRiskLevel
  /** One-line guidance on fitness for legal work. */
  note: string
}

/**
 * Capability + legal-risk notes for common local models. Ordered most-specific
 * first so `localModelInfo` matches e.g. "qwen2.5:32b" before "qwen2.5".
 * Power is relative to what a workstation can realistically run — even a 5/5
 * local model sits well below the cloud Claude models for legal reasoning.
 */
export const LOCAL_MODELS: LocalModelInfo[] = [
  {
    match: 'qwen2.5:32b',
    label: 'Qwen2.5 32B',
    power: 5,
    ram: '~20 GB',
    risk: 'elevated',
    note: 'Strongest local option for reasoning and tool use. Needs ≥32 GB RAM and runs slowly; heavy load can lag the machine.'
  },
  {
    match: 'qwen2.5:14b',
    label: 'Qwen2.5 14B',
    power: 4,
    ram: '~10 GB',
    risk: 'elevated',
    note: 'Best balance for local legal triage and drafting. Reliable tool-calling; comfortable on 16–32 GB.'
  },
  {
    match: 'qwen2.5',
    label: 'Qwen2.5 7B',
    power: 3,
    ram: '~5 GB',
    risk: 'high',
    note: 'Fast and light. Usable for summaries and first drafts; weaker on subtle clause analysis.'
  },
  {
    match: 'llama3.3',
    label: 'Llama 3.3 70B',
    power: 5,
    ram: '~40 GB',
    risk: 'elevated',
    note: 'Very capable but needs ≥48 GB RAM — impractical on most laptops.'
  },
  {
    match: 'llama3.1',
    label: 'Llama 3.1 8B',
    power: 3,
    ram: '~5 GB',
    risk: 'high',
    note: 'Solid general default with tool support. Fine for triage; independently verify any legal conclusion.'
  },
  {
    match: 'llama3.2',
    label: 'Llama 3.2 3B',
    power: 1,
    ram: '~2 GB',
    risk: 'severe',
    note: 'Tiny and fast. Quick text only — not reliable for legal analysis or tool-heavy workflows.'
  },
  {
    match: 'mixtral',
    label: 'Mixtral 8x7B',
    power: 4,
    ram: '~26 GB',
    risk: 'elevated',
    note: 'Capable mixture-of-experts model; fast for its size but memory-hungry.'
  },
  {
    match: 'mistral',
    label: 'Mistral 7B',
    power: 2,
    ram: '~5 GB',
    risk: 'high',
    note: 'Lightweight. Inconsistent tool-calling; better for plain drafting than analysis.'
  }
]

/** Best-effort capability/risk lookup for a local model name; null if unknown. */
export function localModelInfo(name: string): LocalModelInfo | null {
  const n = (name || '').toLowerCase()
  return LOCAL_MODELS.find((m) => n.includes(m.match)) ?? null
}

export type LlmProvider = 'anthropic' | 'ollama'

/** Which in-app editor renders the redlined document pane. */
export type DocumentEditor = 'superdoc' | 'syncfusion' | 'dotnet'

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
  /** Which embedded editor backs the redline document pane. */
  documentEditor: DocumentEditor
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
  /** The work product shown in the document pane, edited in place by apply_redline. */
  document?: string
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
  | { type: 'document'; matterId: string; text: string; docx?: string }
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

// ---- Email → PDF batch conversion ----

/** Per-email progress while converting a folder of emails to PDF. */
export interface EmailToPdfProgress {
  done: number
  total: number
  file: string
}

/** Counsel-review production options for email → PDF. */
export interface EmailToPdfOptions {
  /** Merge each email's attachments (PDFs/images) onto the end of its PDF. */
  combineAttachments?: boolean
  /** Stamp every page with a sequential Bates number, or null for none. */
  bates?: { prefix: string; start: number } | null
  /** Write an INTERNAL review index spreadsheet (Bates range + metadata per email). */
  index?: boolean
  /** Write an EXTERNAL production load file (.DAT + .CSV) for opposing counsel. */
  loadFile?: boolean
}

export interface EmailToPdfResult {
  /** .eml files successfully converted. */
  converted: number
  /** Non-.eml files encountered and left alone. */
  skipped: number
  /** Attachments extracted to "<name> - attachments" folders. */
  attachments: number
  /** Files that matched .eml but failed to convert. */
  errors: { file: string; error: string }[]
  /** Absolute paths of the PDFs written. */
  outputs: string[]
  /** First/last Bates numbers across the set (when Bates stamping is on). */
  batesRange?: { begin: string; end: string }
  /** Path to the internal review index spreadsheet (when requested). */
  indexPath?: string
  /** Path to the external production load file (.DAT; a .CSV is written too). */
  loadFilePath?: string
}

// ---- Library / document index ----

export type CollectionStatus = 'idle' | 'indexing' | 'ready' | 'error'

/**
 * Opt-in processors a document set can run. The input is always indexed (so it's
 * browsable + searchable); these add deliverables written to the output folder.
 */
export interface ProcessFeatures {
  /** Convert emails to readable PDFs. (A review index or production renders every doc too.) */
  emailToPdf: boolean
  /** Review index spreadsheet over the whole set — for your own review team (internal). */
  reviewIndex: boolean
  /** Production load file (.DAT + .CSV) over the whole set — for opposing counsel (external). */
  loadFile: boolean
  /** Extract reviewer highlights and write a highlights table. */
  highlights: boolean
  /** Enrich each doc with a Claude-generated summary / type / parties. */
  aiEnrich: boolean
}

/** Artifacts the production pass writes under the output folder. */
export interface ProductionResult {
  /** Documents rendered to (Bates-stamped) PDF in the output folder. */
  pdfCount: number
  /** First/last Bates numbers across the production. */
  batesRange?: { begin: string; end: string }
  /** Review index spreadsheet (filename under the output folder) — internal. */
  indexPath?: string
  /** Production load file (.DAT; a .CSV sits beside it) — external. */
  loadFilePath?: string
  /** Highlights table (xlsx). */
  highlightsPath?: string
  /** Unrenderable files given a native slip-sheet placeholder (still Bates-stamped). */
  slipSheets: number
  /** Per-file errors during production (non-fatal; the file is skipped). */
  errors: { file: string; error: string }[]
}

export interface Collection {
  id: string
  name: string
  /** Input folders that get walked + indexed. */
  folders: string[]
  /** Production output folder (the deliverable bundle); unset for index-only sets. */
  output?: string
  createdAt: number
  updatedAt: number
  fileCount: number
  status: CollectionStatus
  /** Opt-in processors. Legacy collections (pre-unification) only carried `aiEnrich`. */
  features?: ProcessFeatures
  /** Bates numbering config for the production (prefix + start number). */
  bates?: { prefix: string; start: number }
  /** Merge each email's attachments onto the end of its PDF. */
  combineAttachments?: boolean
  /** Whether to enrich each doc with a Claude-generated summary/type/parties. */
  aiEnrich: boolean
  /** Production artifacts produced on the last run. */
  production?: ProductionResult
  error?: string
}

export type DocKind = 'email' | 'doc'

/** A passage a reviewer marked with the highlighter, recovered from a .docx/.pdf. */
export interface DocHighlight {
  text: string
  /** Highlight colour: a Word colour name (e.g. "yellow") or a "#RRGGBB" fill. */
  color: string
  /** 1-based page where it's highlighted — so it's easy to find in the source. */
  page?: number
  /** The surrounding paragraph/line, to locate the highlight on the page. */
  context?: string
}

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
  /** Passages highlighted by a reviewer (.docx/.pdf). Also folded into search text. */
  highlights?: DocHighlight[]
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
  /** Production output folder (required when any production feature is enabled). */
  output?: string
  features: ProcessFeatures
  /** Bates numbering config (prefix + start). Defaults applied if omitted. */
  bates?: { prefix: string; start: number }
  combineAttachments?: boolean
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
    documentDocx: (id: string) => Promise<string>
    openInWord: (id: string) => Promise<ExportResult>
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
    estimateTokens: (paths: string[]) => Promise<number>
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
    exportHighlights: (id: string, format: 'csv' | 'xlsx') => Promise<ExportResult>
    pickFolders: () => Promise<string[]>
    /** Pick the single production output folder (created if needed). */
    pickOutput: () => Promise<string | null>
    onEvent: (cb: (e: IndexEvent) => void) => () => void
  }
  export: (input: ExportInput) => Promise<ExportResult>
}
