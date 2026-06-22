import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  AgentEvent,
  Collection,
  CollectionDetail,
  CreateCollectionInput,
  DirEntry,
  ExportInput,
  ExportResult,
  FilePreview,
  ImportRulesResult,
  IndexedDoc,
  IndexEvent,
  PreviewKind,
  PermissionDecision,
  ProcessFeatures,
  ProcessingRules,
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

/** Record (and prune) the display path for a "just this file" keep/exclude rule. The
 *  map is keyed by fingerprint and only kept for fingerprints still in a rule list. */
function mergeAttachmentPath(c: Collection, record?: { fp: string; path: string }): void {
  const map = { ...(c.attachmentPaths ?? {}) }
  if (record && record.fp && record.path) map[record.fp] = record.path
  const live = new Set([...(c.keepAttachments ?? []), ...(c.excludeFingerprints ?? [])])
  for (const k of Object.keys(map)) if (!live.has(k)) delete map[k]
  c.attachmentPaths = map
}

// Apply an imported `.dslrules.json` to a collection in place. Only fields the file carries
// are applied, so a partial/older file leaves settings it doesn't know about untouched.
// Shared by importRules (into an existing set) and create (a new set built from a config).
function applyRulesToCollection(c: Collection, rules: ProcessingRules): void {
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.map((s) => String(s).trim()).filter(Boolean))) : []
  if (rules.features) {
    c.features = rules.features
    c.aiEnrich = !!rules.features.aiEnrich
  }
  if ('bates' in rules) c.bates = rules.bates ?? undefined
  c.combineAttachments = true // attachments are always merged into the email PDF now
  if ('separateAttachments' in rules) c.separateAttachments = !!rules.separateAttachments
  if ('itemNumbering' in rules) c.itemNumbering = !!rules.itemNumbering
  if ('excludeSignatures' in rules) c.excludeSignatures = !!rules.excludeSignatures
  if ('excludeAttachments' in rules) c.excludeAttachments = strList(rules.excludeAttachments)
  if ('excludeFingerprints' in rules) c.excludeFingerprints = strList(rules.excludeFingerprints)
  if ('keepAttachments' in rules) c.keepAttachments = strList(rules.keepAttachments)
  if ('keepNames' in rules) c.keepNames = strList(rules.keepNames)
  if (rules.attachmentPaths && typeof rules.attachmentPaths === 'object') {
    // Keep only paths that still pair with a live fingerprint rule.
    const live = new Set([...(c.keepAttachments ?? []), ...(c.excludeFingerprints ?? [])])
    c.attachmentPaths = Object.fromEntries(Object.entries(rules.attachmentPaths).filter(([fp]) => live.has(fp)))
  }
}
import { getProvider } from './agent/provider'
import { createOllamaProvider } from './agent/ollama'
import { cancel, sendMessage, startThread } from './agent/runAgent'
import { resolvePermission } from './permissions'
import { markdownToDocx, markdownToPdf, markdownToXlsx, markdownToTrackedDocx, rowsToXlsx } from './export/convert'
import { getDocument } from './storage/store'
import {
  deleteCollection,
  getCollection,
  getCollectionDetail,
  getDocs,
  listCollections,
  saveCollection
} from './library/store'
import { buildIndex, cancelIndex, pauseIndex, isRunning } from './library/indexer'
import { previewExcludedFingerprints, previewKeptFingerprints } from './export/production'
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

/** Flatten reviewer highlights across a collection into export rows. */
function highlightTable(docs: IndexedDoc[]): { header: string[]; rows: string[][] } {
  const header = ['Document', 'Page', 'Colour', 'Highlight', 'Context']
  const rows: string[][] = []
  for (const d of docs) {
    for (const h of d.highlights || []) {
      rows.push([d.name, h.page != null ? String(h.page) : '', h.color, h.text, h.context || ''])
    }
  }
  return { header, rows }
}

/** Minimal RFC-4180 CSV serialiser. */
function toCsv(rows: string[][]): string {
  const cell = (c: string): string => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
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

  // Write the document as a tracked-changes .docx and open it in the OS's default
  // editor (Microsoft Word on Windows) for high-fidelity editing.
  ipcMain.handle('matters:openInWord', async (_e, id: string): Promise<ExportResult> => {
    try {
      const matter = await getMatter(id)
      if (!matter) return { ok: false, error: 'Matter not found.' }
      const text = matter.document?.trim()
        ? matter.document
        : [...matter.messages].reverse().find((m) => m.role === 'assistant' && m.text.trim())?.text
      if (!text) return { ok: false, error: 'Nothing to open yet.' }
      const settings = await getSettings()
      await fs.mkdir(settings.matterRoot, { recursive: true })
      const outPath = path.join(settings.matterRoot, `${sanitize(matter.title)}.docx`)
      await fs.writeFile(outPath, await markdownToTrackedDocx(text, matter.title))
      const err = await shell.openPath(outPath)
      if (err) return { ok: false, error: err }
      return { ok: true, path: outPath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
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
  // List a directory's immediate children (dirs first, then files; both A→Z).
  ipcMain.handle('files:listDir', async (_e, dir: string): Promise<DirEntry[]> => {
    let ents: import('fs').Dirent[]
    try {
      ents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: DirEntry[] = []
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue // skip dotfiles (.DS_Store etc.)
      const full = path.join(dir, ent.name)
      const isDir = ent.isDirectory()
      let size = 0
      if (!isDir) {
        try {
          size = (await fs.stat(full)).size
        } catch {
          /* unreadable — leave 0 */
        }
      }
      out.push({ name: ent.name, path: full, isDir, size, ext: isDir ? '' : path.extname(ent.name).toLowerCase() })
    }
    out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return out
  })
  // Aggregate file/folder counts under a set of root paths (a source set's input
  // folders, or the produced bundle). Counts descendants only: a directory passed as
  // a root is the container shown in the tree, so it isn't itself tallied; a file
  // passed as a root counts as one file. Dotfiles (.DS_Store, .restore-map.json …)
  // are skipped, matching files:listDir. Walked natively with bounded concurrency so a
  // deep produced tree counts in one fast round-trip instead of many renderer IPCs.
  ipcMain.handle('files:countTree', async (_e, paths: string[]): Promise<{ files: number; folders: number }> => {
    let files = 0
    let folders = 0
    const queue: string[] = []
    for (const p of paths) {
      try {
        const s = await fs.stat(p)
        if (s.isDirectory()) queue.push(p)
        else files++
      } catch {
        /* unreadable root — skip */
      }
    }
    let head = 0
    let active = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (head >= queue.length) {
          if (active === 0) return
          await new Promise((r) => setTimeout(r, 0))
          continue
        }
        const dir = queue[head++]
        active++
        try {
          const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
          for (const ent of ents) {
            if (ent.name.startsWith('.')) continue
            if (ent.isDirectory()) {
              folders++
              queue.push(path.join(dir, ent.name))
            } else files++
          }
        } finally {
          active--
        }
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => worker()))
    return { files, folders }
  })
  // Lightweight type/size probe for a path (used to render source roots as
  // either a folder or a single file in the explorer).
  ipcMain.handle('files:stat', async (_e, p: string): Promise<{ isDir: boolean; size: number } | null> => {
    try {
      const s = await fs.stat(p)
      return { isDir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size }
    } catch {
      return null
    }
  })
  // Render a Microsoft Office document (docx/xlsx/pptx) to an HTML fragment for
  // inline preview (Office formats have no native viewer in Electron).
  ipcMain.handle('files:renderOffice', async (_e, p: string): Promise<{ ok: boolean; html?: string; error?: string }> => {
    const { renderOfficeHtml } = await import('./library/officeHtml')
    return renderOfficeHtml(p)
  })
  // Read a file for inline preview. PDFs/images come back base64, text as utf8.
  // Anything bigger than the cap (or an unknown type) is left for Reveal in Explorer.
  ipcMain.handle('files:read', async (_e, p: string): Promise<FilePreview> => {
    const CAP = 25 * 1024 * 1024 // 25 MB — beyond this, previewing in-renderer is wasteful
    const ext = path.extname(p).toLowerCase()
    const imageMime: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml'
    }
    const textExts = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.htm', '.eml', '.rtf', '.tsv', '.yml', '.yaml'])
    const kind: PreviewKind = ext === '.pdf' ? 'pdf' : imageMime[ext] ? 'image' : textExts.has(ext) ? 'text' : 'unsupported'
    let size = 0
    try {
      size = (await fs.stat(p)).size
    } catch (e) {
      return { ok: false, kind, mime: '', size: 0, data: '', error: (e as Error).message }
    }
    if (kind === 'unsupported') return { ok: true, kind, mime: '', size, data: '' }
    if (size > CAP) return { ok: true, kind, mime: '', size, data: '', tooLarge: true }
    try {
      const buf = await fs.readFile(p)
      if (kind === 'text') return { ok: true, kind, mime: 'text/plain', size, data: buf.toString('utf8') }
      const mime = kind === 'pdf' ? 'application/pdf' : imageMime[ext]
      return { ok: true, kind, mime, size, data: buf.toString('base64') }
    } catch (e) {
      return { ok: false, kind, mime: '', size, data: '', error: (e as Error).message }
    }
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

  // A set persisted as 'indexing' with no run actually in flight (this process never started
  // one, or a prior run was interrupted by an app quit/crash) is stuck showing "processing…"
  // forever. Heal it back to 'ready' so it's usable again; re-running re-processes as normal.
  const healOrphanedStatus = async (c: Collection): Promise<void> => {
    if (c.status === 'indexing' && !isRunning(c.id)) {
      c.status = 'ready'
      await saveCollection(c)
    }
  }
  ipcMain.handle('library:list', async () => {
    const cols = await listCollections()
    for (const c of cols) await healOrphanedStatus(c)
    return cols
  })
  ipcMain.handle('library:get', async (_e, id: string) => {
    const c = await getCollection(id)
    if (c) await healOrphanedStatus(c)
    return getCollectionDetail(id)
  })
  ipcMain.handle('library:delete', (_e, id: string) => {
    cancelIndex(id)
    return deleteCollection(id)
  })
  ipcMain.handle('library:cancel', (_e, id: string) => cancelIndex(id))
  ipcMain.handle('library:pause', (_e, id: string) => pauseIndex(id))
  ipcMain.handle('library:resume', (_e, id: string) => {
    void buildIndex(id, emitIndex)
  })
  ipcMain.handle('library:reindex', (_e, id: string) => {
    void buildIndex(id, emitIndex)
  })
  ipcMain.handle('library:search', (_e, id: string, query: string) => searchCollection(id, query, 100))
  // Replace the excluded-attachment filename list. Persisted now; applied on the
  // next re-run (the production reads collection.excludeAttachments).
  ipcMain.handle('library:setExcluded', async (_e, id: string, names: string[]): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    const clean = Array.from(new Set((names ?? []).map((s) => s.trim()).filter(Boolean)))
    c.excludeAttachments = clean
    await saveCollection(c)
    return getCollectionDetail(id)
  })
  // Replace the restored-attachment fingerprint list (name|size). Persisted now;
  // applied on the next re-run (these attachments are never excluded again).
  ipcMain.handle('library:setKept', async (_e, id: string, fingerprints: string[], record?: { fp: string; path: string }): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.keepAttachments = Array.from(new Set((fingerprints ?? []).map((s) => s.trim()).filter(Boolean)))
    mergeAttachmentPath(c, record)
    await saveCollection(c)
    return getCollectionDetail(id)
  })
  // Replace the per-file exclude list (name|size fingerprints) — "exclude just this file".
  ipcMain.handle('library:setExcludedFps', async (_e, id: string, fingerprints: string[], record?: { fp: string; path: string }): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.excludeFingerprints = Array.from(new Set((fingerprints ?? []).map((s) => s.trim()).filter(Boolean)))
    mergeAttachmentPath(c, record)
    await saveCollection(c)
    return getCollectionDetail(id)
  })
  // Replace the keep-by-name list — "keep all of this name" (overrides exclusion).
  ipcMain.handle('library:setKeptNames', async (_e, id: string, names: string[]): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.keepNames = Array.from(new Set((names ?? []).map((s) => s.trim()).filter(Boolean)))
    await saveCollection(c)
    return getCollectionDetail(id)
  })
  // The attachment fingerprints (name|size) the CURRENT rules would exclude — so the file
  // tree can flag every matching copy (any filename) before a re-run. Content-based, so it
  // covers renamed/re-encoded copies the renderer can't detect on its own.
  ipcMain.handle('library:resolveExcluded', async (_e, id: string): Promise<string[]> => {
    const c = await getCollection(id)
    if (!c) return []
    try {
      return await previewExcludedFingerprints(c, await getDocs(id))
    } catch {
      return []
    }
  })
  // Fingerprints the current KEEP rules would restore — including perceptually-similar
  // copies — so the tree can show that restoring one excluded image restores its twins too.
  ipcMain.handle('library:resolveKept', async (_e, id: string): Promise<string[]> => {
    const c = await getCollection(id)
    if (!c) return []
    try {
      return await previewKeptFingerprints(c, await getDocs(id))
    } catch {
      return []
    }
  })
  // Change which deliverables this set produces (review index, load file, highlights,
  // AI summaries, PDF conversion). Persisted now; the next re-run produces the newly
  // enabled outputs. Adding a report-only output (review index / load file / highlights)
  // doesn't re-render PDFs — only the render-scope flags are in the production configKey.
  ipcMain.handle('library:setFeatures', async (_e, id: string, features: ProcessFeatures): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.features = features
    await saveCollection(c)
    return getCollectionDetail(id)
  })

  // Toggle whether an existing set ALSO keeps attachments as separate native files
  // (they're always merged into the email PDF regardless). Persisted now; the next Re-run
  // re-renders the production (the flag is in the production configKey, so toggling rebuilds
  // every family and sweeps loose copies a prior "separate" run left behind). `combine` is
  // accepted for signature stability but ignored — combining is always on.
  ipcMain.handle('library:setAttachmentMode', async (_e, id: string, _combine: boolean, separate: boolean): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.combineAttachments = true
    c.separateAttachments = !!separate
    await saveCollection(c)
    return getCollectionDetail(id)
  })

  // Toggle per-family item-number prefixes on produced documents. Persisted now; the next
  // Re-run re-renders the production (itemNumbering is in the configKey, so toggling renames
  // every document and the sweep clears the old un-prefixed copies).
  ipcMain.handle('library:setItemNumbering', async (_e, id: string, enabled: boolean): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    c.itemNumbering = !!enabled
    await saveCollection(c)
    return getCollectionDetail(id)
  })

  // Export this set's processing rules (deliverables, Bates, attachment handling, and
  // the hand-curated exclude/keep lists) to a portable `.dslrules.json` file, so they
  // can be reused on another set instead of rebuilt by hand.
  ipcMain.handle('library:exportRules', async (_e, id: string): Promise<ExportResult> => {
    try {
      const c = await getCollection(id)
      if (!c) return { ok: false, error: 'Collection not found.' }
      const rules: ProcessingRules = {
        version: 1,
        exportedFrom: c.name,
        exportedAt: Date.now(),
        features: c.features,
        bates: c.bates ?? null,
        combineAttachments: true,
        separateAttachments: !!c.separateAttachments,
        itemNumbering: !!c.itemNumbering,
        excludeSignatures: !!c.excludeSignatures,
        excludeAttachments: c.excludeAttachments ?? [],
        excludeFingerprints: c.excludeFingerprints ?? [],
        keepAttachments: c.keepAttachments ?? [],
        keepNames: c.keepNames ?? [],
        attachmentPaths: c.attachmentPaths ?? {}
      }
      const win = getWindow()
      const res = await dialog.showSaveDialog(win!, {
        title: 'Export processing rules',
        defaultPath: `${sanitize(c.name)} rules.dslrules.json`,
        filters: [{ name: 'DeepSolve rules', extensions: ['dslrules.json', 'json'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, error: 'Cancelled.' }
      await fs.writeFile(res.filePath, JSON.stringify(rules, null, 2), 'utf8')
      shell.showItemInFolder(res.filePath)
      return { ok: true, path: res.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // Import a `.dslrules.json` file into this set: replace the processing rules with the
  // ones in the file. Only fields present in the file are applied, so an older file
  // missing (say) `features` leaves the set's deliverables untouched. The source set's
  // folders/output/name are never touched. Applied now; takes effect on the next re-run.
  ipcMain.handle('library:importRules', async (_e, id: string): Promise<ImportRulesResult> => {
    const win = getWindow()
    const c = await getCollection(id)
    if (!c) return { ok: false, error: 'Collection not found.' }
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import processing rules',
      properties: ['openFile'],
      filters: [{ name: 'DeepSolve rules', extensions: ['dslrules.json', 'json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true }
    let rules: ProcessingRules
    try {
      rules = JSON.parse(await fs.readFile(res.filePaths[0], 'utf8'))
    } catch {
      const error = "That file isn't valid JSON, so it can't be a rules file."
      await dialog.showMessageBox(win!, { type: 'error', message: 'Import failed', detail: error })
      return { ok: false, error }
    }
    if (!rules || typeof rules !== 'object' || rules.version !== 1) {
      const error = 'This file is not a DeepSolve rules file (version 1).'
      await dialog.showMessageBox(win!, { type: 'error', message: 'Import failed', detail: error })
      return { ok: false, error }
    }
    applyRulesToCollection(c, rules)
    await saveCollection(c)
    const ruleCount =
      (c.excludeAttachments?.length ?? 0) +
      (c.excludeFingerprints?.length ?? 0) +
      (c.keepAttachments?.length ?? 0) +
      (c.keepNames?.length ?? 0)
    return { ok: true, detail: await getCollectionDetail(id), ruleCount }
  })
  // Pick + parse a `.dslrules.json` for the create dialog (no set exists yet). Returns the
  // parsed rules so the renderer can pre-fill the form; the rules are applied to the new set
  // when it's created (CreateCollectionInput.importedRules).
  ipcMain.handle('library:pickRules', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import processing rules',
      properties: ['openFile'],
      filters: [{ name: 'DeepSolve rules', extensions: ['dslrules.json', 'json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true }
    let rules: ProcessingRules
    try {
      rules = JSON.parse(await fs.readFile(res.filePaths[0], 'utf8'))
    } catch {
      return { ok: false, error: "That file isn't valid JSON, so it can't be a rules file." }
    }
    if (!rules || typeof rules !== 'object' || rules.version !== 1) {
      return { ok: false, error: 'This file is not a DeepSolve rules file (version 1).' }
    }
    return { ok: true, rules, fileName: path.basename(res.filePaths[0]) }
  })
  ipcMain.handle('library:pickFolders', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'] })
    return res.canceled ? [] : res.filePaths
  })
  // Pick source inputs: folders AND/OR individual files (macOS shows one dialog
  // that allows both). Used to add more sources to an existing set.
  ipcMain.handle('library:pickSources', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile', 'openDirectory', 'multiSelections'] })
    return res.canceled ? [] : res.filePaths
  })
  // Append source paths (folders or files) to a set; applied on the next re-run.
  ipcMain.handle('library:addSources', async (_e, id: string, paths: string[]): Promise<CollectionDetail | null> => {
    const c = await getCollection(id)
    if (!c) return null
    const add = (paths ?? []).map((p) => p.trim()).filter(Boolean)
    c.folders = Array.from(new Set([...c.folders, ...add]))
    await saveCollection(c)
    return getCollectionDetail(id)
  })
  ipcMain.handle('library:pickOutput', async (): Promise<string | null> => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('library:create', async (_e, input: CreateCollectionInput): Promise<Collection> => {
    const now = Date.now()
    const id = 'col_' + now.toString(36) + Math.random().toString(36).slice(2, 6)
    const features = input.features
    const name = input.name || 'Untitled document set'
    // A set that produces a bundle needs an output folder. Default to the matter
    // folder + the set name so the user never has to pick one.
    const wantsOutput = !!features && (features.emailToPdf || features.reviewIndex || features.loadFile || features.highlights)
    let output = input.output?.trim() || undefined
    if (wantsOutput && !output) {
      const settings = await getSettings()
      output = path.join(settings.matterRoot, sanitize(name))
    }
    const c: Collection = {
      id,
      name,
      folders: input.folders,
      output,
      createdAt: now,
      updatedAt: now,
      fileCount: 0,
      status: 'indexing',
      features,
      bates: input.bates,
      combineAttachments: true,
      separateAttachments: input.separateAttachments,
      itemNumbering: input.itemNumbering,
      excludeSignatures: input.excludeSignatures,
      excludeAttachments: input.excludeAttachments,
      aiEnrich: !!(input.aiEnrich || features?.aiEnrich)
    }
    // A config imported in the create dialog carries the full attachment exclude/keep lists
    // (which the form can't show); apply it over the freshly-built set so they're preserved.
    if (input.importedRules && input.importedRules.version === 1) applyRulesToCollection(c, input.importedRules)
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

  ipcMain.handle('library:exportHighlights', async (_e, id: string, format: 'csv' | 'xlsx'): Promise<ExportResult> => {
    try {
      const detail = await getCollectionDetail(id)
      if (!detail) return { ok: false, error: 'Collection not found.' }
      const { header, rows } = highlightTable(detail.docs)
      if (rows.length === 0) return { ok: false, error: 'No highlights to export.' }
      const settings = await getSettings()
      await fs.mkdir(settings.matterRoot, { recursive: true })
      const base = sanitize('Highlights - ' + detail.name)
      let buf: Buffer
      let ext: string
      if (format === 'csv') {
        buf = Buffer.from('﻿' + toCsv([header, ...rows]), 'utf8') // BOM so Excel reads UTF-8
        ext = 'csv'
      } else {
        buf = await rowsToXlsx([header, ...rows], 'Highlights')
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
