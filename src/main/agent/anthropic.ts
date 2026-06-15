import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from '../secureKey'
import { getSettings } from '../storage/store'
import type { CanonContent, Provider, ToolSpec, ToolUse } from './provider'

export async function getClient(): Promise<Anthropic | null> {
  const key = await getApiKey()
  if (!key) return null
  return new Anthropic({ apiKey: key })
}

function buildAnthropicTools(tools: ToolSpec[], serverTools: string[]): Record<string, unknown>[] {
  const arr: Record<string, unknown>[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }))
  for (const s of serverTools) {
    if (s === 'web_search') arr.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 6 })
  }
  return arr
}

export function createAnthropicProvider(): Provider {
  return {
    id: 'anthropic',
    async runTurn(o) {
      const client = await getClient()
      if (!client) throw new Error('No Anthropic API key set. Add one in Settings.')
      const stream = client.messages.stream(
        {
          model: o.model,
          max_tokens: o.maxTokens,
          system: o.system,
          tools: buildAnthropicTools(o.tools, o.serverTools) as unknown as Anthropic.Tool[],
          messages: o.messages
        },
        { signal: o.signal }
      )
      stream.on('text', (d: string) => o.onText(d))
      const final = await stream.finalMessage()
      const toolUses: ToolUse[] = final.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }))
      return {
        assistantContent: final.content as unknown as CanonContent[],
        toolUses,
        stopReason: final.stop_reason
      }
    },
    async complete(o) {
      const client = await getClient()
      if (!client) throw new Error('No Anthropic API key set.')
      const res = await client.messages.create({
        model: o.model,
        max_tokens: o.maxTokens ?? 1024,
        system: o.system,
        messages: [{ role: 'user', content: o.prompt }]
      })
      const t = res.content.find((b) => b.type === 'text')
      return t && 'text' in t ? t.text : ''
    },
    async test() {
      const client = await getClient()
      if (!client) return { ok: false, error: 'No API key set.' }
      const { model } = await getSettings()
      try {
        await client.messages.create({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] })
        return { ok: true, model }
      } catch (e) {
        return { ok: false, error: (e as Error).message, model }
      }
    }
  }
}
