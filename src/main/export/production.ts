import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import os from 'os'
import path from 'path'
import { simpleParser, type ParsedMail } from 'mailparser'
import type { Collection, IndexedDoc, IndexEvent, ProcessFeatures, ProductionResult } from '@shared/types'
import { buildEmailHtml, SMALL_ATTACHMENT_BYTES } from './emailHtml'
import { sha256, dHash, hamming, DHASH_THRESHOLD, DHASH_VERSION, LOGO_MAX_BYTES } from './imageHash'
import { combineFamily, makeRenderWindow, pageCount, renderInto, safeName, stampBates, toCsv, toDat, withTimeout } from './emailToPdf'

// Merging attachments into a family PDF (pdf-lib) can grind for minutes on a big drawing
// set, run 6-wide across the worker pool. Bound it: if it overruns, keep the un-combined
// email PDF — the attachments are still produced as native files beside it.
const COMBINE_TIMEOUT_MS = 60_000
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
  symmetricDiff,
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

// An image attachment whose exact content (sha256) appears in at least this many emails
// is treated as a recurring signature logo, not a one-off picture — provided it's also
// small (<= LOGO_MAX_BYTES). 3+ byte-identical small copies across the set is a logo.
const MIN_RECURRENCE = 3

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
  /** Content keys (sha256) of this doc's non-embedded attachments — so an exclude/restore
   *  change (resolved to sha) can re-render only the docs it actually touches. */
  attKeys?: string[]
  /** Basenames this item wrote into its folder this run (the PDF + any separately-saved
   *  native attachments). The sweep keeps exactly these and removes anything else in the
   *  folder, so renamed/now-excluded/embedded-only files don't linger across runs. */
  files?: string[]
  /** Sequential per-family item number (1-based) when item numbering is on, else 0. Stored
   *  so a re-run can tell when the number shifted (a doc was added/removed earlier) and the
   *  filename prefix must be re-written. */
  itemNo?: number
}

/** An attachment filtered out of the production (by content), kept for review. */
interface ExcludedAtt extends ExcludedMeta {
  content: Buffer
  /** The email it came from (relative path), for the listing. */
  source: string
}

/** The resolved, content-based exclusion decision for a run — sha256 sets the matcher
 *  checks per attachment. Built once by the prescan (resolveExclusions) and threaded
 *  through every render + excluded-collection call so they all agree. */
type ExclusionSets = {
  excludeSignatures: boolean
  /** Manually excluded ("this file + everything similar"), resolved from content. */
  excludeShas: Set<string>
  /** Auto-detected recurring signature logos (3+ exact small copies). */
  autoLogoShas: Set<string>
  /** Restored exact files (sha256) — override every rule. */
  keepShas: Set<string>
  /** "Keep all of this name" — name-scoped override. */
  keepNames: Set<string>
}

/** Render-time options (no Bates — numbering is decided later, in order). */
type RenderOpts = ExclusionSets & {
  convert: boolean
  combine: boolean
  /** Also write kept attachments as separate native files beside the PDF. When combine
   *  is off this is forced on (else the attachments would be lost). */
  separate: boolean
}

/**
 * The product of rendering one document, BEFORE Bates stamping or disk writing.
 * Rendering (the expensive, parallelisable step) produces this; a later sequential
 * pass assigns the Bates number and writes it — that split is what lets renders run
 * concurrently while numbering stays strictly in order.
 */
type Rendered = {
  doc: IndexedDoc
  rel: string
  /** Native passthrough ("Convert to PDF" off): copy `doc.path` verbatim, one Bates number. */
  native: boolean
  /** Unstamped rendered PDF (converted docs only). */
  pdf?: Buffer
  /** Page count of `pdf` (the Bates span before stamping); 0 for native. */
  pages: number
  from: string
  to: string
  cc: string
  subject: string
  date: string
  docType: string
  attCount: number
  attNames: string
  attKeys: string[]
  attachments: { name: string; content: Buffer }[]
  excludedMeta: ExcludedMeta[]
  /** Absolute target folder for the produced PDF + its attachments. */
  folder: string
  /** Base name (no extension) for the produced PDF. */
  base: string
}

/**
 * Render one document to an UNSTAMPED PDF (+ all the metadata the index needs), with
 * no Bates numbering and no disk write. Safe to run concurrently with other renders —
 * it touches only its own window and the shared excluded sink (an append-only list).
 */
async function renderOne(
  win: ReturnType<typeof makeRenderWindow>,
  doc: IndexedDoc,
  outRoot: string,
  rel: string,
  opts: RenderOpts,
  result: ProductionResult,
  excludedSink: ExcludedAtt[]
): Promise<Rendered> {
  const ext = doc.ext
  const base = path.basename(doc.name, ext)
  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  // Produced files live under Documents/ so they never mix with the metadata
  // (review index, load file, highlights), which go in their own folders.
  const docsRoot = path.join(outRoot, 'Documents')
  const docType = doc.docType || (doc.kind === 'email' ? 'Email' : 'Document')
  const excludedMeta: ExcludedMeta[] = []
  const base0 = { doc, rel, from: '', to: '', cc: '', subject: '', date: '', docType, attCount: 0, attNames: '', attKeys: [] as string[], excludedMeta }

  // Native production: copy the original verbatim later; only gather metadata here.
  // Render-time filtering (signatures, excluded attachments) doesn't apply — the
  // original is kept intact.
  if (!opts.convert) {
    if (ext === '.eml') {
      const mail = await simpleParser(await fs.readFile(doc.path))
      const atts = (mail.attachments || []).filter((a) => a.contentDisposition === 'attachment')
      return {
        ...base0,
        native: true,
        pages: 0,
        from: mail.from?.text || '',
        to: addr(mail.to),
        cc: addr(mail.cc),
        subject: mail.subject || '',
        date: mail.date ? mail.date.toISOString().slice(0, 10) : '',
        attCount: atts.length,
        attNames: atts.map((a) => a.filename || 'attachment').join('; '),
        attachments: [],
        folder: path.join(docsRoot, relDir),
        base
      }
    }
    return { ...base0, native: true, pages: 0, subject: doc.title || base, date: doc.date || '', attachments: [], folder: path.join(docsRoot, relDir), base }
  }

  // Assigned on every path below (rendered PDF, slip-sheet, or native doc render); the
  // try/catch around the email render defeats TS's definite-assignment analysis.
  let pdf!: Buffer
  let from = ''
  let to = ''
  let cc = ''
  let subject = ''
  let date = ''
  let attCount = 0
  let attNames = ''
  // Content keys (sha256) of this doc's non-embedded attachments — lets a re-run tell
  // whether an exclude/restore change actually touches this doc.
  let attKeys: string[] = []
  let folder: string
  const attachments: { name: string; content: Buffer }[] = []

  if (ext === '.eml') {
    const mail = await simpleParser(await fs.readFile(doc.path))
    const built = buildEmailHtml(mail, { excludeSignatures: opts.excludeSignatures, excludeShas: opts.excludeShas, autoLogoShas: opts.autoLogoShas, keepShas: opts.keepShas, keepNames: opts.keepNames })
    // A render that fails or times out must not drop the email from the production (and
    // shift every Bates number after it): fall back to a slip-sheet placeholder + the
    // native .eml, exactly like an unrenderable document, so the sequence stays intact.
    let emailPdf: Buffer | null = null
    try {
      emailPdf = await renderInto(win, built.html)
    } catch (e) {
      result.errors.push({ file: doc.path, error: `render failed, slip-sheeted: ${(e as Error).message}` })
      pdf = await slipSheet(doc.name)
      result.slipSheets++
      attachments.push({ name: doc.name, content: await fs.readFile(doc.path) })
    }
    if (emailPdf) {
      pdf = emailPdf
      // Merge the attachments onto the email PDF, but never let it grind forever. If the
      // merge overruns, keep the un-combined email PDF — its attachments are still added
      // as native files below, so the family stays complete.
      if (opts.combine && built.fileAttachments.length) {
        try {
          pdf = await withTimeout(combineFamily(emailPdf, built.fileAttachments), COMBINE_TIMEOUT_MS, 'combineFamily')
        } catch (e) {
          result.errors.push({ file: doc.path, error: `attachment merge skipped (too slow): ${(e as Error).message}` })
          pdf = emailPdf
        }
      }
    }
    // Excluded attachments are routed to Excluded/, not the family folder.
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
    // Content keys (sha256) of this doc's non-embedded attachments — lets a re-run tell
    // whether a changed exclusion decision (resolved to sha) actually touches this doc.
    attKeys = [...built.fileAttachments, ...built.excludedAttachments].map((a) => sha256(a.content ?? Buffer.alloc(0)))
    // Attachments are always merged into the email PDF; they're ALSO written as separate
    // native files only when asked (separate). When not, they live inside the PDF alone —
    // the sweep removes any loose copy a prior "separate" run left behind.
    const writeNative = opts.separate || !opts.combine
    if (writeNative) for (const a of built.fileAttachments) attachments.push({ name: a.filename || 'attachment', content: a.content })
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

  const pages = await pageCount(pdf).catch(() => 1)
  return { doc, rel, native: false, pdf, pages, from, to, cc, subject, date, docType, attCount, attNames, attKeys, attachments, excludedMeta, folder, base }
}

/**
 * Sweep stale files out of the produced Documents/ tree after a run, so the output matches
 * the current document set exactly. The current `items` are the source of truth and each
 * records the exact basenames it wrote into its folder (PDF + any separately-saved native
 * attachments). So:
 *   - a directory no item produces into is orphaned — every file in it goes (e.g. an email
 *     whose last kept attachment was excluded, so its PDF moved up to the shared parent);
 *   - inside a directory an item DOES produce into, any file NOT in that folder's produced
 *     set goes (a now-excluded attachment routed to Excluded/, an attachment that's now
 *     embedded-only, or a file left under an old naming scheme — e.g. before item-number
 *     prefixes were turned on/off).
 * Excluded/ lives outside Documents/, so it's never touched here.
 *
 * SAFETY: a folder holding any item from before file-tracking (no `files`) is left fully
 * alone, so we never delete output we can't positively account for.
 */
export async function sweepStaleOutputs(outRoot: string, items: ProdItem[]): Promise<void> {
  const docsRoot = path.join(outRoot, 'Documents')
  const folderOf = (it: ProdItem): string => path.dirname(path.join(outRoot, it.fileRel))
  const itemFolders = new Set(items.map((it) => folderOf(it).toLowerCase()))
  // Allowed basenames per folder = exactly what this run wrote there. A folder with any
  // pre-tracking item is marked untracked and skipped entirely.
  const allowed = new Map<string, Set<string>>()
  const untracked = new Set<string>()
  for (const it of items) {
    const key = folderOf(it).toLowerCase()
    if (!it.files) {
      untracked.add(key)
      continue
    }
    const set = allowed.get(key) ?? new Set<string>()
    for (const f of it.files) set.add(f.toLowerCase())
    allowed.set(key, set)
  }

  const walk = async (dir: string): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const key = dir.toLowerCase()
    const inItemFolder = itemFolders.has(key)
    const keep = allowed.get(key)
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(p)
        await fs.rmdir(p).catch(() => {}) // drop it if the recursion emptied it
        continue
      }
      if (!inItemFolder) {
        // No item produces here — the whole directory is orphaned.
        await fs.rm(p, { force: true }).catch(() => {})
        continue
      }
      if (untracked.has(key) || !keep) continue // can't account for it — leave it
      if (!keep.has(e.name.toLowerCase())) await fs.rm(p, { force: true }).catch(() => {})
    }
  }
  await walk(docsRoot)
}

/**
 * Name the rendered PDF, appending `.pdf` only when the base doesn't already end in it.
 * A source whose name embeds the extension before its real one — e.g. a drawing emailed
 * as `ATSYD1-…(D)(1).pdf.eml`, whose base (minus `.eml`) is `…(1).pdf` — would otherwise
 * produce `…(1).pdf.pdf`. Case-insensitive so a `.PDF` base isn't doubled either.
 */
export function pdfFileName(base: string): string {
  return /\.pdf$/i.test(base) ? base : base + '.pdf'
}

/** Decorate an attachment filename with its byte size + perceptual key, in the SAME shape
 *  the Excluded/ folder uses: `name (NNN bytes, dh=HASH).ext` (dh=none when not an image or
 *  not hashable). The file tree's undecorateName strips this back to `name.ext`, so exclude/
 *  keep fingerprint matching is unaffected. */
export function decorateAttKey(name: string, size: number, dh: string | null): string {
  const ext = path.extname(name)
  return `${path.basename(name, ext)} (${size} bytes, dh=${dh ?? 'none'})${ext}`
}

/** Collapse a doubled `.pdf.pdf` (case-insensitive on the trailing pair) to a single
 *  `.pdf`. Pure — used both to fix names going forward and to migrate stored paths. */
export function dedupePdfExt(name: string): string {
  return name.replace(/(\.pdf)\.pdf$/i, '$1')
}

/**
 * Migrate a previously-produced document whose PDF an earlier run named `…pdf.pdf`:
 * rename the file on disk to the single-extension form and return the item with its
 * `fileRel` corrected, so the reused document's path is right in the load file / index
 * without a re-render. A no-op when the name is already correct; leaves things untouched
 * if the source is missing or the target name is already taken.
 */
async function fixDoubledPdfName(outRoot: string, item: ProdItem): Promise<ProdItem> {
  const fixed = dedupePdfExt(item.fileRel)
  if (fixed === item.fileRel) return item
  const from = path.join(outRoot, item.fileRel)
  const to = path.join(outRoot, fixed)
  try {
    if (await fs.stat(to).then(() => true).catch(() => false)) return item // don't clobber
    await fs.rename(from, to)
  } catch {
    return item // source gone or rename failed — keep the original path
  }
  return { ...item, fileRel: fixed }
}

/**
 * Bates-stamp a rendered document at `batesStart` and write it (and its attachments)
 * to disk. Sequential — `batesStart` depends on every document before it. Returns the
 * index row plus the data a re-run needs to decide reuse.
 */
async function writeRendered(
  r: Rendered,
  outRoot: string,
  batesStart: number,
  prefix: string,
  assignBates: boolean,
  used: Set<string>,
  result: ProductionResult,
  /** Item-number prefix prepended to every produced filename (e.g. `0001 - `); '' when off. */
  itemPrefix: string,
  /** sha256 → { perceptual key, is-image }, so produced IMAGE attachments can carry their
   *  similarity key in the name, like the Excluded/ folder does (non-images stay clean). */
  attKeyBySha: Map<string, { dh: string | null; img: boolean }>
): Promise<{ rec: ProdRecord; excludedMeta: ExcludedMeta[]; attKeys: string[]; files: string[] }> {
  const batesLabel = (n: number): string => prefix + String(n).padStart(PAD, '0')
  await fs.mkdir(r.folder, { recursive: true })
  // Claim a collision-free name in the folder, recording it in `used`. The item prefix is
  // applied first so a family's files share it; `_` only disambiguates a true clash.
  const claim = (base: string): string => {
    let name = itemPrefix + base
    while (used.has(path.join(r.folder, name).toLowerCase())) name = '_' + name
    used.add(path.join(r.folder, name).toLowerCase())
    return name
  }

  if (r.native) {
    const name = claim(safeName(r.doc.name))
    const outPath = path.join(r.folder, name)
    await fs.copyFile(r.doc.path, outPath)
    const beg = assignBates ? batesLabel(batesStart) : ''
    const rec: ProdRecord = { begBates: beg, endBates: beg, pages: 0, batesSpan: 1, date: r.date, from: r.from, to: r.to, cc: r.cc, subject: r.subject, docType: r.docType, kind: r.doc.kind, fileRel: path.relative(outRoot, outPath), attCount: r.attCount, attNames: r.attNames }
    return { rec, excludedMeta: r.excludedMeta, attKeys: r.attKeys, files: [name] }
  }

  let pdf = r.pdf as Buffer
  const attachments = [...r.attachments]
  // Bates-stamp; a passthrough PDF that can't be loaded (encrypted/corrupt) falls
  // back to a slip sheet so the sequence stays intact.
  let pages = 0
  let begBates = ''
  let endBates = ''
  if (assignBates) {
    try {
      const s = await stampBates(pdf, batesStart, prefix, PAD)
      pdf = s.bytes
      begBates = s.begin
      endBates = s.end
      pages = s.pages
    } catch {
      const slip = await slipSheet(r.doc.name)
      result.slipSheets++
      if (!attachments.some((a) => a.name === r.doc.name)) attachments.push({ name: r.doc.name, content: await fs.readFile(r.doc.path) })
      const s = await stampBates(slip, batesStart, prefix, PAD)
      pdf = s.bytes
      begBates = s.begin
      endBates = s.end
      pages = s.pages
    }
  }

  const files: string[] = []
  const pdfName = claim(pdfFileName(r.base))
  files.push(pdfName)
  const outPath = path.join(r.folder, pdfName)
  await fs.writeFile(outPath, pdf)

  for (const a of attachments) {
    // Decorate genuine email attachments with their size + similarity key (dh=…), matching
    // the Excluded/ folder so you can eyeball why two attachments do or don't match. The
    // file tree strips this decoration when computing fingerprints, so exclude/keep still
    // work. Document natives (slip-sheet/spreadsheet copies) keep their real name.
    const safe = safeName(a.name)
    const k = r.doc.kind === 'email' ? attKeyBySha.get(sha256(a.content)) : undefined
    const base = k?.img ? decorateAttKey(safe, a.content.length, k.dh) : safe
    const n = claim(base)
    files.push(n)
    await fs.writeFile(path.join(r.folder, n), a.content)
  }

  const rec: ProdRecord = { begBates, endBates, pages, batesSpan: pages, date: r.date, from: r.from, to: r.to, cc: r.cc, subject: r.subject, docType: r.docType, kind: r.doc.kind, fileRel: path.relative(outRoot, outPath), attCount: r.attCount, attNames: r.attNames }
  return { rec, excludedMeta: r.excludedMeta, attKeys: r.attKeys, files }
}

/**
 * Render a list of documents concurrently across a small pool of hidden windows,
 * storing each result in `rendered` keyed by doc id. Render failures are recorded on
 * `result.errors` and skipped (no entry stored). `onDone` fires after each render for
 * progress, with the doc just finished.
 */
async function renderInParallel(
  jobs: { doc: IndexedDoc; rel: string }[],
  outRoot: string,
  opts: RenderOpts,
  result: ProductionResult,
  excludedSink: ExcludedAtt[],
  rendered: Map<string, Rendered>,
  isCancelled: () => boolean,
  onDone: (doc: IndexedDoc) => void
): Promise<void> {
  if (!jobs.length) return
  // Cap the pool to the work and to (cores − 2); each window is a full renderer, so a
  // handful saturates the machine without exhausting memory.
  const poolSize = Math.max(1, Math.min(jobs.length, (os.cpus().length || 4) - 2, 6))
  const wins = Array.from({ length: poolSize }, () => makeRenderWindow())
  let next = 0
  const worker = async (win: ReturnType<typeof makeRenderWindow>): Promise<void> => {
    for (;;) {
      if (isCancelled()) return
      const idx = next++
      if (idx >= jobs.length) return
      const job = jobs[idx]
      try {
        rendered.set(job.doc.id, await renderOne(win, job.doc, outRoot, job.rel, opts, result, excludedSink))
      } catch (e) {
        result.errors.push({ file: job.doc.path, error: (e as Error).message })
      }
      onDone(job.doc)
    }
  }
  try {
    await Promise.all(wins.map((w) => worker(w)))
  } finally {
    for (const w of wins) w.destroy()
  }
}

/**
 * Parse an email and return just its excluded attachments (content + source), with no
 * PDF render. Lets an incremental run keep the Excluded/ folder + map complete for docs
 * whose PDF was reused (only the affected docs are re-rendered).
 */
async function collectExcluded(doc: IndexedDoc, rel: string, opts: ExclusionSets): Promise<ExcludedAtt[]> {
  if (doc.ext !== '.eml') return []
  try {
    const mail = await simpleParser(await fs.readFile(doc.path))
    const built = buildEmailHtml(mail, opts)
    return built.excludedAttachments.map((a) => ({ name: a.filename || 'attachment', size: a.content.length, content: a.content, source: rel }))
  } catch {
    return []
  }
}

/**
 * Where a restored attachment will land: its source email's own family folder under
 * Documents/ (an email with ≥1 kept attachment gets a subfolder named after it). Derived
 * from the excluded record's `source` (the email's relative path) and returned as a
 * forward-slash path so the UI can point the user at where to look for the restored copy.
 */
export function intendedDirOf(source: string): string {
  const norm = source.replace(/\\/g, '/')
  const ext = path.posix.extname(norm)
  const dir = path.posix.dirname(norm)
  const base = path.posix.basename(norm, ext)
  return path.posix.join('Documents', dir === '.' ? '' : dir, base)
}

/**
 * Write excluded attachments to <output>/Excluded/ for review, GROUPED BY VISUAL
 * SIMILARITY (not by filename). Byte-identical copies collapse to one file first (a
 * content hash is the one sure test they're the same), then the distinct files are
 * clustered perceptually: any two images whose dHashes are within DHASH_THRESHOLD bits
 * land in the same cluster (union-find, so re-encoded copies of one logo group together
 * even under different filenames). Files with no usable perceptual hash (non-images, or
 * blank/divider images) stay in their own singleton cluster. Each cluster is written to
 * its own "Group NN" folder so the reviewer can open it and confirm the grouping is
 * correct. Called only on a full render, when every excluded attachment's content is in
 * hand.
 */
export async function writeExcludedFolder(outRoot: string, excluded: ExcludedAtt[]): Promise<void> {
  const dir = path.join(outRoot, 'Excluded')
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) // fresh slate
  if (!excluded.length) return
  await fs.mkdir(dir, { recursive: true })

  const hashOf = (b: Buffer): string => createHash('sha1').update(b).digest('hex')
  const dirsOf = (sources: Set<string>): string[] => [...new Set([...sources].map(intendedDirOf))].sort()

  // 1) Collapse byte-identical copies first. Each distinct file remembers every email it
  //    came from, so a restore knows all the produced folders it belongs in.
  const byContent = new Map<string, { rep: ExcludedAtt; sources: Set<string> }>()
  for (const e of excluded) {
    const k = hashOf(e.content)
    const g = byContent.get(k)
    if (g) g.sources.add(e.source)
    else byContent.set(k, { rep: e, sources: new Set([e.source]) })
  }
  const reps = [...byContent.values()]

  // 2) Perceptual-hash each distinct file (images only); non-images / blanks get null.
  const dhashes = await Promise.all(reps.map((r) => dHash(r.rep.content).catch(() => null)))

  // 3) Cluster by visual similarity. Union any two images within DHASH_THRESHOLD bits;
  //    files without a usable dHash stay singletons (only byte-identical copies merge,
  //    and those were already collapsed in step 1).
  const parent = reps.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < reps.length; i++) {
    const di = dhashes[i]
    if (!di) continue
    for (let j = i + 1; j < reps.length; j++) {
      const dj = dhashes[j]
      if (dj && hamming(di, dj) <= DHASH_THRESHOLD) union(i, j)
    }
  }
  const clustered = new Map<number, number[]>()
  for (let i = 0; i < reps.length; i++) {
    const root = find(i)
    const arr = clustered.get(root)
    if (arr) arr.push(i)
    else clustered.set(root, [i])
  }
  // Largest clusters first (the ones most worth eyeballing), ties by representative name.
  const groups = [...clustered.values()].sort(
    (a, b) => b.length - a.length || reps[a[0]].rep.name.localeCompare(reps[b[0]].rep.name)
  )

  // Never let two distinct files share an output path (odd characters in a filename, or
  // two copies with the same byte size) — disambiguate with a "_".
  const used = new Set<string>()
  const uniqueIn = (base: string, name: string): string => {
    let n = safeName(name)
    while (used.has(path.join(base, n).toLowerCase())) n = '_' + n
    used.add(path.join(base, n).toLowerCase())
    return path.join(base, n)
  }

  // 4) Write one folder per similarity group, every distinct member inside it. The folder
  //    name carries the member count, and each FILENAME carries its perceptual hash
  //    (dh=…) so you can eyeball why two images did or didn't cluster — images within
  //    DHASH_THRESHOLD differing bits are "similar". Non-images get dh=none (they only
  //    merge with byte-identical copies). Each distinct file's group + dHash is recorded
  //    so the listing and debug report below can reference them.
  const pad = String(groups.length).length
  const restoreMap: Record<string, string[]> = {}
  // Per distinct file (by content sha1) → its group number + dHash, for the listing/report.
  const metaByContent = new Map<string, { group: number; dh: string }>()
  let gi = 0
  for (const members of groups) {
    gi++
    const folder = path.join(dir, `Group ${String(gi).padStart(pad, '0')} (${members.length} file${members.length === 1 ? '' : 's'})`)
    await fs.mkdir(folder, { recursive: true })
    for (const idx of members) {
      const { rep, sources } = reps[idx]
      const dh = dhashes[idx] ?? 'none'
      const ext = path.extname(rep.name)
      const outPath = uniqueIn(folder, `${path.basename(rep.name, ext)} (${rep.size} bytes, dh=${dh})${ext}`)
      await fs.writeFile(outPath, rep.content)
      restoreMap[path.basename(outPath)] = dirsOf(sources)
      metaByContent.set(hashOf(rep.content), { group: gi, dh })
    }
  }

  // The listing names every excluded image individually — one row per instance, each with
  // the exact file it was removed from — so the same logo appearing across many emails
  // stays fully traceable. Group + dHash columns let you sort/filter to see which files
  // the clusterer thought were the same image and why.
  const listing: string[][] = [['Group', 'Filename', 'Size (bytes)', 'dHash', 'Removed from']]
  for (const e of [...excluded].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source) || a.size - b.size)) {
    const m = metaByContent.get(hashOf(e.content))
    listing.push([m ? `Group ${String(m.group).padStart(pad, '0')}` : '?', e.name, String(e.size), m?.dh ?? 'none', e.source])
  }

  await fs.writeFile(path.join(dir, 'Excluded Attachments.xlsx'), await rowsToXlsx(listing, 'Excluded'))

  // Debug report: for every pair of groups that have a perceptual hash, the SMALLEST
  // Hamming distance between any image in one and any image in the other. Two groups whose
  // nearest pair is just above DHASH_THRESHOLD are the near-misses — that's where you see
  // why they stayed apart (e.g. "Group 01 ↔ Group 02 : 9" with threshold 8). Anything ≤
  // threshold inside the SAME group; across groups it should always be > threshold.
  const groupDh: { gi: number; rep: string; hashes: string[] }[] = groups.map((members, k) => ({
    gi: k + 1,
    rep: path.basename(reps[members[0]].rep.name),
    hashes: members.map((idx) => dhashes[idx]).filter((h): h is string => !!h)
  }))
  const lines: string[] = []
  lines.push(`Excluded-attachment similarity report`)
  lines.push(`Threshold: two images within ${DHASH_THRESHOLD} differing bits (of 64) are grouped as the same image.`)
  lines.push(``)
  for (const g of groupDh) {
    lines.push(`Group ${String(g.gi).padStart(pad, '0')} — ${g.rep}`)
    for (const idx of groups[g.gi - 1]) {
      lines.push(`    dh=${dhashes[idx] ?? 'none'}  ${reps[idx].rep.name} (${reps[idx].rep.size} bytes)`)
    }
  }
  const pairs: { a: number; b: number; min: number }[] = []
  for (let i = 0; i < groupDh.length; i++) {
    for (let j = i + 1; j < groupDh.length; j++) {
      if (!groupDh[i].hashes.length || !groupDh[j].hashes.length) continue
      let min = 64
      for (const ha of groupDh[i].hashes) for (const hb of groupDh[j].hashes) min = Math.min(min, hamming(ha, hb))
      pairs.push({ a: groupDh[i].gi, b: groupDh[j].gi, min })
    }
  }
  pairs.sort((x, y) => x.min - y.min)
  if (pairs.length) {
    lines.push(``)
    lines.push(`Nearest distance between groups (closest first — anything ≤ ${DHASH_THRESHOLD} would have merged):`)
    for (const p of pairs) {
      const flag = p.min <= DHASH_THRESHOLD + 4 ? '   ← near-miss' : ''
      lines.push(`    Group ${String(p.a).padStart(pad, '0')} ↔ Group ${String(p.b).padStart(pad, '0')} : ${p.min} bits${flag}`)
    }
  }
  await fs.writeFile(path.join(dir, '_grouping-debug.txt'), lines.join('\n') + '\n')
  // Hidden sidecar (filtered from the explorer) the renderer reads to show, per excluded
  // file, the produced folder(s) a restore would land in.
  await fs.writeFile(path.join(dir, '.restore-map.json'), JSON.stringify(restoreMap))
}

// Per-doc cache of attachment content hashes (decoding images for the perceptual hash is
// the expensive bit), keyed by the email's mtime/size so an incremental run only re-hashes
// changed emails. `perceptual` records whether dHashes were computed, so a run that newly
// needs them (a manual image exclude was added) re-hashes rather than reusing a sha-only entry.
type AttHash = { sha: string; dhash: string | null; size: number; img: boolean; name: string }
export type AttHashEntry = { mtime: number; size: number; perceptual: boolean; pv?: number; atts: AttHash[] }

/** name|size identity of an attachment — the POINTER the UI stores and the key the file tree
 *  marks by. Matching itself is by content (sha/dHash); this just maps a resolved content
 *  decision back to the produced files so the renderer can flag every copy. */
const fpOf = (name: string, size: number): string => name.trim().toLowerCase() + '|' + size

// A conversation key for an email — its subject with reply/forward prefixes stripped. Used to
// count how many DISTINCT conversations a recurring image spans: a true signature/logo recurs
// across many unrelated conversations, whereas a content screenshot only recurs because it's
// quoted down a single reply chain (same subject). Counting conversations instead of raw
// emails stops thread-quoting from making genuine content look like a repeating signature.
// A subjectless email is its own conversation (keyed by id) so signatures there stay catchable.
const conversationKey = (doc: IndexedDoc): string => {
  const s = (doc.subject || '')
    .replace(/^((re|fwd|fw|aw|tr)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return s || 'id:' + doc.id
}

interface ResolvedExclusions {
  excludeShas: Set<string>
  autoLogoShas: Set<string>
  keepShas: Set<string>
  attHash: Record<string, AttHashEntry>
  /** false when no rule needed a scan (sets empty, attHash untouched). */
  scanned: boolean
  /** Debug: one CSV row per distinct attachment — its similarity key (dHash), how many
   *  distinct conversations it spans, and the exclusion decision + reason. Lets you see why
   *  an image was or wasn't set aside (e.g. a logo that recurs in too few conversations). */
  keyRows?: string[][]
}

/**
 * Resolve a collection's exclude/keep rules into content (sha256) sets — shared by the
 * production run and the UI "what would be excluded" preview so the two can't drift. Hashes
 * each email's attachments (sha always; a perceptual dHash for images only when a manual
 * image-exclude needs similarity), reusing the per-doc cache for unchanged emails.
 *   - autoLogoShas: content recurring in >=MIN_RECURRENCE emails that is a small image.
 *   - excludeShas:  manual exclusions expanded to every byte-identical + perceptually-similar copy.
 *   - keepShas:     restored exact files, stripped back out of the exclusion sets (they win).
 */
async function resolveExclusions(
  collection: Collection,
  emails: IndexedDoc[],
  savedAttHash: Record<string, AttHashEntry>,
  emit?: Emit,
  isCancelled: () => boolean = () => false
): Promise<ResolvedExclusions> {
  const excludePointers = new Set(collection.excludeFingerprints ?? [])
  const keepPointers = new Set(collection.keepAttachments ?? [])
  // Legacy by-name exclusions (the old "exclude all of this name" rule). Filename matching
  // is gone, but we still honour any pre-existing name rules by resolving them to content.
  const legacyExcludeNames = new Set((collection.excludeAttachments ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean))
  const needScan = !!collection.excludeSignatures || excludePointers.size > 0 || keepPointers.size > 0 || legacyExcludeNames.size > 0
  // Similarity matching for BOTH manual excludes and manual keeps: excluding "this + every
  // similar copy" and restoring "this + every similar copy" must be symmetric.
  const needPerceptual = excludePointers.size > 0 || keepPointers.size > 0
  // A perceptual dHash is needed for manual "exclude similar" AND for signature detection:
  // a covid/email banner recurs across many emails but the mail client re-encodes it each
  // time, so the copies aren't byte-identical (sha differs) — only the dHash consolidates them.
  const needDhash = needPerceptual || !!collection.excludeSignatures
  const attHash: Record<string, AttHashEntry> = {}
  const excludeShas = new Set<string>()
  const autoLogoShas = new Set<string>()
  const keepShas = new Set<string>()
  if (!needScan) return { excludeShas, autoLogoShas, keepShas, attHash, scanned: false }

  const phase = needPerceptual ? 'Matching similar attachments' : 'Scanning for repeated logos'
  emit?.({ type: 'index-progress', collectionId: collection.id, phase, done: 0, total: emails.length })
  const hashDoc = async (doc: IndexedDoc): Promise<AttHash[]> => {
    try {
      const mail = await simpleParser(await fs.readFile(doc.path))
      const out: AttHash[] = []
      for (const a of mail.attachments || []) {
        const buf = a.content
        if (!buf || !buf.length) continue
        const img = (a.contentType || '').startsWith('image/')
        out.push({ sha: sha256(buf), dhash: img && needDhash ? await dHash(buf) : null, size: buf.length, img, name: (a.filename || '').trim().toLowerCase() })
      }
      return out
    } catch {
      return []
    }
  }
  let next = 0
  let done = 0
  const pool = Math.max(2, Math.min(emails.length || 1, os.cpus().length || 4))
  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) return
      const idx = next++
      if (idx >= emails.length) return
      const doc = emails[idx]
      const cached = savedAttHash[doc.id]
      // Reuse the cached hashes only if the file is unchanged AND (dHashes aren't needed, or
      // they were computed by the CURRENT dHash version — else recompute to pick up decode fixes).
      const reusable =
        cached && cached.mtime === doc.modifiedAt && cached.size === doc.size && (!needDhash || (cached.perceptual && cached.pv === DHASH_VERSION))
      attHash[doc.id] = reusable ? cached : { mtime: doc.modifiedAt, size: doc.size, perceptual: needDhash, pv: DHASH_VERSION, atts: await hashDoc(doc) }
      done++
      if (done % 16 === 0 || done === emails.length) emit?.({ type: 'index-progress', collectionId: collection.id, phase, done, total: emails.length, currentFile: doc.name })
    }
  }
  await Promise.all(Array.from({ length: pool }, () => worker()))

  // Flatten the per-doc hashes into lookup structures. convsOf counts DISTINCT conversations
  // a sha appears in — NOT raw emails — so a content image quoted down one reply chain (which
  // inflates the email count) isn't mistaken for a signature. (A logo inlined twice in one
  // mail still counts once.)
  const all: AttHash[] = []
  const convsOf = new Map<string, Set<string>>()
  const byFp = new Map<string, AttHash[]>()
  for (const doc of emails) {
    const conv = conversationKey(doc)
    for (const a of attHash[doc.id]?.atts ?? []) {
      all.push(a)
      if (!convsOf.has(a.sha)) convsOf.set(a.sha, new Set())
      convsOf.get(a.sha)!.add(conv)
      const fp = fpOf(a.name, a.size)
      const arr = byFp.get(fp)
      if (arr) arr.push(a)
      else byFp.set(fp, [a])
    }
  }

  // Auto-logo: a small image that recurs across >=3 distinct CONVERSATIONS is a signature/
  // banner. Counting conversations (subject with re:/fwd: stripped), not raw emails, is what
  // separates a real recurring logo from a content screenshot that merely gets quoted down a
  // single thread. Counted two ways so re-encoded copies still consolidate:
  //   - exact bytes (sha256): a logo embedded byte-for-byte across many conversations.
  //   - perceptual (dHash): the SAME banner re-encoded by the mail client each send, so the
  //     copies differ byte-wise (distinct sha) but share a dHash — e.g. a covid email banner
  //     that appears, slightly recompressed, across dozens of threads.
  if (collection.excludeSignatures) {
    for (const [sha, set] of convsOf) {
      if (set.size < MIN_RECURRENCE) continue
      const rep = all.find((a) => a.sha === sha)
      if (rep && rep.img && rep.size <= LOGO_MAX_BYTES) autoLogoShas.add(sha)
    }
    // Perceptual recurrence: group small images by dHash, count the DISTINCT conversations
    // each group spans, and set aside every copy of any group that recurs enough. Re-encoded
    // copies of one banner share an identical dHash, so grouping by the hash string is
    // enough here (no fuzzy join needed) and stays cheap.
    const convsOfDhash = new Map<string, Set<string>>()
    const shasOfDhash = new Map<string, Set<string>>()
    for (const doc of emails) {
      const conv = conversationKey(doc)
      for (const a of attHash[doc.id]?.atts ?? []) {
        if (!a.img || !a.dhash || a.size > LOGO_MAX_BYTES) continue
        if (!convsOfDhash.has(a.dhash)) {
          convsOfDhash.set(a.dhash, new Set())
          shasOfDhash.set(a.dhash, new Set())
        }
        convsOfDhash.get(a.dhash)!.add(conv)
        shasOfDhash.get(a.dhash)!.add(a.sha)
      }
    }
    for (const [dh, set] of convsOfDhash)
      if (set.size >= MIN_RECURRENCE) for (const sha of shasOfDhash.get(dh)!) autoLogoShas.add(sha)
  }

  // Manual exclude: resolve each pointer to the attachment(s) it names, then expand to every
  // byte-identical copy (sha) and, for images, every perceptually-similar copy.
  const refDhashes: string[] = []
  const addRef = (a: AttHash): void => {
    excludeShas.add(a.sha)
    if (a.dhash) refDhashes.push(a.dhash)
  }
  for (const fp of excludePointers) for (const a of byFp.get(fp) ?? []) addRef(a)
  for (const a of all) if (legacyExcludeNames.has(a.name)) addRef(a)
  if (refDhashes.length) for (const a of all) if (a.dhash && refDhashes.some((r) => hamming(a.dhash as string, r) <= DHASH_THRESHOLD)) excludeShas.add(a.sha)

  // Keep (restore): resolve each pointer to the attachment(s) it names, then expand to every
  // byte-identical copy (sha) and, for images, every perceptually-similar copy — mirroring
  // manual exclude, so restoring one banner restores all its re-encoded twins. Keep wins over
  // every exclusion rule, so it's applied last.
  const keepDhashes: string[] = []
  for (const fp of keepPointers)
    for (const a of byFp.get(fp) ?? []) {
      keepShas.add(a.sha)
      if (a.dhash) keepDhashes.push(a.dhash)
    }
  if (keepDhashes.length)
    for (const a of all) if (a.dhash && keepDhashes.some((r) => hamming(a.dhash as string, r) <= DHASH_THRESHOLD)) keepShas.add(a.sha)
  for (const sha of keepShas) {
    excludeShas.delete(sha)
    autoLogoShas.delete(sha)
  }

  // Debug report: one row per DISTINCT attachment (by content sha) with its similarity key
  // (dHash), how many distinct conversations it spans (sha-exact and dHash-group, whichever
  // is higher — that's what the auto-logo rule counts), and the exclusion decision + reason.
  // Makes "why wasn't this logo caught?" answerable at a glance (usually: too few distinct
  // conversations, or no usable dHash, or larger than the logo size cap).
  const convsByDhash = new Map<string, Set<string>>()
  for (const doc of emails) {
    const conv = conversationKey(doc)
    for (const a of attHash[doc.id]?.atts ?? []) {
      if (!a.img || !a.dhash || a.size > LOGO_MAX_BYTES) continue
      if (!convsByDhash.has(a.dhash)) convsByDhash.set(a.dhash, new Set())
      convsByDhash.get(a.dhash)!.add(conv)
    }
  }
  const keyRows: string[][] = [
    ['Filename', 'Size (bytes)', 'sha256 (short)', 'dHash (similarity key)', 'Distinct conversations', 'Decision', 'Reason']
  ]
  const seen = new Set<string>()
  for (const a of all) {
    if (seen.has(a.sha)) continue
    seen.add(a.sha)
    const recur = Math.max(convsOf.get(a.sha)?.size ?? 0, a.dhash ? convsByDhash.get(a.dhash)?.size ?? 0 : 0)
    let decision = 'produced'
    let reason: string
    if (keepShas.has(a.sha)) {
      decision = 'kept'
      reason = 'restored / keep rule (overrides all exclusions)'
    } else if (excludeShas.has(a.sha)) {
      decision = 'excluded'
      reason = 'manual exclude rule'
    } else if (autoLogoShas.has(a.sha)) {
      decision = 'excluded'
      reason = `recurring logo — appears in ${recur} conversations (>= ${MIN_RECURRENCE})`
    } else if (collection.excludeSignatures && a.size > 0 && a.size < SMALL_ATTACHMENT_BYTES) {
      decision = 'excluded'
      reason = `under ${Math.round(SMALL_ATTACHMENT_BYTES / 1024)} KB`
    } else if (!a.img) {
      reason = 'not an image (only exact-copy or manual rules apply)'
    } else if (!a.dhash) {
      reason = 'no similarity key — low-entropy/undecodable image; only exact-copy recurrence can catch it'
    } else if (a.size > LOGO_MAX_BYTES) {
      reason = `image larger than ${Math.round(LOGO_MAX_BYTES / 1024)} KB — too big to treat as a logo`
    } else if (recur < MIN_RECURRENCE) {
      reason = `recurs in only ${recur} conversation(s) — needs >= ${MIN_RECURRENCE} to be auto-flagged`
    } else {
      reason = 'kept as content'
    }
    keyRows.push([a.name, String(a.size), a.sha.slice(0, 12), a.dhash ?? 'none', String(recur), decision, reason])
  }
  // Same image (sha) can recur; one row each is enough, but sort so duplicates/near-misses
  // sit together: by dHash, then size, then name.
  keyRows.splice(1, keyRows.length, ...keyRows.slice(1).sort((x, y) => x[3].localeCompare(y[3]) || Number(x[1]) - Number(y[1]) || x[0].localeCompare(y[0])))

  return { excludeShas, autoLogoShas, keepShas, attHash, scanned: true, keyRows }
}

/**
 * The set of attachment fingerprints (name|size) the CURRENT rules would exclude — so the
 * file tree can flag every matching copy (any filename) the instant a rule changes, without
 * waiting for a re-run. Reuses the production hash cache and warms it for the next run.
 */
export async function previewExcludedFingerprints(collection: Collection, docs: IndexedDoc[]): Promise<string[]> {
  const emails = docs.filter((d) => d.kind === 'email')
  const manifest = (await getProductionManifest(collection.id)) as { attHash?: Record<string, AttHashEntry> } | null
  const { excludeShas, autoLogoShas, keepShas, attHash, scanned } = await resolveExclusions(collection, emails, manifest?.attHash ?? {})
  if (!scanned) return []
  const keepNames = new Set((collection.keepNames ?? []).map((s) => s.trim().toLowerCase()))
  const out = new Set<string>()
  for (const doc of emails)
    for (const a of attHash[doc.id]?.atts ?? []) {
      if (keepNames.has(a.name) || keepShas.has(a.sha)) continue
      if (excludeShas.has(a.sha) || autoLogoShas.has(a.sha)) out.add(fpOf(a.name, a.size))
    }
  // Warm the manifest's hash cache (preserving config/items) so the next preview/run is fast.
  try {
    const m = (await getProductionManifest(collection.id)) as Record<string, unknown> | null
    await saveProductionManifest(collection.id, { ...(m ?? {}), attHash })
  } catch {
    /* best-effort cache warm */
  }
  return [...out]
}

/**
 * The set of attachment fingerprints (name|size) the CURRENT keep rules would RESTORE —
 * every copy a restore reaches, including perceptually-similar re-encoded twins under other
 * filenames. Lets the tree show that restoring one excluded image will bring back its
 * look-alikes too, without waiting for a re-run. Same resolver the production uses.
 */
export async function previewKeptFingerprints(collection: Collection, docs: IndexedDoc[]): Promise<string[]> {
  const emails = docs.filter((d) => d.kind === 'email')
  const manifest = (await getProductionManifest(collection.id)) as { attHash?: Record<string, AttHashEntry> } | null
  const { keepShas, attHash, scanned } = await resolveExclusions(collection, emails, manifest?.attHash ?? {})
  if (!scanned) return []
  const keepNames = new Set((collection.keepNames ?? []).map((s) => s.trim().toLowerCase()))
  const out = new Set<string>()
  for (const doc of emails)
    for (const a of attHash[doc.id]?.atts ?? []) {
      if (keepShas.has(a.sha) || keepNames.has(a.name)) out.add(fpOf(a.name, a.size))
    }
  return [...out]
}

export async function buildProduction(
  collection: Collection,
  docs: IndexedDoc[],
  emit: Emit,
  isCancelled: () => boolean
): Promise<ProductionResult> {
  const features = collection.features as ProcessFeatures
  const outRoot = path.resolve(collection.output as string)
  const result: ProductionResult = { pdfCount: 0, processed: 0, skipped: 0, removed: 0, slipSheets: 0, excludedAttachments: 0, errors: [] }
  // "Keep all of this name" — a name-scoped override that wins over every exclusion rule.
  // (The exclude/keep POINTER rules are resolved to content inside resolveExclusions below.)
  const keepNames = new Set((collection.keepNames ?? []).map((s) => s.trim().toLowerCase()))
  await fs.mkdir(outRoot, { recursive: true })

  // A review index or production includes every doc; "convert to PDF" alone produces
  // just emails. With convert off, documents are copied as natives instead of rendered.
  const fullProduction = features.reviewIndex || features.loadFile
  const convert = features.emailToPdf
  // Bates order: documents already produced keep their prior position (so their
  // Bates number never shifts and they're reused as-is); newly added documents are
  // appended after, path-sorted. This makes "add sources" incremental — only the
  // new documents are processed, matching how Bates numbers are assigned in practice
  // (existing production stays numbered; new docs get the next numbers).
  const saved = (await getProductionManifest(collection.id)) as {
    config?: string
    items?: ProdItem[]
    attHash?: Record<string, AttHashEntry>
    /** Resolved exclude∪autoLogo∪keep shas from the last run — diffed to find which docs
     *  a changed decision actually touches (per-doc re-render). */
    decisionShas?: string[]
  } | null
  const priorOrder = new Map((saved?.items ?? []).map((it, i) => [it.id, i] as const))
  const targets = productionTargets(docs, features).sort((a, b) => {
    const ia = priorOrder.has(a.id) ? (priorOrder.get(a.id) as number) : Number.MAX_SAFE_INTEGER
    const ib = priorOrder.has(b.id) ? (priorOrder.get(b.id) as number) : Number.MAX_SAFE_INTEGER
    return ia !== ib ? ia - ib : a.path.localeCompare(b.path)
  })

  // A review index / production needs Bates; default a prefix if the user didn't set one.
  const bates = collection.bates ?? (fullProduction ? { prefix: 'DOC-', start: 1 } : null)
  const assignBates = !!bates
  const prefix = bates?.prefix ?? ''
  let batesNext = bates?.start ?? 1
  const label = (n: number): string => prefix + String(n).padStart(PAD, '0')

  // Item numbering: one sequential, zero-padded number per family (= per produced document),
  // prefixed onto every file the family writes (e.g. `0001 - Smith.pdf`). Opt-in; the width
  // is set by the document count (min 4 digits) so the numbers sort correctly in a listing.
  const itemNumbering = !!collection.itemNumbering
  const itemPad = Math.max(4, String(targets.length).length)
  const itemPrefixFor = (n: number): string => (itemNumbering ? String(n).padStart(itemPad, '0') + ' - ' : '')

  // Mirror the input layout in the output: a file under source folder "<root>"
  // lands at Documents/<root-name>/<path-within-root>, so the produced bundle keeps
  // the source folders and their structure (and same-named subfolders from different
  // sources don't merge). A file added as a source on its own just uses its filename.
  const inRoots = collection.folders.map((f) => path.resolve(f))
  const relFor = (p: string): string => {
    const root = inRoots.find((r) => p === r || p.startsWith(r + path.sep))
    if (!root || p === root) return path.basename(p)
    return path.join(path.basename(root), path.relative(root, p))
  }

  // Resolve every exclude/keep rule into content (sha256) sets — the SAME resolver the UI
  // preview uses, so what the tree flags and what the run excludes can never disagree.
  const emails = targets.filter((d) => d.kind === 'email')
  const { excludeShas, autoLogoShas, keepShas, attHash, scanned, keyRows } = await resolveExclusions(collection, emails, saved?.attHash ?? {}, emit, isCancelled)
  // sha256 → { perceptual key, is-image } so produced IMAGE attachments can carry their dHash
  // in the name (the key the Excluded/ folder shows). Non-images (PDFs, Office, zips, video)
  // get no decoration — a dHash is meaningless for them, so "dh=none" there is just noise.
  const attKeyBySha = new Map<string, { dh: string | null; img: boolean }>()
  for (const e of Object.values(attHash)) for (const a of e.atts ?? []) if (!attKeyBySha.has(a.sha)) attKeyBySha.set(a.sha, { dh: a.dhash, img: a.img })

  // The resolved, content-based exclusion decision for this run — every render and
  // excluded-collection call shares it so they all agree.
  const exclOpts: ExclusionSets = { excludeSignatures: !!collection.excludeSignatures, excludeShas, autoLogoShas, keepShas, keepNames }

  // Scan input-vs-output: reuse documents that are unchanged AND would land on the
  // same Bates number; only (re)render new/changed docs (or ones whose numbering
  // shifted because something earlier in the sequence changed).
  emit({ type: 'index-progress', collectionId: collection.id, phase: 'Checking for changes', done: 0, total: targets.length })
  // Set-wide render options. If any differ from the last run, every cached PDF is stale,
  // so ignore the manifest and re-render everything. The specific exclude/keep CONTENT
  // sets are deliberately NOT here — those touch only the docs that actually carry the
  // affected content, so they invalidate per-doc (below). keepNames IS here (name-scoped,
  // can't be diffed against content keys, and changes rarely): a change re-renders all.
  const configKey = JSON.stringify({
    combine: true, // attachments are always merged into the email PDF now
    attKeyInName: 1, // produced attachment files carry their size+dHash in the name (bump to re-render)
    dhashV: DHASH_VERSION, // a dHash-algorithm change refreshes the size+dHash decoration on produced files
    separate: !!collection.separateAttachments,
    itemNumbering: !!collection.itemNumbering, // changes produced filenames → re-render all
    excludeSignatures: !!collection.excludeSignatures,
    keepNames: [...keepNames].sort(),
    bates: collection.bates ?? null,
    emailToPdf: features.emailToPdf,
    // Only what affects RENDERING belongs here. Review index / load file individually
    // don't change the PDFs — they only widen the render SCOPE to every doc (vs emails
    // only), captured by this one flag. So enabling the load file when a review index is
    // already on regenerates the load file from existing records WITHOUT re-rendering.
    fullProduction: features.reviewIndex || features.loadFile
  })
  const prevManifest = saved && saved.config === configKey ? saved.items ?? [] : []
  const prevById = new Map(prevManifest.map((p) => [p.id, p]))

  // Per-doc invalidation for exclude/restore: a doc is re-rendered only if one of its own
  // attachments had its exclusion decision flipped since the last run. The decision is the
  // resolved sha set (exclude ∪ autoLogo ∪ keep); diff it against the saved set, then a doc
  // is affected iff it carries an attachment whose sha is in that diff. So toggling one
  // attachment re-renders only the docs that actually contain matching content.
  const decisionShas = [...new Set([...excludeShas, ...autoLogoShas, ...keepShas])]
  const changedShas = symmetricDiff(saved?.decisionShas ?? [], decisionShas)
  const excludeChanged = changedShas.size > 0
  const docAffected = (prev: ProdItem): boolean => !!prev.attKeys?.some((sha) => changedShas.has(sha))
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
  // Reused emails that carry attachments — we re-collect their excluded attachments
  // (parse only, no render) when the Excluded/ folder needs rebuilding.
  const reusedWithAtts: { doc: IndexedDoc; rel: string }[] = []
  const renderOpts: RenderOpts = { ...exclOpts, convert, combine: true, separate: !!collection.separateAttachments }

  // Numbering (Bates) is strictly sequential — each document's number depends on the
  // page count of every document before it — but RENDERING (the slow part) is not.
  // So: render in parallel, then number + write in order.
  //
  // Phase 1 — classify. A document is reusable when its file and the attachment rules
  // are unchanged since the last run; this is render-free, so it's cheap.
  type Plan = { doc: IndexedDoc; rel: string; prev?: ProdItem; contentReuse: boolean }
  const plans: Plan[] = []
  for (const doc of targets) {
    const prev = prevById.get(doc.id)
    const contentReuse =
      !!prev && prev.mtime === doc.modifiedAt && prev.size === doc.size && !docAffected(prev) && (await outputExists(prev.fileRel))
    plans.push({ doc, rel: relFor(doc.path), prev, contentReuse })
  }

  // Phase 2 — render every changed document concurrently across a window pool.
  const rendered = new Map<string, Rendered>()
  let renderDone = 0
  const changed = plans.filter((p) => !p.contentReuse)
  // The honest denominator for "Rendering documents" is how many docs actually get
  // rendered — the changed ones now, plus the Bates-shifted ones found in phase 3 (added
  // to renderTotal before phase 4). Phases 2 and 4 share emitRender, so renderDone spans
  // both; keeping renderTotal in step means the count reads e.g. 3/12, not a meaningless
  // 12/12. (Was Math.max(changed.length, renderDone), which made total track done.)
  let renderTotal = changed.length
  const emitRender = (doc: IndexedDoc): void => {
    renderDone++
    emit({ type: 'index-progress', collectionId: collection.id, phase: 'Rendering documents', done: renderDone, total: renderTotal, currentFile: doc.name })
  }
  if (!isCancelled()) await renderInParallel(changed, outRoot, renderOpts, result, excludedSink, rendered, isCancelled, emitRender)

  // Phase 3 — a content-unchanged document still needs a fresh stamp if an earlier
  // document changed page count and pushed its Bates number along. Walk in order with
  // predicted page spans to find those shifted documents.
  const spanOf = (p: Plan): number =>
    p.contentReuse ? p.prev?.batesSpan ?? p.prev?.pages ?? 0 : rendered.get(p.doc.id)?.pages ?? 0
  const shifted: Plan[] = []
  let planBates = batesNext
  plans.forEach((p, idx) => {
    // A reused doc must re-render if its Bates number drifted OR (when item numbering is on)
    // its item number drifted — either changes a stamp or the filename prefix on disk.
    const batesShift = assignBates && p.contentReuse && p.prev && p.prev.begBates !== label(planBates)
    const itemShift = itemNumbering && p.contentReuse && p.prev && p.prev.itemNo !== idx + 1
    if (batesShift || itemShift) shifted.push(p)
    planBates += spanOf(p)
  })

  // Phase 4 — render the shifted documents in parallel too (re-stamping a PDF means
  // re-rendering it: the on-disk copy already carries its old number). Now that we know
  // how many shifted, fold them into the rendering denominator.
  renderTotal += shifted.length
  if (!isCancelled() && shifted.length) await renderInParallel(shifted, outRoot, renderOpts, result, excludedSink, rendered, isCancelled, emitRender)

  // Phase 5 — number + write in strict order. Reuse only when the file is unchanged AND
  // the Bates number still matches; otherwise stamp from the render (or, in the rare
  // case a number drifted unexpectedly, render inline now as a fallback).
  const inlineWin = makeRenderWindow()
  try {
    for (let i = 0; i < plans.length; i++) {
      if (isCancelled()) break
      const p = plans[i]
      const itemNo = i + 1
      emit({ type: 'index-progress', collectionId: collection.id, phase: 'Numbering documents', done: i, total: plans.length, currentFile: p.doc.name })
      if (p.contentReuse && p.prev && (!assignBates || p.prev.begBates === label(batesNext)) && (!itemNumbering || p.prev.itemNo === itemNo)) {
        // One-time migration: an earlier run named a PDF `…pdf.pdf` (base already ended
        // in .pdf). Rename it to the single-extension form and fix the stored path so the
        // load file / review index pick it up — without forcing a re-render.
        const prev = await fixDoubledPdfName(outRoot, p.prev)
        items.push(prev) // reuse the already-produced document + its Bates
        used.add(path.join(outRoot, prev.fileRel).toLowerCase())
        batesNext += prev.batesSpan ?? prev.pages
        result.skipped++
        result.pdfCount++
        if (prev.attKeys && prev.attKeys.length) reusedWithAtts.push({ doc: p.doc, rel: p.rel })
        continue
      }
      let r = rendered.get(p.doc.id)
      if (!r) {
        try {
          r = await renderOne(inlineWin, p.doc, outRoot, p.rel, renderOpts, result, excludedSink)
        } catch (e) {
          result.errors.push({ file: p.doc.path, error: (e as Error).message })
          continue
        }
      }
      try {
        const { rec, excludedMeta, attKeys, files } = await writeRendered(r, outRoot, batesNext, prefix, assignBates, used, result, itemPrefixFor(itemNo), attKeyBySha)
        items.push({ id: p.doc.id, path: p.doc.path, mtime: p.doc.modifiedAt, size: p.doc.size, excluded: excludedMeta, attKeys, files, itemNo: itemNumbering ? itemNo : 0, ...rec })
        batesNext += rec.batesSpan
        result.processed++
        result.pdfCount++
      } catch (e) {
        result.errors.push({ file: p.doc.path, error: (e as Error).message })
      }
    }
  } finally {
    inlineWin.destroy()
  }
  emit({ type: 'index-progress', collectionId: collection.id, phase: 'Numbering documents', done: targets.length, total: targets.length })

  // Rebuild the Excluded/ folder + map + listing whenever the excluded set could have
  // changed (an exclude/restore toggle, or any doc re-rendered). Re-rendered docs
  // already filled excludedSink; top it up with the reused docs' excluded attachments
  // (parse only) so the folder stays complete without re-rendering them.
  const summary = excludedSummary(items.flatMap((i) => i.excluded ?? []))
  result.excludedAttachments = summary.total
  const rebuildExcluded = excludeChanged || result.processed > 0
  if (!isCancelled() && rebuildExcluded) {
    for (const { doc, rel } of reusedWithAtts) {
      if (isCancelled()) break
      excludedSink.push(...(await collectExcluded(doc, rel, exclOpts)))
    }
    if (!isCancelled()) await writeExcludedFolder(outRoot, excludedSink)
  }

  // Write the attachment-keys debug report (similarity key + recurrence + decision per
  // image) into Excluded/, alongside the grouping debug. Written after the rebuild above so
  // it survives writeExcludedFolder's fresh-slate wipe.
  if (!isCancelled() && keyRows && keyRows.length > 1) {
    const exclDir = path.join(outRoot, 'Excluded')
    await fs.mkdir(exclDir, { recursive: true })
    await fs.writeFile(path.join(exclDir, '_attachment-keys.csv'), toCsv(keyRows))
  }

  // A full run produced every current document, so `items` is the complete picture of
  // what Documents/ should contain. Sweep anything an earlier run left behind that no
  // longer belongs — a now-excluded attachment still sitting beside its email, an
  // abandoned family folder, or the output of a document removed from the set. Skipped
  // on a cancelled run, where `items` is only partial.
  if (!isCancelled()) await sweepStaleOutputs(outRoot, items)

  // Persist the manifest (full or partial) so a paused run resumes from here. attHash
  // caches attachment content hashes so the next run's prescan skips re-hashing unchanged
  // emails; decisionShas is the resolved exclusion set, diffed next run for per-doc reuse.
  await saveProductionManifest(collection.id, {
    config: configKey,
    items,
    attHash: scanned ? attHash : (saved?.attHash ?? {}),
    decisionShas
  })
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
