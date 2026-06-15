import type Anthropic from '@anthropic-ai/sdk'
import type { Settings } from '@shared/types'
import { createAnthropicProvider } from './anthropic'
import { createOllamaProvider } from './ollama'

// Canonical message/content shapes == Anthropic's, so persisted api.json needs
// no migration. Adapters translate to/from their own wire formats.
export type CanonMessage = Anthropic.MessageParam
export type CanonContent = Anthropic.ContentBlockParam

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface RunTurnOptions {
  system: string
  messages: CanonMessage[]
  tools: ToolSpec[]
  /** Server-side tools (e.g. web_search) — only some providers support these. */
  serverTools: string[]
  model: string
  maxTokens: number
  onText: (delta: string) => void
  signal: AbortSignal
}

export interface RunTurnResult {
  /** Assistant content blocks (canonical) to append to history. */
  assistantContent: CanonContent[]
  toolUses: ToolUse[]
  stopReason: string | null
}

export interface ProviderTestResult {
  ok: boolean
  error?: string
  model?: string
}

export interface Provider {
  readonly id: 'anthropic' | 'ollama'
  runTurn(o: RunTurnOptions): Promise<RunTurnResult>
  /** Non-tool completion used for indexer enrichment. */
  complete(o: { system?: string; prompt: string; model: string; maxTokens?: number }): Promise<string>
  test(): Promise<ProviderTestResult>
  listModels?(): Promise<string[]>
}

/** Select the active provider from settings. */
export function getProvider(settings: Settings): Provider {
  if (settings.provider === 'ollama') {
    return createOllamaProvider(settings.ollamaBaseUrl || 'http://127.0.0.1:11434')
  }
  return createAnthropicProvider()
}

/** The model id the active provider should use. */
export function activeModel(settings: Settings): string {
  return settings.provider === 'ollama' ? settings.ollamaModel : settings.model
}
