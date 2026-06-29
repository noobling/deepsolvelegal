import { app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import type {
  Matter,
  MatterDetail,
  Settings,
  ThreadMessage,
  ToolActivity
} from '@shared/types'

const userData = () => app.getPath('userData')
const settingsPath = () => path.join(userData(), 'settings.json')
const mattersDir = () => path.join(userData(), 'matters')

function defaultSettings(): Settings {
  return {
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: '',
    matterRoot: path.join(app.getPath('documents'), 'Quantum Law Group'),
    profile: '',
    autoApproveReads: true,
    documentEditor: 'superdoc'
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return { ...fallback, ...(JSON.parse(raw) as T) }
  } catch {
    return fallback
  }
}

// Crash-safe write: temp file + atomic rename, so the app closing mid-write can't leave a
// truncated (corrupt) settings/matter file. See the note in library/store.ts.
let writeSeq = 0
async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${writeSeq++}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

// ───────────────────────── Settings ─────────────────────────

export async function getSettings(): Promise<Settings> {
  return readJson(settingsPath(), defaultSettings())
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await writeJson(settingsPath(), next)
  return next
}

// ───────────────────────── Matters ─────────────────────────

interface MatterMeta extends Matter {}

interface ThreadFile {
  messages: ThreadMessage[]
  activities: ToolActivity[]
  /** The work product shown in the document pane (edited in place by apply_redline). */
  document?: string
}

function matterPath(id: string): string {
  return path.join(mattersDir(), id)
}

export function matterFilesDir(id: string): string {
  return path.join(matterPath(id), 'files')
}

export async function createMatter(meta: Omit<Matter, 'folder'>): Promise<Matter> {
  const folder = matterPath(meta.id)
  await ensureDir(path.join(folder, 'files'))
  const full: Matter = { ...meta, folder }
  await writeJson(path.join(folder, 'meta.json'), full)
  await writeJson(path.join(folder, 'thread.json'), { messages: [], activities: [] } as ThreadFile)
  return full
}

export async function listMatters(): Promise<Matter[]> {
  const dir = mattersDir()
  if (!existsSync(dir)) return []
  const ids = await fs.readdir(dir)
  const out: Matter[] = []
  for (const id of ids) {
    const metaFile = path.join(dir, id, 'meta.json')
    if (existsSync(metaFile)) {
      try {
        out.push(JSON.parse(await fs.readFile(metaFile, 'utf8')) as Matter)
      } catch {
        /* skip corrupt */
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getMatter(id: string): Promise<MatterDetail | null> {
  const metaFile = path.join(matterPath(id), 'meta.json')
  if (!existsSync(metaFile)) return null
  const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Matter
  const thread = await readJson<ThreadFile>(path.join(matterPath(id), 'thread.json'), {
    messages: [],
    activities: []
  })
  return { ...meta, ...thread }
}

export async function deleteMatter(id: string): Promise<void> {
  const folder = matterPath(id)
  if (existsSync(folder)) await fs.rm(folder, { recursive: true, force: true })
}

async function loadThread(id: string): Promise<ThreadFile> {
  return readJson<ThreadFile>(path.join(matterPath(id), 'thread.json'), {
    messages: [],
    activities: []
  })
}

async function saveThread(id: string, thread: ThreadFile): Promise<void> {
  await writeJson(path.join(matterPath(id), 'thread.json'), thread)
  // bump updatedAt on meta
  const metaFile = path.join(matterPath(id), 'meta.json')
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as Matter
    meta.updatedAt = Date.now()
    await writeJson(metaFile, meta)
  }
}

export async function appendMessage(id: string, message: ThreadMessage): Promise<void> {
  const thread = await loadThread(id)
  thread.messages.push(message)
  await saveThread(id, thread)
}

export async function updateMessageText(id: string, messageId: string, text: string): Promise<void> {
  const thread = await loadThread(id)
  const m = thread.messages.find((x) => x.id === messageId)
  if (m) {
    m.text = text
    await saveThread(id, thread)
  }
}

export async function getDocument(id: string): Promise<string> {
  return (await loadThread(id)).document ?? ''
}

export async function setDocument(id: string, text: string): Promise<void> {
  const thread = await loadThread(id)
  thread.document = text
  await saveThread(id, thread)
}

export async function appendActivity(id: string, activity: ToolActivity): Promise<void> {
  const thread = await loadThread(id)
  thread.activities.push(activity)
  await saveThread(id, thread)
}

// Raw Anthropic message history (tool_use/tool_result blocks) for context.
// Stored separately from the UI thread; typed as unknown[] to avoid coupling.
export async function getApiMessages(id: string): Promise<unknown[]> {
  const file = path.join(matterPath(id), 'api.json')
  return readJson<{ messages: unknown[] }>(file, { messages: [] }).then((d) => d.messages)
}

export async function setApiMessages(id: string, messages: unknown[]): Promise<void> {
  await writeJson(path.join(matterPath(id), 'api.json'), { messages })
}

export async function finishActivity(
  id: string,
  activityId: string,
  ok: boolean,
  summary: string
): Promise<void> {
  const thread = await loadThread(id)
  const a = thread.activities.find((x) => x.id === activityId)
  if (a) {
    a.ok = ok
    a.summary = summary
    a.endedAt = Date.now()
    await saveThread(id, thread)
  }
}
