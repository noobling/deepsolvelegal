import type { IndexedDoc } from '@shared/types'

// Pure column builders for the production deliverables — no Electron, so they're
// unit-testable on their own. production.ts renders the PDFs and feeds the
// resulting records through these to build each spreadsheet / load file.

export interface ProdRecord {
  begBates: string
  endBates: string
  pages: number
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
  attCount: number
  attNames: string
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
  'FROM', 'TO', 'CC', 'SUBJECT', 'DOC TYPE', 'FILE NAME', 'PAGE COUNT', 'ATTACHMENT NAMES'
]

/**
 * External production load-file rows. Each produced PDF is one document; the
 * family range (BEGATTACH/ENDATTACH) spans that document's own Bates range.
 */
export function loadFileRows(records: ProdRecord[]): string[][] {
  return records.map((r) => [
    r.begBates,
    r.endBates,
    r.begBates, // BEGATTACH
    r.endBates, // ENDATTACH
    '', // CUSTODIAN (not derivable)
    r.date,
    r.from,
    r.to,
    r.cc,
    r.subject,
    r.docType,
    r.fileRel,
    r.pages ? String(r.pages) : '',
    r.attNames
  ])
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

/**
 * Which documents to render: a review index or a production renders every doc so
 * it can carry a Bates number; "email→PDF" alone renders just the emails.
 */
export function productionTargets<T extends { kind: 'email' | 'doc' }>(
  docs: T[],
  features: { emailToPdf: boolean; reviewIndex: boolean; loadFile: boolean }
): T[] {
  const full = features.reviewIndex || features.loadFile
  return docs.filter((d) => full || (features.emailToPdf && d.kind === 'email'))
}
