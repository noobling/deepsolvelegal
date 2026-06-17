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

type Emit = (e: IndexEvent) => void

const MAX_TEXT = 200_000
const cancelled = new Set<string>()

export function cancelIndex(collectionId: string): void {
  cancelled.add(collectionId)
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
  cancelled.delete(collectionId)
  const collection = await getCollection(collectionId)
  if (!collection) {
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

    const docs: IndexedDoc[] = []
    const seen = new Set<string>()
    let done = 0

    for (const file of files) {
      if (cancelled.has(collectionId)) break
      seen.add(file)
      done++
      emit({ type: 'index-progress', collectionId, phase: 'Reading documents', done, total: files.length })

      let stat: import('fs').Stats
      try {
        stat = await fs.stat(file)
      } catch {
        continue
      }

      const prev = prevByPath.get(file)
      if (prev && prev.modifiedAt === stat.mtimeMs && prev.size === stat.size && prev.textChars > 0) {
        // Unchanged — reuse its record and existing lexical postings.
        docs.push(prev)
        continue
      }

      const ext = path.extname(file).toLowerCase()
      const id = docIdFor(file)
      const doc: IndexedDoc = {
        id,
        path: file,
        name: path.basename(file),
        ext,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        kind: ext === '.eml' ? 'email' : 'doc',
        textChars: 0
      }

      let body = ''
      try {
        if (ext === '.eml') {
          const m = await parseEmlFile(file)
          doc.from = m.from
          doc.to = m.to
          doc.date = m.date
          doc.subject = m.subject
          body = m.body
        } else {
          const { text } = await extractText(file)
          body = text
          doc.title = path.basename(file, ext)
        }
      } catch {
        body = ''
      }
      body = body.slice(0, MAX_TEXT)
      doc.textChars = body.length

      // Pull reviewer highlights from Word/PDF so they're stored + searchable.
      if (ext === '.docx' || ext === '.pdf') {
        try {
          const hl = await extractHighlights(file)
          if (hl.length) doc.highlights = hl
        } catch {
          /* highlights are best-effort */
        }
      }

      if (prev) removeDoc(lexical, prev.id)
      addDoc(lexical, id, indexableText(doc, body))
      docs.push(doc)
    }

    // Drop docs whose files disappeared.
    for (const prev of prevDocs) {
      if (!seen.has(prev.path)) removeDoc(lexical, prev.id)
    }

    if (collection.aiEnrich && !cancelled.has(collectionId)) {
      await enrich(collection, docs, lexical, emit)
    }

    await saveLexical(collectionId, lexical)
    await saveDocs(collectionId, docs)
    collection.fileCount = docs.length
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
    if (cancelled.has(collection.id)) break
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
