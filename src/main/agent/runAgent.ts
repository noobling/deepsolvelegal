import path from 'path'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import type Anthropic from '@anthropic-ai/sdk'
import type { AgentEvent, StartThreadInput, SendMessageInput } from '@shared/types'
import { workflowById } from '@shared/workflows'
import { getProvider, activeModel } from './provider'
import { buildSystemPrompt } from './systemPrompts'
import { verifyCitations, citationFooter } from './verify'
import { lintDocument, lintFooter } from '../tools/lint'
import { buildTools } from '../tools/registry'
import { extractText, INDEXABLE_EXTENSIONS } from '../library/extract'
import type { ToolContext } from '../tools/types'
import { requestPermission, denyAllPending } from '../permissions'
import {
  appendActivity,
  appendMessage,
  createMatter,
  finishActivity,
  getApiMessages,
  getMatter,
  getSettings,
  matterFilesDir,
  setApiMessages,
  updateMessageText
} from '../storage/store'

type Emit = (e: AgentEvent) => void

const MAX_ITERATIONS = 16

interface ActiveRun {
  controller?: AbortController
  cancelled: boolean
}
const active = new Map<string, ActiveRun>()

let idCounter = 0
function uid(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now()}_${idCounter}`
}

function summarizeIntake(intakeFields: { key: string; label: string }[], intake: Record<string, unknown>, copied: string[]): string {
  const lines: string[] = []
  for (const f of intakeFields) {
    if (f.key === 'files') continue
    const v = intake[f.key]
    if (v != null && String(v).trim()) lines.push(`- ${f.label}: ${String(v)}`)
  }
  if (copied.length) {
    lines.push(`- Attached documents (in the matter workspace): ${copied.map((p) => path.basename(p)).join(', ')}`)
  }
  return lines.join('\n') || '(no additional details provided)'
}

/** Copy attached files into the matter workspace; returns the new paths. */
async function importFiles(matterId: string, files: string[]): Promise<string[]> {
  const dir = matterFilesDir(matterId)
  await fs.mkdir(dir, { recursive: true })
  const out: string[] = []
  for (const src of files) {
    if (!existsSync(src)) continue
    const dest = path.join(dir, path.basename(src))
    try {
      await fs.copyFile(src, dest)
      out.push(dest)
    } catch {
      out.push(src)
    }
  }
  return out
}

/** Concatenate the extractable text of every document in the matter workspace. */
async function gatherSourceText(filesDir: string): Promise<string> {
  let entries: string[]
  try {
    entries = await fs.readdir(filesDir)
  } catch {
    return ''
  }
  const parts: string[] = []
  for (const name of entries) {
    if (!INDEXABLE_EXTENSIONS.includes(path.extname(name).toLowerCase())) continue
    try {
      const { text } = await extractText(path.join(filesDir, name))
      if (text) parts.push(text)
    } catch {
      /* unreadable file — skip */
    }
  }
  return parts.join('\n\n')
}

export async function startThread(input: StartThreadInput, emit: Emit): Promise<{ matterId: string }> {
  const workflow = workflowById(input.workflowId)
  if (!workflow) throw new Error(`Unknown workflow: ${input.workflowId}`)

  const matterId = uid('matter')
  const counterparty =
    (input.intake.counterparty as string) ||
    (input.intake.recipient as string) ||
    (input.intake.deponent as string) ||
    ''
  const title = `${workflow.title}${counterparty ? ` — ${counterparty}` : ''}`

  await createMatter({
    id: matterId,
    title,
    workflowId: workflow.id,
    area: workflow.area,
    outputType: workflow.outputType,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  const copied = await importFiles(matterId, input.files)
  const intakeSummary = summarizeIntake(workflow.intakeFields, input.intake, copied)
  const userText = `Please complete this task.\n\n${intakeSummary}`

  await appendMessage(matterId, { id: uid('msg'), role: 'user', text: userText, createdAt: Date.now() })
  await setApiMessages(matterId, [{ role: 'user', content: userText }])

  // Run asynchronously; events stream back over IPC.
  void runTurn(matterId, emit)
  return { matterId }
}

export async function sendMessage(input: SendMessageInput, emit: Emit): Promise<void> {
  const api = (await getApiMessages(input.matterId)) as Anthropic.MessageParam[]
  api.push({ role: 'user', content: input.text })
  await setApiMessages(input.matterId, api)
  await appendMessage(input.matterId, { id: uid('msg'), role: 'user', text: input.text, createdAt: Date.now() })
  void runTurn(input.matterId, emit)
}

export function cancel(matterId: string): void {
  const run = active.get(matterId)
  if (run) {
    run.cancelled = true
    run.controller?.abort()
  }
  denyAllPending()
}

async function runTurn(matterId: string, emit: Emit): Promise<void> {
  const run: ActiveRun = { cancelled: false }
  active.set(matterId, run)

  try {
    const settings = await getSettings()
    const provider = getProvider(settings)
    const model = activeModel(settings)
    if (!model) {
      emit({
        type: 'error',
        matterId,
        message:
          settings.provider === 'ollama'
            ? 'No local model selected. Pick an Ollama model in Settings.'
            : 'No model selected. Choose a model in Settings.'
      })
      emit({ type: 'done', matterId })
      return
    }

    // Determine workflow from the matter meta (re-read by loading any message context).
    const detail = await getMatter(matterId)
    const workflow = detail ? workflowById(detail.workflowId) : undefined
    if (!workflow) {
      emit({ type: 'error', matterId, message: 'Workflow not found for this matter.' })
      emit({ type: 'done', matterId })
      return
    }

    const { tools, local, serverTools } = buildTools(workflow.tools)
    const system = buildSystemPrompt(workflow, settings, '(see the conversation)')

    const ctx: ToolContext = {
      matterId,
      filesDir: matterFilesDir(matterId),
      matterRoot: settings.matterRoot,
      requestPermission: (title, detailText) =>
        requestPermission({
          matterId,
          tool: title,
          title,
          detail: detailText,
          emit
        })
    }

    const apiMessages = (await getApiMessages(matterId)) as Anthropic.MessageParam[]
    const messageId = uid('msg')
    emit({ type: 'turn-start', matterId, messageId })
    await appendMessage(matterId, { id: messageId, role: 'assistant', text: '', createdAt: Date.now() })

    let assembled = ''

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (run.cancelled) break

      const controller = new AbortController()
      run.controller = controller

      let turn: Awaited<ReturnType<typeof provider.runTurn>>
      try {
        turn = await provider.runTurn({
          system,
          messages: apiMessages,
          tools,
          serverTools,
          model,
          maxTokens: 8000,
          onText: (delta) => {
            assembled += delta
            emit({ type: 'text', matterId, messageId, delta })
          },
          signal: controller.signal
        })
      } catch (e) {
        if (run.cancelled) break
        emit({ type: 'error', matterId, message: (e as Error).message })
        break
      }

      apiMessages.push({ role: 'assistant', content: turn.assistantContent })
      await setApiMessages(matterId, apiMessages)
      await updateMessageText(matterId, messageId, assembled)

      const toolUses = turn.toolUses
      if (turn.stopReason !== 'tool_use' || toolUses.length === 0) {
        break
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        if (run.cancelled) break
        const def = local[tu.name]
        const activityId = uid('act')
        emit({ type: 'tool-start', matterId, messageId, toolId: tu.id, name: tu.name, input: tu.input })
        await appendActivity(matterId, {
          id: activityId,
          name: tu.name,
          input: tu.input,
          startedAt: Date.now()
        })

        if (!def) {
          await finishActivity(matterId, activityId, false, 'Unknown tool')
          emit({ type: 'tool-end', matterId, toolId: tu.id, ok: false, summary: 'Unknown tool' })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool', is_error: true })
          continue
        }

        try {
          const result = await def.run(tu.input as Record<string, unknown>, ctx)
          await finishActivity(matterId, activityId, !result.isError, result.summary)
          emit({ type: 'tool-end', matterId, toolId: tu.id, ok: !result.isError, summary: result.summary })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.content,
            is_error: result.isError
          })
        } catch (e) {
          const msg = (e as Error).message
          await finishActivity(matterId, activityId, false, msg)
          emit({ type: 'tool-end', matterId, toolId: tu.id, ok: false, summary: msg })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${msg}`, is_error: true })
        }
      }

      if (run.cancelled) break
      apiMessages.push({ role: 'user', content: toolResults })
      await setApiMessages(matterId, apiMessages)
    }

    // Deterministic citation check: flag any section reference in the deliverable
    // that does not exist in the source document(s). Catches invented citations
    // (a common local-model failure) without trusting the model to self-check.
    if (!run.cancelled && assembled.trim()) {
      try {
        const source = await gatherSourceText(ctx.filesDir)
        if (source) {
          const deliverable = assembled // the model's output, before our appended checks
          const append = (delta: string): void => {
            assembled += delta
            emit({ type: 'text', matterId, messageId, delta })
          }
          // Run the deterministic linter automatically (don't rely on a weak
          // model to call lint_document) for workflows that opt into it.
          if (workflow.tools.includes('lint_document')) {
            const lf = lintFooter(lintDocument(source))
            if (lf) append(lf)
          }
          // Verify citations in the model's deliverable only — not our footers.
          const cf = citationFooter(verifyCitations(deliverable, source))
          if (cf) append(cf)
        }
      } catch {
        /* checks are best-effort; never block the deliverable */
      }
    }

    await updateMessageText(matterId, messageId, assembled)
    emit({ type: 'turn-end', matterId, messageId })
  } catch (e) {
    emit({ type: 'error', matterId, message: (e as Error).message })
  } finally {
    active.delete(matterId)
    emit({ type: 'done', matterId })
  }
}
