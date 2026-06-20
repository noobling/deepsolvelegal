import { promises as fs } from 'fs'
import path from 'path'
import { simpleParser, type ParsedMail } from 'mailparser'
import type { Collection, IndexedDoc, IndexEvent, ProcessFeatures, ProductionResult } from '@shared/types'
import { buildEmailHtml } from './emailHtml'
import { combineFamily, makeRenderWindow, renderInto, safeName, stampBates, toCsv, toDat } from './emailToPdf'
import { renderDocToPdf, slipSheet } from './docToPdf'
import { rowsToXlsx } from './convert'
import { getProductionManifest, saveProductionManifest } from '../library/store'
import {
  HIGHLIGHT_HEADER,
  REVIEW_HEADER,
  LOADFILE_HEADER,
  highlightRows,
  reviewIndexRows,
  loadFileRows,
  productionTargets,
  excludedSummary,
  sameApproxSize,
  type ProdRecord
} from './productionRows'

// Turn an indexed document set into a single Bates-numbered production under the
// output folder, then write the deliverables the enabled features ask for:
//   - review index (xlsx)                       → features.reviewIndex
//   - production load file (.DAT/.CSV)          → features.loadFile
//   - highlights table (xlsx)                  → features.highlights
// A full production (internal/external index) includes EVERY document so it can
// carry a Bates number. With "Convert to PDF" on, each document is rendered to a
// Bates-stamped PDF; with it off, the original native is copied over and given a
// single document-level Bates number (the index/load-file references the native).
// "Convert to PDF" alone (no index) produces just the emails.

type Emit = (e: IndexEvent) => void

const PAD = 6

const addr = (v: ParsedMail['to']): string => (Array.isArray(v) ? v.map((t) => t.text).join('; ') : v?.text) || ''

/** Filename + size of an excluded attachment (no content). */
interface ExcludedMeta {
  name: string
  size: number
}

/** A produced document remembered across runs: its row data + input file state. */
interface ProdItem extends ProdRecord {
  id: string
  path: string
  mtime: number
  size: number
  /** Excluded attachments this doc contributed — so counts stay correct on re-runs. */
  excluded?: ExcludedMeta[]
}

/** An attachment filtered out of the production by filename, kept for review. */
interface ExcludedAtt extends ExcludedMeta {
  content: Buffer
  /** The email it came from (relative path), for the listing. */
  source: string
}

/** A produced PDF + the metadata row it contributes to the indexes. */
async function produceOne(
  win: ReturnType<typeof makeRenderWindow>,
  doc: IndexedDoc,
  outRoot: string,
  rel: string,
  opts: { convert: boolean; combine: boolean; assignBates: boolean; prefix: string; batesStart: number; excludeSignatures: boolean; excludeAttachments: string[]; excludeUnderBytes: number },
  used: Set<string>,
  result: ProductionResult,
  excludedSink: ExcludedAtt[]
): Promise<{ rec: ProdRecord; excludedMeta: ExcludedMeta[] }> {
  const ext = doc.ext
  const base = path.basename(doc.name, ext)
  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  // Produced files live under Documents/ so they never mix with the metadata
  // (review index, load file, highlights), which go in their own folders.
  const docsRoot = path.join(outRoot, 'Documents')
  const batesLabel = (n: number): string => opts.prefix + String(n).padStart(PAD, '0')

  const excludedMeta: ExcludedMeta[] = []

  // Native production ("Convert to PDF" off): copy the original file verbatim and
  // give it ONE document-level Bates number (a native can't be page-stamped), then
  // let the index/load-file reference it. Render-time filtering (signatures,
  // excluded attachments) doesn't apply here — the original is kept intact.
  if (!opts.convert) {
    let from = ''
    let to = ''
    let cc = ''
    let subject = ''
    let date = ''
    let attCount = 0
    let attNames = ''
    if (ext === '.eml') {
      const mail = await simpleParser(await fs.readFile(doc.path))
      from = mail.from?.text || ''
      to = addr(mail.to)
      cc = addr(mail.cc)
      subject = mail.subject || ''
      date = mail.date ? mail.date.toISOString().slice(0, 10) : ''
      const atts = (mail.attachments || []).filter((a) => a.contentDisposition === 'attachment')
      attCount = atts.length
      attNames = atts.map((a) => a.filename || 'attachment').join('; ')
    } else {
      subject = doc.title || base
      date = doc.date || ''
    }
    const folder = path.join(docsRoot, relDir)
    await fs.mkdir(folder, { recursive: true })
    let name = safeName(doc.name)
    while (used.has(path.join(folder, name).toLowerCase())) name = '_' + name
    used.add(path.join(folder, name).toLowerCase())
    const outPath = path.join(folder, name)
    await fs.copyFile(doc.path, outPath)
    const beg = opts.assignBates ? batesLabel(opts.batesStart) : ''
    const rec: ProdRecord = {
      begBates: beg,
      endBates: beg,
      pages: 0,
      batesSpan: 1,
      date,
      from,
      to,
      cc,
      subject,
      docType: doc.docType || (doc.kind === 'email' ? 'Email' : 'Document'),
      kind: doc.kind,
      fileRel: path.relative(outRoot, outPath),
      attCount,
      attNames
    }
    return { rec, excludedMeta }
  }

  let pdf: Buffer
  let from = ''
  let to = ''
  let cc = ''
  let subject = ''
  let date = ''
  let attCount = 0
  let attNames = ''
  let folder: string
  const attachments: { name: string; content: Buffer }[] = []

  if (ext === '.eml') {
    const mail = await simpleParser(await fs.readFile(doc.path))
    const built = buildEmailHtml(mail, { excludeSignatures: opts.excludeSignatures, excludeAttachments: opts.excludeAttachments, excludeUnderBytes: opts.excludeUnderBytes })
    pdf = await renderInto(win, built.html)
    if (opts.combine && built.fileAttachments.length) pdf = await combineFamily(pdf, built.fileAttachments)
    // Excluded-by-filename attachments are routed to Excluded/, not the family folder.
    for (const a of built.excludedAttachments) {
      const meta: ExcludedMeta = { name: a.filename || 'attachment', size: a.content.length }
      excludedMeta.push(meta)
      excludedSink.push({ ...meta, content: a.content, source: rel })
    }
    from = mail.from?.text || ''
    to = addr(mail.to)
    cc = addr(mail.cc)
    subject = mail.subject || ''
    date = mail.date ? mail.date.toISOString().slice(0, 10) : ''
    attCount = built.fileAttachments.length
    attNames = built.fileAttachments.map((a) => a.filename || 'attachment').join('; ')
    for (const a of built.fileAttachments) attachments.push({ name: a.filename || 'attachment', content: a.content })
    // An email with attachments gets its own folder (PDF + native files together).
    folder = attCount > 0 ? path.join(docsRoot, relDir, base) : path.join(docsRoot, relDir)
  } else {
    subject = doc.title || base
    date = doc.date || ''
    folder = path.join(docsRoot, relDir)
    let rendered = await renderDocToPdf(win, doc.path)
    if (!rendered) {
      rendered = await slipSheet(doc.name)
      result.slipSheets++
      // The PDF is only a placeholder — produce the native file alongside it.
      attachments.push({ name: doc.name, content: await fs.readFile(doc.path) })
    } else if (ext === '.xlsx') {
      // Spreadsheets lose fidelity flattened to PDF — keep the native too.
      attachments.push({ name: doc.name, content: await fs.readFile(doc.path) })
    }
    pdf = rendered
  }

  // Bates-stamp the produced PDF; a passthrough PDF that can't be loaded
  // (encrypted/corrupt) falls back to a slip sheet so the sequence stays intact.
  let pages = 0
  let begBates = ''
  let endBates = ''
  if (opts.assignBates) {
    try {
      const s = await stampBates(pdf, opts.batesStart, opts.prefix, PAD)
      pdf = s.bytes
      begBates = s.begin
      endBates = s.end
      pages = s.pages
    } catch {
      const slip = await slipSheet(doc.name)
      result.slipSheets++
      if (!attachments.some((a) => a.name === doc.name)) {
        attachments.push({ name: doc.name, content: await fs.readFile(doc.path) })
      }
      const s = await stampBates(slip, opts.batesStart, opts.prefix, PAD)
      pdf = s.bytes
      begBates = s.begin
      endBates = s.end
      pages = s.pages
    }
  }

  await fs.mkdir(folder, { recursive: true })
  let pdfName = base + '.pdf'
  while (used.has(path.join(folder, pdfName).toLowerCase())) pdfName = '_' + pdfName
  used.add(path.join(folder, pdfName).toLowerCase())
  const outPath = path.join(folder, pdfName)
  await fs.writeFile(outPath, pdf)

  for (const a of attachments) {
    let n = safeName(a.name)
    while (used.has(path.join(folder, n).toLowerCase())) n = '_' + n
    used.add(path.join(folder, n).toLowerCase())
    await fs.writeFile(path.join(folder, n), a.content)
  }

  const rec: ProdRecord = {
    begBates,
    endBates,
    pages,
    batesSpan: pages,
    date,
    from,
    to,
    cc,
    subject,
    docType: doc.docType || (doc.kind === 'email' ? 'Email' : 'Document'),
    kind: doc.kind,
    fileRel: path.relative(outRoot, outPath),
    attCount,
    attNames
  }
  return { rec, excludedMeta }
}

/**
 * Group same-named excluded attachments into size clusters (copies within ±2% are
 * the same document — exact bytes needn't match). One cluster ⇒ consistent.
 */
function clusterBySize(items: ExcludedAtt[]): ExcludedAtt[][] {
  const clusters: ExcludedAtt[][] = []
  for (const it of [...items].sort((a, b) => a.size - b.size)) {
    const last = clusters[clusters.length - 1]
    if (last && sameApproxSize(last[last.length - 1].size, it.size)) last.push(it)
    else clusters.push([it])
  }
  return clusters
}

/**
 * Write excluded attachments to <output>/Excluded/ for review. Copies of a filename
 * whose sizes cluster together (within ±2%) collapse to one representative; a
 * filename whose copies split into two or more size clusters has one representative
 * per cluster written to Excluded/Needs Review/<name>/ — one of them might be a real
 * document misnamed like the boilerplate. A listing spreadsheet records the details.
 * Called only on a full render, when every excluded attachment's content is in hand.
 */
async function writeExcludedFolder(outRoot: string, excluded: ExcludedAtt[]): Promise<void> {
  const dir = path.join(outRoot, 'Excluded')
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) // fresh slate
  if (!excluded.length) return
  await fs.mkdir(dir, { recursive: true })

  const groups = new Map<string, ExcludedAtt[]>()
  for (const e of excluded) {
    const key = e.name.trim().toLowerCase()
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  // Never let two distinct files share an output path (odd characters in a
  // filename, or two clusters with the same byte size) — disambiguate with a "_".
  const used = new Set<string>()
  const uniquePath = (folder: string, name: string): string => {
    let n = safeName(name)
    while (used.has(path.join(folder, n).toLowerCase())) n = '_' + n
    used.add(path.join(folder, n).toLowerCase())
    return path.join(folder, n)
  }
  // The largest copy in a cluster is the most complete version to keep.
  const rep = (cluster: ExcludedAtt[]): ExcludedAtt => cluster[cluster.length - 1]

  const listing: string[][] = [['Filename', 'Copies', 'Distinct sizes', 'Sizes (bytes)', 'Consistent', 'From emails']]
  for (const items of groups.values()) {
    const clusters = clusterBySize(items)
    if (clusters.length === 1) {
      const r = rep(clusters[0])
      await fs.writeFile(uniquePath(dir, r.name), r.content)
    } else {
      const sub = path.join(dir, 'Needs Review', safeName(items[0].name))
      await fs.mkdir(sub, { recursive: true })
      for (const cluster of clusters) {
        const r = rep(cluster)
        const ext = path.extname(r.name)
        await fs.writeFile(uniquePath(sub, `${path.basename(r.name, ext)} (${r.size} bytes)${ext}`), r.content)
      }
    }
    listing.push([
      items[0].name,
      String(items.length),
      String(clusters.length),
      [...new Set(items.map((i) => i.size))].sort((a, b) => a - b).join(', '),
      clusters.length === 1 ? 'yes' : 'NEEDS REVIEW',
      [...new Set(items.map((i) => i.source))].join('; ')
    ])
  }

  await fs.writeFile(path.join(dir, 'Excluded Attachments.xlsx'), await rowsToXlsx(listing, 'Excluded'))
}

export async function buildProduction(
  collection: Collection,
  docs: IndexedDoc[],
  emit: Emit,
  isCancelled: () => boolean
): Promise<ProductionResult> {
  const features = collection.features as ProcessFeatures
  const outRoot = path.resolve(collection.output as string)
  const result: ProductionResult = { pdfCount: 0, processed: 0, skipped: 0, removed: 0, slipSheets: 0, excludedAttachments: 0, inconsistentAttachments: 0, errors: [] }
  const excludeAttachments = collection.excludeAttachments ?? []
  const excludeUnderBytes = Math.max(0, Math.floor((collection.excludeAttachmentsUnderKb ?? 0) * 1024))
  await fs.mkdir(outRoot, { recursive: true })

  // A review index or production includes every doc; "convert to PDF" alone produces
  // just emails. With convert off, documents are copied as natives instead of rendered.
  const fullProduction = features.reviewIndex || features.loadFile
  const convert = features.emailToPdf
  const targets = productionTargets(docs, features).sort((a, b) => a.path.localeCompare(b.path)) // deterministic, contiguous Bates

  // A review index / production needs Bates; default a prefix if the user didn't set one.
  const bates = collection.bates ?? (fullProduction ? { prefix: 'DOC-', start: 1 } : null)
  const assignBates = !!bates
  const prefix = bates?.prefix ?? ''
  let batesNext = bates?.start ?? 1
  const label = (n: number): string => prefix + String(n).padStart(PAD, '0')

  const inRoots = collection.folders.map((f) => path.resolve(f))
  const relFor = (p: string): string => {
    const root = inRoots.find((r) => p === r || p.startsWith(r + path.sep))
    return root ? path.relative(root, p) : path.basename(p)
  }

  // Scan input-vs-output: reuse documents that are unchanged AND would land on the
  // same Bates number; only (re)render new/changed docs (or ones whose numbering
  // shifted because something earlier in the sequence changed).
  emit({ type: 'index-progress', collectionId: collection.id, phase: 'Checking for changes', done: 0, total: targets.length })
  // Render options that change the output. If any differ from the last run, the
  // cached PDFs are stale, so ignore the manifest and re-render everything.
  const configKey = JSON.stringify({
    combine: !!collection.combineAttachments,
    excludeSignatures: !!collection.excludeSignatures,
    excludeAttachments: [...excludeAttachments].map((s) => s.trim().toLowerCase()).sort(),
    excludeUnderBytes,
    bates: collection.bates ?? null,
    emailToPdf: features.emailToPdf,
    reviewIndex: features.reviewIndex,
    loadFile: features.loadFile
  })
  const saved = (await getProductionManifest(collection.id)) as { config?: string; items?: ProdItem[] } | null
  const prevManifest = saved && saved.config === configKey ? saved.items ?? [] : []
  const prevById = new Map(prevManifest.map((p) => [p.id, p]))
  const currentIds = new Set(targets.map((d) => d.id))
  result.removed = prevManifest.filter((p) => !currentIds.has(p.id)).length
  const outputExists = async (rel: string): Promise<boolean> => {
    try {
      await fs.stat(path.join(outRoot, rel))
      return true
    } catch {
      return false
    }
  }

  const used = new Set<string>()
  const items: ProdItem[] = []
  const excludedSink: ExcludedAtt[] = []
  const win = makeRenderWindow()
  try {
    for (let i = 0; i < targets.length; i++) {
      if (isCancelled()) break
      const doc = targets[i]
      emit({ type: 'index-progress', collectionId: collection.id, phase: 'Building production', done: i, total: targets.length })
      const prev = prevById.get(doc.id)
      const unchanged = !!prev && prev.mtime === doc.modifiedAt && prev.size === doc.size
      const batesStable = !assignBates || (prev != null && prev.begBates === label(batesNext))
      if (unchanged && prev && batesStable && (await outputExists(prev.fileRel))) {
        items.push(prev) // reuse the already-produced document + its Bates
        used.add(path.join(outRoot, prev.fileRel).toLowerCase())
        batesNext += prev.batesSpan ?? prev.pages
        result.skipped++
        result.pdfCount++
        continue
      }
      try {
        const { rec, excludedMeta } = await produceOne(win, doc, outRoot, relFor(doc.path), { convert, combine: !!collection.combineAttachments, assignBates, prefix, batesStart: batesNext, excludeSignatures: !!collection.excludeSignatures, excludeAttachments, excludeUnderBytes }, used, result, excludedSink)
        items.push({ id: doc.id, path: doc.path, mtime: doc.modifiedAt, size: doc.size, excluded: excludedMeta, ...rec })
        batesNext += rec.batesSpan
        result.processed++
        result.pdfCount++
      } catch (e) {
        result.errors.push({ file: doc.path, error: (e as Error).message })
      }
    }
  } finally {
    win.destroy()
  }
  emit({ type: 'index-progress', collectionId: collection.id, phase: 'Building production', done: targets.length, total: targets.length })

  // Excluded-attachment counts come from the full set's metadata (each manifest
  // item carries its excluded {name,size,hash}), so the Needs Review warning stays
  // correct even on incremental re-runs. The Excluded/ FOLDER (the actual files) is
  // (re)written only on a full render, when every excluded attachment is in hand.
  const summary = excludedSummary(items.flatMap((i) => i.excluded ?? []))
  result.excludedAttachments = summary.total
  result.inconsistentAttachments = summary.inconsistentNames
  if (!isCancelled() && result.skipped === 0) {
    await writeExcludedFolder(outRoot, excludedSink)
  }

  // Persist the manifest (full or partial) so a paused run resumes from here.
  await saveProductionManifest(collection.id, { config: configKey, items })
  // Paused/cancelled mid-render: leave the index/load-file regeneration for the
  // resume run (when the full set is produced).
  if (isCancelled()) return result

  const records: ProdRecord[] = items
  if (assignBates && records.length) {
    const first = records.find((r) => r.begBates)
    const last = [...records].reverse().find((r) => r.endBates)
    if (first && last) result.batesRange = { begin: first.begBates, end: last.endBates }
  }

  // Metadata is kept out of the Documents/ tree: review reports → Reports/, the
  // production load file → Load Files/. Its FILE NAME paths stay relative to the
  // output root (Documents/…) — the volume-root convention review platforms use.
  const reportsDir = path.join(outRoot, 'Reports')
  const loadFilesDir = path.join(outRoot, 'Load Files')

  // Review index — human-readable, for your own review team (internal).
  if (features.reviewIndex && records.length) {
    await fs.mkdir(reportsDir, { recursive: true })
    const p = path.join(reportsDir, 'Review Index.xlsx')
    await fs.writeFile(p, await rowsToXlsx([REVIEW_HEADER, ...reviewIndexRows(records)], 'Review Index'))
    result.indexPath = p
  }

  // Production load file — Concordance .DAT + universal .CSV, with family ranges (external).
  if (features.loadFile && records.length) {
    await fs.mkdir(loadFilesDir, { recursive: true })
    const table = [LOADFILE_HEADER, ...loadFileRows(records)]
    const datPath = path.join(loadFilesDir, 'Production Load File.dat')
    await fs.writeFile(datPath, toDat(table))
    await fs.writeFile(path.join(loadFilesDir, 'Production Load File.csv'), toCsv(table))
    result.loadFilePath = datPath
  }

  // Highlights table — flatten every reviewer mark across the set.
  if (features.highlights) {
    const hrows = highlightRows(docs)
    if (hrows.length) {
      await fs.mkdir(reportsDir, { recursive: true })
      const p = path.join(reportsDir, 'Highlights.xlsx')
      await fs.writeFile(p, await rowsToXlsx([HIGHLIGHT_HEADER, ...hrows], 'Highlights'))
      result.highlightsPath = p
    }
  }

  return result
}
