import { promises as fs } from 'fs'
import path from 'path'
import type { Collection, IndexedDoc, IndexEvent } from '@shared/types'
import { INDEXABLE_EXTENSIONS, extractText } from './extract'
import { parseEmlFile } from './email'
import { extractHighlights } from './highlights'
import { addDoc, removeDoc, type LexicalIndex } from './lexical'
import {
  getCollection,
  getDocs,
  getLexical,
  saveCollection,
  saveDocs,
  saveLexical
} from './store'
import { getProvider } from '../agent/provider'
import { getSettings } from '../storage/store'
import { buildProduction } from '../export/production'

type Emit = (e: IndexEvent) => void

const MAX_TEXT = 200_000
// Hard stop (delete) vs. pause (resumable). Both break the loops; only `paused`
// finalizes the collection as 'paused' so a later run resumes from saved state.
const cancelled = new Set<string>()
const paused = new Set<string>()
// Ids with a run in flight — guards against a double resume/re-run for the same
// set (which would clear each other's pause flag and render to the same files).
const running = new Set<string>()

export function cancelIndex(collectionId: string): void {
  cancelled.add(collectionId)
}

export function pauseIndex(collectionId: string): void {
  paused.add(collectionId)
}

function stopped(collectionId: string): boolean {
  return cancelled.has(collectionId) || paused.has(collectionId)
}

function docIdFor(p: string): string {
  let h = 5381
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) | 0
  return 'd' + (h >>> 0).toString(36)
}

/** Recursively collect indexable files under the given folders. */
async function walk(folders: string[]): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string, depth: number): Promise<void> {
    if (depth > 8 || out.length > 50_000) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await recurse(full, depth + 1)
      else if (INDEXABLE_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) out.push(full)
    }
  }
  for (const f of folders) await recurse(f, 0)
  return out
}

/** Combined searchable text for a doc (headers + highlighted passages help search). */
function indexableText(doc: IndexedDoc, body: string): string {
  const highlights = (doc.highlights || []).map((h) => h.text).join('\n')
  return [doc.name, doc.subject, doc.from, doc.to, doc.title, highlights, body].filter(Boolean).join('\n')
}

export async function buildIndex(collectionId: string, emit: Emit): Promise<void> {
  if (running.has(collectionId)) return // a run is already in flight for this set
  running.add(collectionId)
  cancelled.delete(collectionId)
  paused.delete(collectionId)
  const collection = await getCollection(collectionId)
  if (!collection) {
    running.delete(collectionId)
    emit({ type: 'index-error', collectionId, message: 'Collection not found.' })
    return
  }

  collection.status = 'indexing'
  collection.error = undefined
  await saveCollection(collection)

  try {
    const files = await walk(collection.folders)
    const prevDocs = await getDocs(collectionId)
    const prevByPath = new Map(prevDocs.map((d) => [d.path, d]))
    const lexical = await getLexical(collectionId)

    // Pass 1 — build the full document list up front (reuse unchanged docs, make a
    // lightweight skeleton for the rest) and save it immediately, so the set is
    // browsable the moment the folder walk finishes. Content fills in after.
    const docs: IndexedDoc[] = []
    const seen = new Set<string>()
    const pending: { doc: IndexedDoc; prevId?: string }[] = []
    for (const file of files) {
      seen.add(file)
      let stat: import('fs').Stats
      try {
        stat = await fs.stat(file)
      } catch {
        continue
      }
      const prev = prevByPath.get(file)
      if (prev && prev.modifiedAt === stat.mtimeMs && prev.size === stat.size && prev.textChars > 0) {
        docs.push(prev) // already indexed — keep its content + lexical postings
        continue
      }
      const ext = path.extname(file).toLowerCase()
      const doc: IndexedDoc = {
        id: docIdFor(file),
        path: file,
        name: path.basename(file),
        ext,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        kind: ext === '.eml' ? 'email' : 'doc',
        textChars: 0,
        title: ext === '.eml' ? undefined : path.basename(file, ext)
      }
      docs.push(doc)
      pending.push({ doc, prevId: prev?.id })
    }
    collection.fileCount = docs.length
    await saveCollection(collection)
    await saveDocs(collectionId, docs) // <- the whole list is now browsable
    emit({ type: 'index-progress', collectionId, phase: 'Reading documents', done: docs.length - pending.length, total: docs.length })

    // Pass 2 — extract text / parse / highlights for the new docs, streaming
    // progress and re-saving periodically so the list fills in as it goes.
    let done = docs.length - pending.length
    const saveEvery = Math.max(5, Math.floor(pending.length / 20))
    for (const { doc, prevId } of pending) {
      if (stopped(collectionId)) break
      const ext = doc.ext
      let body = ''
      try {
        if (ext === '.eml') {
          const m = await parseEmlFile(doc.path)
          doc.from = m.from
          doc.to = m.to
          doc.date = m.date
          doc.subject = m.subject
          body = m.body
        } else {
          const { text } = await extractText(doc.path)
          body = text
        }
      } catch {
        body = ''
      }
      body = body.slice(0, MAX_TEXT)
      doc.textChars = body.length

      // Pull reviewer highlights from Word/PDF so they're stored + searchable.
      if (ext === '.docx' || ext === '.pdf') {
        try {
          const hl = await extractHighlights(doc.path)
          if (hl.length) doc.highlights = hl
        } catch {
          /* highlights are best-effort */
        }
      }

      if (prevId) removeDoc(lexical, prevId)
      addDoc(lexical, doc.id, indexableText(doc, body))
      done++
      if (done % saveEvery === 0) await saveDocs(collectionId, docs)
      emit({ type: 'index-progress', collectionId, phase: 'Reading documents', done, total: docs.length })
    }

    // Drop docs whose files disappeared.
    for (const prev of prevDocs) {
      if (!seen.has(prev.path)) removeDoc(lexical, prev.id)
    }

    if (collection.aiEnrich && !stopped(collectionId)) {
      await enrich(collection, docs, lexical, emit)
    }

    await saveLexical(collectionId, lexical)
    await saveDocs(collectionId, docs)

    // Production pass: render + index the set into the output folder, per the
    // enabled features. Best-effort relative to the index — a production failure
    // is recorded but doesn't poison the (already saved) searchable index.
    const f = collection.features
    if (collection.output && f && (f.emailToPdf || f.reviewIndex || f.loadFile || f.highlights) && !stopped(collectionId)) {
      try {
        collection.production = await buildProduction(collection, docs, emit, () => stopped(collectionId))
      } catch (e) {
        collection.production = { pdfCount: 0, processed: 0, skipped: 0, removed: 0, slipSheets: 0, excludedAttachments: 0, inconsistentAttachments: 0, errors: [{ file: '(production)', error: (e as Error).message }] }
      }
    }

    // Paused mid-run: keep the partial (saved) state and stop here so a later
    // resume continues. Cancelled (delete) just falls through — the dir is removed.
    if (paused.has(collectionId)) {
      collection.status = 'paused'
      await saveCollection(collection)
      emit({ type: 'index-paused', collectionId })
      return
    }

    collection.status = 'ready'
    await saveCollection(collection)
    emit({ type: 'index-done', collectionId, fileCount: docs.length })
  } catch (e) {
    collection.status = 'error'
    collection.error = (e as Error).message
    await saveCollection(collection)
    emit({ type: 'index-error', collectionId, message: (e as Error).message })
  } finally {
    cancelled.delete(collectionId)
    paused.delete(collectionId)
    running.delete(collectionId)
  }
}

/** Ask Claude (Haiku) to fill summary / docType / parties for docs missing them. */
async function enrich(
  collection: Collection,
  docs: IndexedDoc[],
  lexical: LexicalIndex,
  emit: Emit
): Promise<void> {
  const settings = await getSettings()
  const provider = getProvider(settings)
  const model = settings.provider === 'ollama' ? settings.ollamaModel : 'claude-haiku-4-5-20251001'
  if (!model) return
  const pending = docs.filter((d) => !d.summary)
  const batchSize = 5
  let done = 0
  for (let i = 0; i < pending.length; i += batchSize) {
    if (stopped(collection.id)) break
    const batch = pending.slice(i, i + batchSize)
    const payload = batch.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      subject: d.subject,
      from: d.from,
      to: d.to,
      excerpt: (lexical.snippets[d.id] || '').slice(0, 1500)
    }))
    try {
      const raw = await provider.complete({
        system:
          'You catalog legal documents. For each item return a JSON object with: id, docType (short, e.g. "Email", "NDA", "Invoice", "Letter"), summary (one concise sentence), parties (array of names/orgs mentioned). Respond with ONLY a JSON array, no prose.',
        prompt: JSON.stringify(payload),
        model,
        maxTokens: 1024
      })
      const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
      const parsed = JSON.parse(json) as Array<{
        id: string
        docType?: string
        summary?: string
        parties?: string[]
      }>
      const byId = new Map(parsed.map((p) => [p.id, p]))
      for (const d of batch) {
        const e = byId.get(d.id)
        if (e) {
          d.docType = e.docType
          d.summary = e.summary
          d.parties = e.parties
        }
      }
    } catch {
      /* enrichment is best-effort */
    }
    done += batch.length
    emit({ type: 'index-progress', collectionId: collection.id, phase: 'Summarizing', done, total: pending.length })
  }
}
