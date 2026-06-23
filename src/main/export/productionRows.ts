import type { IndexedDoc } from '@shared/types'

// Pure column builders for the production deliverables — no Electron, so they're
// unit-testable on their own. production.ts renders the PDFs and feeds the
// resulting records through these to build each spreadsheet / load file.

export interface ProdRecord {
  begBates: string
  endBates: string
  /** Pages in the produced PDF; 0 for a native (not page-stamped) document. */
  pages: number
  /** Bates numbers this document consumes: pages for a PDF, 1 for a native copy. */
  batesSpan: number
  date: string
  from: string
  to: string
  cc: string
  /** Email subject, or a document's title/name. */
  subject: string
  docType: string
  kind: 'email' | 'doc'
  /** Produced PDF path, relative to the output folder. */
  fileRel: string
  /** For a natively-produced document (a spreadsheet, or an image/slip-sheet that has a native
   *  companion): the native file's path, relative to the output folder — emitted as NATIVELINK
   *  so a review platform loads the original file alongside the Bates-stamped image. */
  nativeRel?: string
  attCount: number
  attNames: string
  /** Family range (BEGATTACH/ENDATTACH): the first Bates of the parent email through the
   *  last Bates of its final attachment. Every member of a family carries the SAME range, so
   *  a review platform can reconstruct the parent↔child grouping. Filled when flattening the
   *  per-family records for the load file; falls back to this document's own range. */
  begAttach?: string
  endAttach?: string
}

export const REVIEW_HEADER = [
  'Beginning Bates', 'Ending Bates', 'Pages', 'Date', 'Type', 'From', 'To', 'Subject / Title', 'File', '# Attachments'
]

/** Review index rows — human-readable, for your own review team (internal). */
export function reviewIndexRows(records: ProdRecord[]): string[][] {
  return records.map((r) => [
    r.begBates,
    r.endBates,
    r.pages ? String(r.pages) : '',
    r.date,
    r.docType,
    r.from,
    r.to,
    r.subject,
    r.fileRel,
    r.attCount ? String(r.attCount) : ''
  ])
}

export const LOADFILE_HEADER = [
  'BEGBATES', 'ENDBATES', 'BEGATTACH', 'ENDATTACH', 'CUSTODIAN', 'DATE SENT',
  'FROM', 'TO', 'CC', 'SUBJECT', 'DOC TYPE', 'FILE NAME', 'NATIVELINK', 'PAGE COUNT', 'ATTACHMENT NAMES'
]

/**
 * External production load-file rows. Each produced PDF is one document (the parent email
 * and each of its attachments are separate documents); the family range BEGATTACH/ENDATTACH
 * spans the parent through its last attachment, so the receiving platform can rebuild the
 * family. Falls back to the document's own range for a standalone document.
 */
export function loadFileRows(records: ProdRecord[]): string[][] {
  return records.map((r) => [
    r.begBates,
    r.endBates,
    r.begAttach || r.begBates, // BEGATTACH (family head)
    r.endAttach || r.endBates, // ENDATTACH (family tail)
    '', // CUSTODIAN (not derivable)
    r.date,
    r.from,
    r.to,
    r.cc,
    r.subject,
    r.docType,
    r.fileRel,
    r.nativeRel || '', // NATIVELINK — original file for a natively-produced document
    r.pages ? String(r.pages) : '',
    r.attNames
  ])
}

/**
 * Opticon (.OPT) image cross-reference rows — ONE LINE PER PAGE, the page-level file a review
 * platform uses to map every Bates-stamped page to its image. Seven fields per the DOJ/Opticon
 * spec: PageID, VolumeLabel, ImageFilePath, DocumentBreak, FolderBreak, BoxBreak, PageCount.
 *   - PageID is that page's own Bates (begBates for page 1, +1 each page after).
 *   - ImageFilePath is the produced PDF (all pages of a multi-page doc point at the same file).
 *   - DocumentBreak = "Y" on a document's first page; PageCount is set only on that first page.
 * Records with no pages (a native-only passthrough) carry no image, so they're skipped. Paths
 * use backslashes, the Opticon convention.
 */
export function opticonRows(records: ProdRecord[], prefix: string, pad: number): string[][] {
  const rows: string[][] = []
  for (const r of records) {
    const start = parseInt(r.begBates.slice(prefix.length), 10)
    if (!r.begBates || r.pages <= 0 || !Number.isFinite(start)) continue
    const image = r.fileRel.replace(/\//g, '\\')
    for (let i = 0; i < r.pages; i++) {
      const pageId = prefix + String(start + i).padStart(pad, '0')
      rows.push([pageId, '', image, i === 0 ? 'Y' : '', '', '', i === 0 ? String(r.pages) : ''])
    }
  }
  return rows
}

export const HIGHLIGHT_HEADER = ['Document', 'Page', 'Colour', 'Highlight', 'Context']

/** Flatten every reviewer highlight across the set into export rows. */
export function highlightRows(docs: Pick<IndexedDoc, 'name' | 'highlights'>[]): string[][] {
  const rows: string[][] = []
  for (const d of docs) {
    for (const h of d.highlights || []) {
      rows.push([d.name, h.page != null ? String(h.page) : '', h.color, h.text, h.context || ''])
    }
  }
  return rows
}

/** Entries present in exactly one of two lists — i.e. whose membership flipped. */
export function symmetricDiff(prev: string[], cur: string[]): Set<string> {
  const a = new Set(prev)
  const b = new Set(cur)
  return new Set([...a, ...b].filter((x) => a.has(x) !== b.has(x)))
}

// Two copies of a same-named attachment count as "the same" document when their
// sizes are within this tolerance — exact bytes needn't match, since a re-encode or
// an embedded timestamp shifts a few bytes (or none) without changing the document.
const SIZE_TOL_FRAC = 0.02 // ±2%
const SIZE_TOL_MIN = 256 // bytes (floor, so tiny files aren't over-split)

/** Whether two file sizes are close enough to be treated as the same document. */
export function sameApproxSize(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(SIZE_TOL_MIN, Math.floor(Math.max(a, b) * SIZE_TOL_FRAC))
}

/**
 * Cluster sizes so copies within tolerance group together: sort ascending and
 * start a new cluster wherever the gap to the previous size exceeds tolerance.
 * One cluster ⇒ consistent; two or more ⇒ genuinely different files share a name.
 */
export function sizeClusters(sizes: number[]): number[][] {
  const clusters: number[][] = []
  for (const s of [...sizes].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1]
    if (last && sameApproxSize(last[last.length - 1], s)) last.push(s)
    else clusters.push([s])
  }
  return clusters
}

/**
 * Summarize excluded attachments for the whole set. Copies of a filename are
 * "consistent" when their sizes fall in one tolerance cluster (see sizeClusters);
 * a filename whose copies split into two or more clusters is flagged for review
 * (one may be a real document misnamed like the boilerplate). Counts are derived
 * from metadata so they stay correct on incremental runs without re-reading docs.
 */
export function excludedSummary(meta: { name: string; size: number }[]): { total: number; inconsistentNames: number } {
  const byName = new Map<string, number[]>()
  for (const m of meta) {
    const key = m.name.trim().toLowerCase()
    const sizes = byName.get(key)
    if (sizes) sizes.push(m.size)
    else byName.set(key, [m.size])
  }
  let inconsistentNames = 0
  for (const sizes of byName.values()) if (sizeClusters(sizes).length > 1) inconsistentNames++
  return { total: meta.length, inconsistentNames }
}

/**
 * Which documents go into the production: a review index or a production includes
 * every doc so it can carry a Bates number (rendered to PDF, or copied as a native
 * when "Convert to PDF" is off); "email→PDF" alone produces just the emails.
 */
export function productionTargets<T extends { kind: 'email' | 'doc' }>(
  docs: T[],
  features: { emailToPdf: boolean; reviewIndex: boolean; loadFile: boolean }
): T[] {
  const full = features.reviewIndex || features.loadFile
  return docs.filter((d) => full || (features.emailToPdf && d.kind === 'email'))
}
