import { promises as fs } from 'fs'
import path from 'path'
import { simpleParser, type ParsedMail } from 'mailparser'
import type { Collection, IndexedDoc, IndexEvent, ProcessFeatures, ProductionResult } from '@shared/types'
import { buildEmailHtml } from './emailHtml'
import { combineFamily, makeRenderWindow, renderInto, safeName, stampBates, toCsv, toDat } from './emailToPdf'
import { renderDocToPdf, slipSheet } from './docToPdf'
import { rowsToXlsx } from './convert'
import {
  HIGHLIGHT_HEADER,
  REVIEW_HEADER,
  LOADFILE_HEADER,
  highlightRows,
  reviewIndexRows,
  loadFileRows,
  productionTargets,
  type ProdRecord
} from './productionRows'

// Turn an indexed document set into a single Bates-numbered production under the
// output folder, then write the deliverables the enabled features ask for:
//   - review index (xlsx)                       → features.reviewIndex
//   - production load file (.DAT/.CSV)          → features.loadFile
//   - highlights table (xlsx)                  → features.highlights
// A full production (internal/external index) renders EVERY document to PDF so it
// can carry a Bates number; "convert emails to PDF" alone renders just the emails.

type Emit = (e: IndexEvent) => void

const PAD = 6

const addr = (v: ParsedMail['to']): string => (Array.isArray(v) ? v.map((t) => t.text).join('; ') : v?.text) || ''

/** A produced PDF + the metadata row it contributes to the indexes. */
async function produceOne(
  win: ReturnType<typeof makeRenderWindow>,
  doc: IndexedDoc,
  outRoot: string,
  rel: string,
  opts: { combine: boolean; stamp: boolean; prefix: string; batesStart: number; excludeSignatures: boolean },
  used: Set<string>,
  result: ProductionResult
): Promise<ProdRecord> {
  const ext = doc.ext
  const base = path.basename(doc.name, ext)
  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  // Produced files live under Documents/ so they never mix with the metadata
  // (review index, load file, highlights), which go in their own folders.
  const docsRoot = path.join(outRoot, 'Documents')

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
    const built = buildEmailHtml(mail, { excludeSignatures: opts.excludeSignatures })
    pdf = await renderInto(win, built.html)
    if (opts.combine && built.fileAttachments.length) pdf = await combineFamily(pdf, built.fileAttachments)
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
  if (opts.stamp) {
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

  return {
    begBates,
    endBates,
    pages,
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
}

export async function buildProduction(
  collection: Collection,
  docs: IndexedDoc[],
  emit: Emit,
  isCancelled: () => boolean
): Promise<ProductionResult> {
  const features = collection.features as ProcessFeatures
  const outRoot = path.resolve(collection.output as string)
  const result: ProductionResult = { pdfCount: 0, slipSheets: 0, errors: [] }
  await fs.mkdir(outRoot, { recursive: true })

  // A review index or production renders every doc; "email→PDF" alone renders just emails.
  const fullProduction = features.reviewIndex || features.loadFile
  const targets = productionTargets(docs, features).sort((a, b) => a.path.localeCompare(b.path)) // deterministic, contiguous Bates

  // A review index / production needs Bates; default a prefix if the user didn't set one.
  const bates = collection.bates ?? (fullProduction ? { prefix: 'DOC-', start: 1 } : null)
  const stampOn = !!bates
  const prefix = bates?.prefix ?? ''
  let batesNext = bates?.start ?? 1

  const inRoots = collection.folders.map((f) => path.resolve(f))
  const relFor = (p: string): string => {
    const root = inRoots.find((r) => p === r || p.startsWith(r + path.sep))
    return root ? path.relative(root, p) : path.basename(p)
  }

  const used = new Set<string>()
  const records: ProdRecord[] = []
  const win = makeRenderWindow()
  try {
    for (let i = 0; i < targets.length; i++) {
      if (isCancelled()) break
      const doc = targets[i]
      emit({ type: 'index-progress', collectionId: collection.id, phase: 'Building production', done: i, total: targets.length })
      try {
        const rec = await produceOne(win, doc, outRoot, relFor(doc.path), { combine: !!collection.combineAttachments, stamp: stampOn, prefix, batesStart: batesNext, excludeSignatures: !!collection.excludeSignatures }, used, result)
        records.push(rec)
        batesNext += rec.pages
        result.pdfCount++
      } catch (e) {
        result.errors.push({ file: doc.path, error: (e as Error).message })
      }
    }
  } finally {
    win.destroy()
  }
  emit({ type: 'index-progress', collectionId: collection.id, phase: 'Building production', done: targets.length, total: targets.length })

  if (stampOn && records.length) {
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
