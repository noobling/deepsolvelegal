import http from 'node:http'
import https from 'node:https'
import type Anthropic from '@anthropic-ai/sdk'
import type { CanonContent, CanonMessage, Provider, ToolSpec, ToolUse } from './provider'

/**
 * Minimal HTTP transport over node:http with NO idle/headers timeout.
 *
 * We deliberately avoid the global `fetch` here. In both Node and Electron's
 * main process, global `fetch` is undici, which enforces a headers timeout and
 * aborts the request if the first response byte is slow. Ollama withholds the
 * response until generation finishes whenever a request carries `tools` (it
 * can't stream a partial tool call) — and every workflow turn carries tools —
 * so on a slow/CPU-only machine that first byte can arrive minutes later and
 * undici kills the request with "Headers Timeout Error". node:http has no such
 * limit. Returns a fetch-like response covering exactly what this file uses.
 */
interface HttpLikeResponse {
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
  json: () => Promise<unknown>
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } }
}

function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
): Promise<HttpLikeResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers },
      (res) => {
        const queue: Uint8Array[] = []
        const waiters: ((r: { done: boolean; value?: Uint8Array }) => void)[] = []
        let ended = false
        let errored: Error | null = null
        res.on('data', (c: Buffer) => {
          const chunk = new Uint8Array(c)
          const w = waiters.shift()
          if (w) w({ done: false, value: chunk })
          else queue.push(chunk)
        })
        res.on('end', () => {
          ended = true
          let w
          while ((w = waiters.shift())) w({ done: true })
        })
        res.on('error', (e) => {
          errored = e
          let w
          while ((w = waiters.shift())) w({ done: true })
        })
        const reader = {
          read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
            if (queue.length) return Promise.resolve({ done: false, value: queue.shift() })
            if (errored) return Promise.reject(errored)
            if (ended) return Promise.resolve({ done: true })
            return new Promise((r) => waiters.push(r))
          }
        }
        const collectText = async (): Promise<string> => {
          let out = ''
          const td = new TextDecoder()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            out += td.decode(value, { stream: true })
          }
          return out + td.decode()
        }
        resolve({
          ok: res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          body: { getReader: () => reader },
          text: collectText,
          json: async () => JSON.parse(await collectText())
        })
      }
    )
    req.setTimeout(0) // local generation can take a long time; never time out
    req.on('error', reject)
    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy(new Error('aborted'))
        return
      }
      opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')))
    }
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
}

function blockText(content: string | unknown[]): string {
  if (typeof content === 'string') return content
  return (content as Anthropic.ContentBlockParam[])
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b.text as string) : ''))
    .join('')
}

/** Canonical (Anthropic-shaped) history → Ollama chat messages. */
function toOllamaMessages(system: string, messages: CanonMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const content = m.content
    if (m.role === 'user') {
      if (typeof content === 'string') {
        out.push({ role: 'user', content })
      } else {
        // Tool result blocks → one Ollama 'tool' message each.
        for (const b of content as Anthropic.ContentBlockParam[]) {
          if (b.type === 'tool_result') {
            const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
            out.push({ role: 'tool', content: c })
          } else if (b.type === 'text') {
            out.push({ role: 'user', content: b.text as string })
          }
        }
      }
    } else {
      // assistant
      const blocks = (typeof content === 'string' ? [] : content) as Anthropic.ContentBlockParam[]
      const text = blockText(content)
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          function: {
            name: (b as Anthropic.ToolUseBlockParam).name,
            arguments: ((b as Anthropic.ToolUseBlockParam).input ?? {}) as Record<string, unknown>
          }
        }))
      const msg: OllamaMessage = { role: 'assistant', content: typeof content === 'string' ? content : text }
      if (toolCalls.length) msg.tool_calls = toolCalls
      out.push(msg)
    }
  }
  return out
}

function toOllamaTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

export function createOllamaProvider(baseUrl: string): Provider {
  const base = baseUrl.replace(/\/+$/, '')

  return {
    id: 'ollama',

    async runTurn(o) {
      const res = await request(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: o.signal,
        body: JSON.stringify({
          model: o.model,
          messages: toOllamaMessages(o.system, o.messages),
          tools: toOllamaTools(o.tools),
          stream: true,
          options: { num_predict: o.maxTokens }
        })
      })
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => res.statusText)
        if (res.status === 404) {
          throw new Error(
            `Local model "${o.model}" is not installed in Ollama. Open Settings → Local model to pick an installed model, or run \`ollama pull ${o.model}\` in a terminal.`
          )
        }
        throw new Error(`Ollama error ${res.status}: ${body}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let text = ''
      const toolUses: ToolUse[] = []
      let n = 0

      const handleLine = (line: string): void => {
        const trimmed = line.trim()
        if (!trimmed) return
        let obj: {
          message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] }
          error?: string
        }
        try {
          obj = JSON.parse(trimmed)
        } catch {
          return
        }
        if (obj.error) throw new Error(obj.error)
        const msg = obj.message
        if (msg?.content) {
          text += msg.content
          o.onText(msg.content)
        }
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            n += 1
            const args = tc.function.arguments
            const input =
              typeof args === 'string'
                ? ((): Record<string, unknown> => {
                    try {
                      return JSON.parse(args)
                    } catch {
                      return {}
                    }
                  })()
                : ((args ?? {}) as Record<string, unknown>)
            toolUses.push({ id: `call_${Date.now()}_${n}`, name: tc.function.name, input })
          }
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, idx))
          buffer = buffer.slice(idx + 1)
        }
      }
      if (buffer.trim()) handleLine(buffer)

      const assistantContent: CanonContent[] = []
      if (text) assistantContent.push({ type: 'text', text })
      for (const tu of toolUses) {
        assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      }
      if (assistantContent.length === 0) assistantContent.push({ type: 'text', text: '' })

      return {
        assistantContent,
        toolUses,
        stopReason: toolUses.length ? 'tool_use' : 'end_turn'
      }
    },

    async complete(o) {
      const res = await request(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: o.model,
          messages: [
            ...(o.system ? [{ role: 'system', content: o.system }] : []),
            { role: 'user', content: o.prompt }
          ],
          stream: false,
          options: { num_predict: o.maxTokens ?? 1024 }
        })
      })
      if (!res.ok) throw new Error(`Ollama error ${res.status}`)
      const json = (await res.json()) as { message?: { content?: string } }
      return json.message?.content ?? ''
    },

    async listModels() {
      const res = await request(`${base}/api/tags`)
      if (!res.ok) return []
      const json = (await res.json()) as { models?: { name: string }[] }
      return (json.models ?? []).map((m) => m.name)
    },

    async test() {
      try {
        const res = await request(`${base}/api/tags`)
        if (!res.ok) return { ok: false, error: `Ollama responded ${res.status}` }
        const json = (await res.json()) as { models?: { name: string }[] }
        const models = (json.models ?? []).map((m) => m.name)
        if (!models.length) {
          return { ok: false, error: 'Ollama is running but has no models. Run e.g. "ollama pull llama3.1".' }
        }
        return { ok: true, model: models[0] }
      } catch {
        return {
          ok: false,
          error: `Can't reach Ollama at ${base}. Install it from ollama.com, start it, then run "ollama pull llama3.1".`
        }
      }
    }
  }
}
