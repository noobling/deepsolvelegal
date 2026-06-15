// Headless end-to-end test of the REAL app pipeline (Electron main process):
// settings store -> getProvider(ollama) -> buildSystemPrompt -> buildTools ->
// runAgent loop -> deliverable persistence. Runs an actual workflow against the
// local Ollama model and prints the streamed deliverable. Bundled with esbuild
// and launched via the electron binary. Uses an isolated temp userData dir so it
// never touches real matters.
import { app } from 'electron'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { setSettings, getSettings, getMatter } from '../src/main/storage/store'
import { startThread } from '../src/main/agent/runAgent'
import { resolvePermission } from '../src/main/permissions'
import type { AgentEvent } from '../src/shared/types'

const log = (...a: unknown[]): void => process.stdout.write(a.join(' ') + '\n')

async function main(): Promise<void> {
  // Isolate storage so the test never collides with real user data.
  const tmp = path.join(os.tmpdir(), 'dsl-app-e2e-' + process.pid)
  app.setPath('userData', tmp)
  await app.whenReady()

  await setSettings({ provider: 'ollama', ollamaModel: 'llama3.2:3b' })
  const s = await getSettings()
  log('settings.provider =', s.provider, '| ollamaModel =', s.ollamaModel)
  log('typeof global fetch =', typeof fetch)

  // Preflight: can the Electron main process reach Ollama at all?
  try {
    const pf = await fetch('http://127.0.0.1:11434/api/tags')
    log('preflight GET /api/tags ->', pf.status)
  } catch (e) {
    const err = e as Error & { cause?: unknown }
    log('preflight GET FAILED:', err.message, '| cause:', String((err.cause as Error)?.message ?? err.cause))
  }
  // POST preflight — mirrors what runTurn does (POST + JSON body + AbortSignal).
  try {
    const ac = new AbortController()
    const pf = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({ model: 'llama3.2:3b', messages: [{ role: 'user', content: 'hi' }], stream: true, options: { num_predict: 1 } })
    })
    log('preflight POST /api/chat ->', pf.status, '| has body:', !!pf.body)
    const reader = pf.body!.getReader()
    let chunks = 0
    for (;;) { const { done } = await reader.read(); if (done) break; chunks++ }
    log('preflight POST streamed chunks:', chunks)
  } catch (e) {
    const err = e as Error & { cause?: unknown }
    log('preflight POST FAILED:', err.message, '| cause:', String((err.cause as Error)?.message ?? JSON.stringify(err.cause)))
  }
  // POST preflight WITH tools — exactly what runTurn sends. Isolates whether the
  // tools payload is what breaks the request in the Electron main process.
  try {
    const ac = new AbortController()
    const pf = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'List the workspace files.' }],
        tools: [
          { type: 'function', function: { name: 'list_dir', description: 'List a directory', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }
        ],
        stream: true,
        options: { num_predict: 256 }
      })
    })
    log('preflight POST+tools ->', pf.status)
    const reader = pf.body!.getReader()
    let chunks = 0
    for (;;) { const { done } = await reader.read(); if (done) break; chunks++ }
    log('preflight POST+tools streamed chunks:', chunks)
  } catch (e) {
    const err = e as Error & { cause?: unknown }
    log('preflight POST+tools FAILED:', err.message, '| cause:', String((err.cause as Error)?.message ?? JSON.stringify(err.cause)))
  }

  let text = ''
  const eventLog: string[] = []
  let matterId = ''

  const done = new Promise<void>((resolve) => {
    const emit = (e: AgentEvent): void => {
      switch (e.type) {
        case 'turn-start':
          eventLog.push('turn-start')
          break
        case 'text':
          text += e.delta
          break
        case 'tool-start':
          eventLog.push('tool-start:' + e.name)
          break
        case 'tool-end':
          eventLog.push('tool-end:' + (e.ok ? 'ok' : 'fail'))
          break
        case 'permission-request':
          eventLog.push('permission-request:' + e.tool + ' -> auto-allow')
          resolvePermission(e.requestId, 'allow')
          break
        case 'error':
          eventLog.push('ERROR:' + e.message)
          resolve()
          break
        case 'done':
          eventLog.push('done')
          resolve()
          break
      }
    }
    void startThread(
      {
        workflowId: 'demand-draft',
        intake: {
          recipient: 'Apex Industrial Supply, Inc.',
          facts:
            'On 2026-03-01 Apex agreed to deliver 500 steel brackets by 2026-04-15 for $42,000 (PO #DS-1188). ' +
            'Nothing was delivered and Apex has not responded to three follow-ups. We demand delivery or a full refund within 14 days.'
        },
        files: []
      },
      emit
    ).then((r) => {
      matterId = r.matterId
      log('startThread -> matterId =', matterId)
    })
  })

  await done

  // Confirm the deliverable was persisted to the matter thread (what the
  // Workspace deliverable pane renders).
  const detail = matterId ? await getMatter(matterId) : null
  const persisted = detail?.messages.find((m) => m.role === 'assistant')?.text ?? ''

  log('\n==== EVENTS ====')
  log(eventLog.join('  ·  '))
  log('\n==== DELIVERABLE (streamed, ' + text.length + ' chars) ====')
  log(text.trim().slice(0, 1400))
  log('\n==== PERSISTED TO MATTER (' + persisted.length + ' chars) ====')
  log(persisted.length ? 'OK — assistant message saved to thread.json' : 'MISSING')

  const ok =
    s.provider === 'ollama' &&
    eventLog.includes('done') &&
    text.trim().length > 100 &&
    persisted.length > 100 &&
    !eventLog.some((x) => x.startsWith('ERROR'))
  log('\n==== RESULT: ' + (ok ? 'PASS' : 'FAIL') + ' ====')

  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  app.exit(ok ? 0 : 1)
}

void main()
