// Browser Bates production. Renders each document to a Bates-stamped PDF, handles emails as
// families (email body + its attachments, with BEGATTACH/ENDATTACH), applies content-based
// attachment exclusion (exact sha256 dedupe + auto-logo = small image repeated ≥3×), and
// emits Concordance .DAT + .CSV load files. Packaged as a downloadable ZIP. No server.
//
// Note: Office files (.docx/.xlsx/.pptx) can't be rendered to an imaged PDF in a pure browser
// (no Chromium/LibreOffice), so they're produced as a Bates-stamped slip-sheet referencing the
// native. PDFs are stamped in place; images are embedded; emails are rendered (see email.ts).
import type { PDFDocument, PDFFont } from 'pdf-lib'
import type { IndexedDoc } from './types'
import { parseEmail, emailToPdf } from './email'

export interface ProductionConfig {
  prefix: string
  start: number
  pad: number
  custodian: string
}
export interface ProducedItem {
  beginBates: string
  endBates: string
  pages: number
  fileName: string
  pdfName: string
  pdfBytes: Uint8Array
  isAttachment: boolean
  from?: string
  to?: string
  subject?: string
  date?: string
  beginAttach?: string
  endAttach?: string
}
export interface ExcludedItem { name: string; reason: string; parent: string }
export interface ProductionResult { items: ProducedItem[]; excluded: ExcludedItem[]; config: ProductionConfig }

/** One attachment surfaced for the manual include/exclude review step. */
export interface ScannedAttachment {
  key: string          // stable id: `${parentDocId}::${attachmentIndex}`
  parentDocId: string
  parentName: string
  name: string
  size: number
  mime: string
  isImage: boolean
  sha256: string
  autoReason: '' | 'duplicate' | 'logo/signature image'  // what auto-exclusion would flag
  thumb?: string       // data URL for small images
}

const LOGO_MAX_BYTES = 150 * 1024
const isImageName = (n: string): boolean => /\.(jpe?g|png|gif|bmp|tiff?)$/i.test(n)
const isEmbeddable = (n: string): boolean => /\.(jpe?g|png)$/i.test(n)
const THUMB_MAX = 96 * 1024  // only thumbnail small images, to keep the scan fast/light

async function makeThumb(mime: string, bytes: Uint8Array): Promise<string | undefined> {
  try {
    const blob = new Blob([bytes.slice()], { type: mime || 'image/png' })
    const bmp = await createImageBitmap(blob)
    const max = 64
    const s = Math.min(max / bmp.width, max / bmp.height, 1)
    const w = Math.max(1, Math.round(bmp.width * s))
    const h = Math.max(1, Math.round(bmp.height * s))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

/**
 * Parse every email and list its attachments for the manual review step, pre-flagging the ones
 * automatic exclusion would drop (exact duplicates + small repeated logo/signature images).
 */
export async function scanAttachments(
  docs: IndexedDoc[],
  getFile: (docId: string) => Promise<File> | undefined,
  onProgress?: (done: number, total: number) => void
): Promise<ScannedAttachment[]> {
  const emails = docs.filter((d) => d.kind === 'email')
  type Raw = { parentDocId: string; parentName: string; index: number; name: string; size: number; mime: string; isImage: boolean; hash: string; bytes: Uint8Array }
  const raws: Raw[] = []
  const hashCount = new Map<string, { count: number; size: number; img: boolean }>()
  let done = 0
  for (const doc of emails) {
    const f = await getFile(doc.id)
    if (f) {
      const parsed = await parseEmail(f, doc.ext)
      for (let i = 0; i < parsed.attachments.length; i++) {
        const att = parsed.attachments[i]
        const hash = await sha256(att.bytes)
        const img = isImageName(att.name)
        const cur = hashCount.get(hash) || { count: 0, size: att.bytes.length, img }
        cur.count++
        hashCount.set(hash, cur)
        raws.push({ parentDocId: doc.id, parentName: doc.name, index: i, name: att.name, size: att.bytes.length, mime: att.mime, isImage: img, hash, bytes: att.bytes })
      }
    }
    done++
    onProgress?.(done, emails.length)
  }
  const isLogoHash = (h: string): boolean => {
    const e = hashCount.get(h)
    return !!e && e.img && e.size <= LOGO_MAX_BYTES && e.count >= 3
  }
  const seen = new Set<string>()
  const out: ScannedAttachment[] = []
  for (const r of raws) {
    let autoReason: ScannedAttachment['autoReason'] = ''
    if (isLogoHash(r.hash)) autoReason = 'logo/signature image'
    else if (seen.has(r.hash)) autoReason = 'duplicate'
    seen.add(r.hash)
    const thumb = r.isImage && r.size <= THUMB_MAX ? await makeThumb(r.mime, r.bytes) : undefined
    out.push({ key: `${r.parentDocId}::${r.index}`, parentDocId: r.parentDocId, parentName: r.parentName, name: r.name, size: r.size, mime: r.mime, isImage: r.isImage, sha256: r.hash, autoReason, thumb })
  }
  return out
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const batesStr = (cfg: ProductionConfig, n: number): string => cfg.prefix + String(n).padStart(cfg.pad, '0')

type Lib = typeof import('pdf-lib')

/** Stamp each page bottom-right with consecutive Bates numbers; returns [begin, end]. */
function stamp(pdf: PDFDocument, font: PDFFont, lib: Lib, startN: number, cfg: ProductionConfig): [string, string] {
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    const label = batesStr(cfg, startN + i)
    const w = font.widthOfTextAtSize(label, 9)
    p.drawText(label, { x: p.getSize().width - 36 - w, y: 20, size: 9, font, color: lib.rgb(0.15, 0.15, 0.15) })
  })
  return [batesStr(cfg, startN), batesStr(cfg, startN + pages.length - 1)]
}

async function slipSheet(lib: Lib, fileName: string, note: string): Promise<PDFDocument> {
  const doc = await lib.PDFDocument.create()
  const font = await doc.embedFont(lib.StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  const lines = ['DOCUMENT PRODUCED IN NATIVE FORM', '', fileName, '', note]
  let y = 460
  for (const ln of lines) {
    const fs = ln === lines[0] ? 13 : 11
    const w = font.widthOfTextAtSize(ln, fs)
    page.drawText(ln, { x: (612 - w) / 2, y, size: fs, font, color: lib.rgb(0.2, 0.2, 0.2) })
    y -= 22
  }
  return doc
}

async function imageToPdf(lib: Lib, name: string, bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    const doc = await lib.PDFDocument.create()
    const img = /\.png$/i.test(name) ? await doc.embedPng(bytes.slice().buffer) : await doc.embedJpg(bytes.slice().buffer)
    const maxW = 540, maxH = 720
    const s = Math.min(maxW / img.width, maxH / img.height, 1)
    const page = doc.addPage([612, 792])
    page.drawImage(img, { x: (612 - img.width * s) / 2, y: (792 - img.height * s) / 2, width: img.width * s, height: img.height * s })
    return doc
  } catch {
    return null
  }
}

async function pdfFromFileBytes(lib: Lib, name: string, bytes: Uint8Array): Promise<PDFDocument> {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (ext === '.pdf') {
    try {
      return await lib.PDFDocument.load(bytes.slice().buffer, { ignoreEncryption: true })
    } catch {
      return slipSheet(lib, name, '(PDF could not be opened — produced as native)')
    }
  }
  if (isEmbeddable(name)) {
    const d = await imageToPdf(lib, name, bytes)
    if (d) return d
  }
  return slipSheet(lib, name, 'Original file is included in the production set.')
}

/**
 * Run a production. `docs` are the top-level indexed docs (sorted by caller); `getFile`
 * returns the original File for a doc id. Reports progress 0..1.
 */
export async function produce(
  docs: IndexedDoc[],
  getFile: (docId: string) => Promise<File> | undefined,
  cfg: ProductionConfig,
  onProgress: (done: number, total: number) => void,
  // Manual review result: attachment key (`${docId}::${index}`) → exclusion reason. When provided,
  // attachments are excluded ONLY per this map (auto logo/duplicate detection is bypassed for them,
  // since the user already reviewed those flags). When omitted, automatic exclusion applies.
  manualExclude?: Map<string, string>
): Promise<ProductionResult> {
  const lib = await import('pdf-lib')

  // Pre-pass: tally attachment hashes across all emails to spot repeated small-image logos.
  const parsedEmails = new Map<string, Awaited<ReturnType<typeof parseEmail>>>()
  const hashCount = new Map<string, { count: number; size: number; img: boolean }>()
  for (const doc of docs) {
    if (doc.kind !== 'email') continue
    const f = await getFile(doc.id)
    if (!f) continue
    const parsed = await parseEmail(f, doc.ext)
    parsedEmails.set(doc.id, parsed)
    for (const att of parsed.attachments) {
      const h = await sha256(att.bytes)
      const cur = hashCount.get(h) || { count: 0, size: att.bytes.length, img: isImageName(att.name) }
      cur.count++
      hashCount.set(h, cur)
    }
  }
  const isLogo = (h: string): boolean => {
    const e = hashCount.get(h)
    return !!e && e.img && e.size <= LOGO_MAX_BYTES && e.count >= 3
  }

  const items: ProducedItem[] = []
  const excluded: ExcludedItem[] = []
  const seen = new Set<string>()
  let counter = cfg.start
  let done = 0

  const addItem = async (pdf: PDFDocument, startN: number, fileName: string, isAttachment: boolean, extra: Partial<ProducedItem> = {}): Promise<ProducedItem> => {
    const f2 = await pdf.embedFont(lib.StandardFonts.Helvetica)
    const [begin, end] = stamp(pdf, f2, lib, startN, cfg)
    const pages = pdf.getPages().length
    const bytes = await pdf.save()
    const item: ProducedItem = { beginBates: begin, endBates: end, pages, fileName, pdfName: `${begin}.pdf`, pdfBytes: bytes, isAttachment, ...extra }
    items.push(item)
    counter = startN + pages
    return item
  }

  for (const doc of docs) {
    const file = await getFile(doc.id)
    if (!file) { done++; onProgress(done, docs.length); continue }

    if (doc.kind === 'email') {
      const parsed = parsedEmails.get(doc.id) || (await parseEmail(file, doc.ext))
      const emailPdf = await lib.PDFDocument.load((await emailToPdf(parsed)).slice().buffer)
      const familyStart = counter
      const emailItem = await addItem(emailPdf, familyStart, doc.name, false, {
        from: parsed.from, to: parsed.to, subject: parsed.subject, date: parsed.date
      })
      // Attachments (family members)
      let attBegin = ''
      let attEnd = ''
      for (let ai = 0; ai < parsed.attachments.length; ai++) {
        const att = parsed.attachments[ai]
        const h = await sha256(att.bytes)
        if (manualExclude) {
          const key = `${doc.id}::${ai}`
          if (manualExclude.has(key)) { excluded.push({ name: att.name, reason: manualExclude.get(key) || 'excluded', parent: emailItem.beginBates }); continue }
        } else {
          if (isLogo(h)) { excluded.push({ name: att.name, reason: 'logo/signature image', parent: emailItem.beginBates }); continue }
          if (seen.has(h)) { excluded.push({ name: att.name, reason: 'duplicate', parent: emailItem.beginBates }); continue }
        }
        seen.add(h)
        const pdf = await pdfFromFileBytes(lib, att.name, att.bytes)
        const it = await addItem(pdf, counter, att.name, true, { subject: att.name })
        if (!attBegin) attBegin = it.beginBates
        attEnd = it.endBates
      }
      if (attBegin) { emailItem.beginAttach = attBegin; emailItem.endAttach = attEnd }
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const h = await sha256(bytes)
      if (seen.has(h)) { excluded.push({ name: doc.name, reason: 'duplicate', parent: '' }); done++; onProgress(done, docs.length); continue }
      seen.add(h)
      const pdf = await pdfFromFileBytes(lib, doc.name, bytes)
      await addItem(pdf, counter, doc.name, false)
    }
    done++
    onProgress(done, docs.length)
  }

  return { items, excluded, config: cfg }
}

// ── Load files ──

const csvEsc = (v: string): string => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)

export function buildCsv(res: ProductionResult): string {
  const cols = ['BatesBegin', 'BatesEnd', 'BeginAttach', 'EndAttach', 'Custodian', 'FileName', 'From', 'To', 'Subject', 'DateSent']
  const rows = res.items.map((it) =>
    [it.beginBates, it.endBates, it.beginAttach || '', it.endAttach || '', res.config.custodian, it.fileName, it.from || '', it.to || '', it.subject || '', it.date || '']
      .map((v) => csvEsc(String(v)))
      .join(',')
  )
  return [cols.join(','), ...rows].join('\r\n')
}

/** Concordance .DAT — þ text-qualifier (0xFE), ¶ field-delimiter (0x14). */
export function buildDat(res: ProductionResult): string {
  const Q = String.fromCharCode(0xFE)
  const D = String.fromCharCode(0x14)
  const cols = ['BatesBegin', 'BatesEnd', 'BeginAttach', 'EndAttach', 'Custodian', 'FileName', 'From', 'To', 'Subject', 'DateSent', 'NativeLink']
  const line = (vals: string[]): string => vals.map((v) => Q + (v || '').replace(/þ/g, '') + Q).join(D)
  const header = line(cols)
  const body = res.items.map((it) =>
    line([it.beginBates, it.endBates, it.beginAttach || '', it.endAttach || '', res.config.custodian, it.fileName, it.from || '', it.to || '', it.subject || '', it.date || '', `NATIVES/${it.pdfName}`])
  )
  return [header, ...body].join('\r\n')
}
