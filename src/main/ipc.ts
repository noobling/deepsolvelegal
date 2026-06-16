import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  AgentEvent,
  Collection,
  CreateCollectionInput,
  ExportInput,
  ExportResult,
  IndexedDoc,
  IndexEvent,
  PermissionDecision,
  SendMessageInput,
  Settings,
  StartThreadInput
} from '@shared/types'
import {
  deleteMatter,
  getMatter,
  getSettings,
  listMatters,
  setSettings
} from './storage/store'
import { clearApiKey, hasApiKey, setApiKey } from './secureKey'
import { getProvider } from './agent/provider'
import { createOllamaProvider } from './agent/ollama'
import { cancel, sendMessage, startThread } from './agent/runAgent'
import { resolvePermission } from './permissions'
import { markdownToDocx, markdownToPdf, markdownToXlsx, markdownToTrackedDocx, rowsToXlsx } from './export/convert'
import { getDocument } from './storage/store'
import {
  deleteCollection,
  getCollectionDetail,
  getDocs,
  listCollections,
  saveCollection
} from './library/store'
import { buildIndex, cancelIndex } from './library/indexer'
import { searchCollection } from './library/search'
import { extractText } from './library/extract'
import { estimateTokens } from '@shared/pricing'

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '-').slice(0, 80)
}

/** Build the index table (header + rows + a Markdown rendering) from indexed docs. */
function indexTable(docs: IndexedDoc[]): { header: string[]; rows: string[][]; markdown: string } {
  const hasEmail = docs.some((d) => d.kind === 'email')
  const header = hasEmail
    ? ['Date', 'From', 'To', 'Subject', 'Type', 'Summary', 'File']
    : ['Name', 'Type', 'Date', 'Summary', 'File']
  const rows = docs.map((d) =>
    hasEmail
      ? [d.date || '', d.from || '', d.to || '', d.subject || d.title || d.name, d.docType || '', d.summary || '', d.path]
      : [d.name, d.docType || d.ext, d.date || '', d.summary || '', d.path]
  )
  const esc = (c: string): string => c.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const markdown = [
    '| ' + header.join(' | ') + ' |',
    '| ' + header.map(() => '---').join(' | ') + ' |',
    ...rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |')
  ].join('\n')
  return { header, rows, markdown }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (e: AgentEvent): void => {
    getWindow()?.webContents.send('agent:event', e)
  }

  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch))
  ipcMain.handle('settings:pickMatterRoot', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  // API key / provider readiness
  ipcMain.handle('key:status', async () => {
    const settings = await getSettings()
    // For the local provider there's no key to set — readiness is the Ollama side.
    return { present: settings.provider === 'ollama' ? true : await hasApiKey() }
  })
  ipcMain.handle('key:set', async (_e, apiKey: string) => {
    await setApiKey(apiKey)
    return { present: await hasApiKey() }
  })
  ipcMain.handle('key:clear', async () => {
    await clearApiKey()
    return { present: await hasApiKey() }
  })
  ipcMain.handle('key:test', async () => {
    const settings = await getSettings()
    return getProvider(settings).test()
  })
  ipcMain.handle('ollama:models', async () => {
    const settings = await getSettings()
    const p = createOllamaProvider(settings.ollamaBaseUrl || 'http://127.0.0.1:11434')
    return p.listModels ? p.listModels() : []
  })

  // Matters
  ipcMain.handle('matters:list', () => listMatters())
  ipcMain.handle('matters:get', (_e, id: string) => getMatter(id))
  ipcMain.handle('matters:delete', (_e, id: string) => deleteMatter(id))
  // The matter's document rendered as a tracked-changes .docx (base64) for SuperDoc.
  ipcMain.handle('matters:documentDocx', async (_e, id: string): Promise<string> => {
    const text = await getDocument(id)
    if (!text.trim()) return ''
    return (await markdownToTrackedDocx(text)).toString('base64')
  })

  // Agent
  ipcMain.handle('agent:start', (_e, input: StartThreadInput) => startThread(input, emit))
  ipcMain.handle('agent:send', (_e, input: SendMessageInput) => sendMessage(input, emit))
  ipcMain.handle('agent:cancel', (_e, matterId: string) => cancel(matterId))
  ipcMain.on('agent:resolvePermission', (_e, requestId: string, decision: PermissionDecision) =>
    resolvePermission(requestId, decision)
  )

  // Files
  ipcMain.handle('files:pick', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'xlsx', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle('files:reveal', (_e, p: string) => {
    shell.showItemInFolder(p)
  })
  // Estimate the prompt-token cost of attaching these documents (extract text, ~4 chars/token).
  ipcMain.handle('files:estimateTokens', async (_e, paths: string[]): Promise<number> => {
    let tokens = 0
    for (const p of paths ?? []) {
      try {
        tokens += estimateTokens((await extractText(p)).text)
      } catch {
        /* unreadable file — skip */
      }
    }
    return tokens
  })

  // Export deliverable
  ipcMain.handle('export', async (_e, input: ExportInput): Promise<ExportResult> => {
    try {
      const matter = await getMatter(input.matterId)
      if (!matter) return { ok: false, error: 'Matter not found.' }
      // Prefer the stored document (the work product, edited in place); fall back
      // to the referenced message for table/other deliverables.
      const msg = matter.messages.find((m) => m.id === input.messageId)
      const content = matter.document?.trim() ? matter.document : msg?.text
      if (!content) return { ok: false, error: 'Nothing to export yet.' }
      const settings = await getSettings()
      const dir = settings.matterRoot
      await fs.mkdir(dir, { recursive: true })
      const base = sanitize(matter.title)
      let buf: Buffer
      let ext: string
      if (input.format === 'docx') {
        buf = await markdownToDocx(content, matter.title)
        ext = 'docx'
      } else if (input.format === 'pdf') {
        buf = await markdownToPdf(content, matter.title)
        ext = 'pdf'
      } else {
        buf = await markdownToXlsx(content, matter.title.slice(0, 28))
        ext = 'xlsx'
      }
      const outPath = path.join(dir, `${base}.${ext}`)
      await fs.writeFile(outPath, buf)
      shell.showItemInFolder(outPath)
      return { ok: true, path: outPath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // Library / document index
  const emitIndex = (e: IndexEvent): void => {
    getWindow()?.webContents.send('index:event', e)
  }

  ipcMain.handle('library:list', () => listCollections())
  ipcMain.handle('library:get', (_e, id: string) => getCollectionDetail(id))
  ipcMain.handle('library:delete', (_e, id: string) => {
    cancelIndex(id)
    return deleteCollection(id)
  })
  ipcMain.handle('library:cancel', (_e, id: string) => cancelIndex(id))
  ipcMain.handle('library:reindex', (_e, id: string) => {
    void buildIndex(id, emitIndex)
  })
  ipcMain.handle('library:search', (_e, id: string, query: string) => searchCollection(id, query, 100))
  ipcMain.handle('library:pickFolders', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'] })
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle('library:create', async (_e, input: CreateCollectionInput): Promise<Collection> => {
    const now = Date.now()
    const id = 'col_' + now.toString(36) + Math.random().toString(36).slice(2, 6)
    const c: Collection = {
      id,
      name: input.name || 'Untitled collection',
      folders: input.folders,
      createdAt: now,
      updatedAt: now,
      fileCount: 0,
      status: 'indexing',
      aiEnrich: !!input.aiEnrich
    }
    await saveCollection(c)
    void buildIndex(id, emitIndex)
    return c
  })
  ipcMain.handle('library:export', async (_e, id: string, format: 'xlsx' | 'docx'): Promise<ExportResult> => {
    try {
      const detail = await getCollectionDetail(id)
      if (!detail) return { ok: false, error: 'Collection not found.' }
      const settings = await getSettings()
      await fs.mkdir(settings.matterRoot, { recursive: true })
      const base = sanitize('Index - ' + detail.name)
      const { header, rows, markdown } = indexTable(detail.docs)
      let buf: Buffer
      let ext: string
      if (format === 'docx') {
        buf = await markdownToDocx(`Document Index — ${detail.name}\n\n${markdown}`)
        ext = 'docx'
      } else {
        buf = await rowsToXlsx([header, ...rows], detail.name.slice(0, 28))
        ext = 'xlsx'
      }
      const outPath = path.join(settings.matterRoot, `${base}.${ext}`)
      await fs.writeFile(outPath, buf)
      shell.showItemInFolder(outPath)
      return { ok: true, path: outPath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
