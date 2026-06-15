// Ad-hoc E2E harness: exercises the REAL src/main/agent/ollama.ts provider
// against a running Ollama server, mirroring exactly how runAgent.ts and the
// indexer drive it. Bundled on the fly with esbuild (type-only imports erase).
import esbuild from 'esbuild'
import { rmSync } from 'fs'
import { pathToFileURL } from 'url'
import path from 'path'
import http from 'node:http'

// Minimal node:http-backed fetch shim with NO headers timeout. Node's built-in
// fetch (undici) aborts if the first response byte is slow — which happens here
// only because CPU prompt-eval on this VM is slow. Electron's main process uses
// Chromium networking (no such timeout), so this shim makes the harness mirror
// the real runtime while running the actual, unmodified ollama.ts code.
globalThis.fetch = (url, opts = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {} },
      (res) => {
        const queue = []
        const waiters = []
        let ended = false
        res.on('data', (c) => {
          const chunk = new Uint8Array(c)
          if (waiters.length) waiters.shift()({ value: chunk, done: false })
          else queue.push(chunk)
        })
        res.on('end', () => {
          ended = true
          while (waiters.length) waiters.shift()({ value: undefined, done: true })
        })
        const reader = {
          read: () =>
            queue.length
              ? Promise.resolve({ value: queue.shift(), done: false })
              : ended
                ? Promise.resolve({ value: undefined, done: true })
                : new Promise((r) => waiters.push(r))
        }
        const text = async () => {
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
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || '',
          body: { getReader: () => reader },
          text,
          json: async () => JSON.parse(await text())
        })
      }
    )
    req.setTimeout(0)
    req.on('error', reject)
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')))
    if (opts.body) req.write(opts.body)
    req.end()
  })

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..')
const outFile = path.join(root, 'scripts', '.ollama-bundle.mjs')

await esbuild.build({
  entryPoints: [path.join(root, 'src/main/agent/ollama.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent'
})

const { createOllamaProvider } = await import(pathToFileURL(outFile).href)
const provider = createOllamaProvider('http://127.0.0.1:11434')
const MODEL = 'llama3.2:3b'
let pass = 0
let fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m) } else { fail++; console.log('  FAIL', m) } }

// 0) Warm up: load the model into memory via a streamed request. (Streaming
//    returns headers immediately; a cold non-streaming call can otherwise exceed
//    Node/undici's headers timeout — an artifact that does not affect Electron's
//    Chromium-backed main-process fetch.)
console.log('[0] warming up model (loading into memory)…')
{
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }], stream: true, options: { num_predict: 1 } })
  })
  const reader = res.body.getReader()
  for (;;) { const { done } = await reader.read(); if (done) break }
  console.log('   warm.')
}

// 1) test() — provider readiness probe used by Settings "Test connection".
console.log('\n[1] provider.test()')
const t = await provider.test()
console.log('   ->', JSON.stringify(t))
ok(t.ok === true, 'test() reports reachable Ollama with a model')

// 2) complete() — the non-tool path the Library indexer uses for enrichment.
console.log('\n[2] provider.complete()  (indexer path)')
const c = await provider.complete({
  system: 'Respond with ONLY a JSON array, no prose.',
  prompt: 'Return a JSON array with one object {"docType":"Email"} and nothing else.',
  model: MODEL,
  maxTokens: 200
})
console.log('   ->', JSON.stringify(c.slice(0, 160)))
ok(typeof c === 'string' && c.length > 0, 'complete() returns non-empty text')
ok(c.includes('['), 'complete() output contains JSON array marker')

// 3) runTurn() round-trip — the core agent loop. A tool is offered; we expect
//    streamed text and/or a tool_use, then we feed a tool_result back and get a
//    final answer. Canonical (Anthropic-shaped) messages throughout.
console.log('\n[3] runTurn()  (agent loop with a tool)')
const tools = [
  {
    name: 'get_case_status',
    description: 'Look up the current status of a legal matter by its case number.',
    inputSchema: {
      type: 'object',
      properties: { caseNumber: { type: 'string', description: 'The case number, e.g. CV-2024-001' } },
      required: ['caseNumber']
    }
  }
]

let streamed = ''
const messages = [
  { role: 'user', content: 'Use the get_case_status tool to look up case CV-2024-001. Call the tool.' }
]
const turn1 = await provider.runTurn({
  system: 'You are a legal assistant. When asked about a case status, you MUST call the get_case_status tool.',
  messages,
  tools,
  serverTools: [],
  model: MODEL,
  maxTokens: 512,
  onText: (d) => { streamed += d },
  signal: new AbortController().signal
})
console.log('   stopReason:', turn1.stopReason, '| toolUses:', turn1.toolUses.length, '| streamedChars:', streamed.length)
if (turn1.toolUses.length) console.log('   toolUse:', JSON.stringify(turn1.toolUses[0]))
ok(Array.isArray(turn1.assistantContent) && turn1.assistantContent.length > 0, 'runTurn returns assistant content blocks')

const calledTool = turn1.toolUses.length > 0
if (calledTool) {
  ok(turn1.toolUses[0].name === 'get_case_status', 'model invoked the offered tool by name')
  ok(turn1.stopReason === 'tool_use', "stopReason is 'tool_use' when a tool was called")

  // Feed a canonical tool_result back (exactly as runAgent does) and continue.
  const tu = turn1.toolUses[0]
  const messages2 = [
    ...messages,
    { role: 'assistant', content: turn1.assistantContent },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'Status: OPEN — discovery phase, next hearing 2026-07-10.' }] }
  ]
  let streamed2 = ''
  const turn2 = await provider.runTurn({
    system: 'You are a legal assistant.',
    messages: messages2,
    tools,
    serverTools: [],
    model: MODEL,
    maxTokens: 512,
    onText: (d) => { streamed2 += d },
    signal: new AbortController().signal
  })
  console.log('   final stopReason:', turn2.stopReason, '| finalChars:', streamed2.length)
  console.log('   final answer:', JSON.stringify(streamed2.slice(0, 200)))
  ok(streamed2.length > 0, 'second turn produced a final text answer from the tool result')
  ok(/open|discovery|hearing|2026/i.test(streamed2), 'final answer reflects the tool_result content')
} else {
  console.log('   (model returned text without calling the tool — streaming path still validated)')
  ok(streamed.length > 0, 'runTurn streamed assistant text (no tool call this run)')
}

rmSync(outFile, { force: true })
console.log(`\n==== ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
