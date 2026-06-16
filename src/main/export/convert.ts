import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  InsertedTextRun,
  DeletedTextRun,
  Table,
  TableRow,
  TableCell,
  WidthType
} from 'docx'
import type { ParagraphChild } from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import ExcelJS from 'exceljs'

// ── Markdown parsing helpers (intentionally lightweight) ──

interface MdTable {
  header: string[]
  rows: string[][]
}

// Bold, plus redline markup (<ins>/<del>) so revisions survive into Word as
// green-underline / red-strikethrough runs.
const INLINE_RE = /(\*\*[^*]+\*\*|<ins>[\s\S]*?<\/ins>|<del>[\s\S]*?<\/del>)/g
const REDLINE_INSERT = '1A7F37'
const REDLINE_DELETE = 'B91C1C'

function parseInlineRuns(text: string): TextRun[] {
  return text
    .split(INLINE_RE)
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith('**') && p.endsWith('**')) return new TextRun({ text: p.slice(2, -2), bold: true })
      if (p.startsWith('<ins>')) return new TextRun({ text: p.slice(5, -6), underline: {}, color: REDLINE_INSERT })
      if (p.startsWith('<del>')) return new TextRun({ text: p.slice(5, -6), strike: true, color: REDLINE_DELETE })
      return new TextRun(p)
    })
}

const REDLINE_AUTHOR = 'DeepSolve AI'
let revisionId = 1

/** Like parseInlineRuns, but emit <ins>/<del> as NATIVE Word tracked changes (w:ins/w:del). */
function parseTrackedRuns(text: string): ParagraphChild[] {
  const date = new Date().toISOString()
  return text
    .split(INLINE_RE)
    .filter(Boolean)
    .map((p): ParagraphChild => {
      if (p.startsWith('**') && p.endsWith('**')) return new TextRun({ text: p.slice(2, -2), bold: true })
      if (p.startsWith('<ins>'))
        return new InsertedTextRun({ text: p.slice(5, -6), id: revisionId++, author: REDLINE_AUTHOR, date })
      if (p.startsWith('<del>'))
        return new DeletedTextRun({ text: p.slice(5, -6), id: revisionId++, author: REDLINE_AUTHOR, date })
      return new TextRun(p)
    })
}

/**
 * Render Markdown (with <ins>/<del> redlines) to a .docx whose changes are real
 * Word tracked changes — so SuperDoc and Word show them as accept/reject
 * suggestions attributed to the AI. Used to feed the embedded editor.
 */
export async function markdownToTrackedDocx(markdown: string, title?: string): Promise<Buffer> {
  const children: Paragraph[] = []
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }))
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) {
      children.push(new Paragraph(''))
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: stripMd(line), heading: HeadingLevel.HEADING_3 }))
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: stripMd(line), heading: HeadingLevel.HEADING_2 }))
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: stripMd(line), heading: HeadingLevel.HEADING_1 }))
    } else if (/^[-*]\s+/.test(line)) {
      children.push(new Paragraph({ children: parseTrackedRuns(line.replace(/^[-*]\s+/, '')), bullet: { level: 0 } }))
    } else {
      children.push(new Paragraph({ children: parseTrackedRuns(line) }))
    }
  }
  const doc = new Document({ features: { trackRevisions: true }, sections: [{ children }] })
  return Buffer.from(await Packer.toBuffer(doc))
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
}

/** Extract the first Markdown table found. */
export function firstMarkdownTable(markdown: string): MdTable | null {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes('|') && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(lines[i])
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].includes('|') && !isTableDivider(lines[j])) {
        if (lines[j].trim()) rows.push(splitTableRow(lines[j]))
        j++
      }
      return { header, rows }
    }
  }
  return null
}

function stripMd(text: string): string {
  return text
    .replace(/<\/?(?:ins|del)>/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*]\s+/, '• ')
}

// ── DOCX ──

export async function markdownToDocx(markdown: string, title?: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }))
  }

  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Table block
    if (trimmed.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].includes('|') && !isTableDivider(lines[j])) {
        if (lines[j].trim()) rows.push(splitTableRow(lines[j]))
        j++
      }
      const tableRows = [header, ...rows].map(
        (cells, idx) =>
          new TableRow({
            children: cells.map(
              (c) =>
                new TableCell({
                  width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [new TextRun({ text: stripMd(c), bold: idx === 0 })] })]
                })
            )
          })
      )
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }))
      i = j - 1
      continue
    }

    if (!trimmed) {
      children.push(new Paragraph(''))
    } else if (trimmed.startsWith('### ')) {
      children.push(new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_3 }))
    } else if (trimmed.startsWith('## ')) {
      children.push(new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_2 }))
    } else if (trimmed.startsWith('# ')) {
      children.push(new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.HEADING_1 }))
    } else if (trimmed.startsWith('> ')) {
      children.push(
        new Paragraph({ children: parseInlineRuns(trimmed.slice(2)), indent: { left: 480 }, spacing: { before: 60 } })
      )
    } else if (/^[-*]\s+/.test(trimmed)) {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed.replace(/^[-*]\s+/, '')), bullet: { level: 0 } }))
    } else if (/^\d+\.\s+/.test(trimmed)) {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed.replace(/^\d+\.\s+/, '')), numbering: undefined, bullet: { level: 0 } }))
    } else {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed) }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Buffer.from(await Packer.toBuffer(doc))
}

// ── PDF ──

export async function markdownToPdf(markdown: string, title?: string): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const margin = 56
  const pageWidth = 612
  const pageHeight = 792
  const maxWidth = pageWidth - margin * 2

  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  function newPageIfNeeded(lineHeight: number): void {
    if (y - lineHeight < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  function drawWrapped(text: string, size: number, useBold: boolean): void {
    const f = useBold ? bold : font
    const words = text.split(/\s+/)
    let line = ''
    const lineHeight = size * 1.4
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
        newPageIfNeeded(lineHeight)
        page.drawText(line, { x: margin, y: y - size, size, font: f, color: rgb(0.1, 0.12, 0.18) })
        y -= lineHeight
        line = word
      } else {
        line = test
      }
    }
    if (line) {
      newPageIfNeeded(lineHeight)
      page.drawText(line, { x: margin, y: y - size, size, font: f, color: rgb(0.1, 0.12, 0.18) })
      y -= lineHeight
    }
  }

  if (title) {
    drawWrapped(title, 20, true)
    y -= 8
  }

  for (const raw of markdown.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) {
      y -= 8
      continue
    }
    if (trimmed.startsWith('# ')) drawWrapped(stripMd(trimmed), 17, true)
    else if (trimmed.startsWith('## ')) drawWrapped(stripMd(trimmed), 15, true)
    else if (trimmed.startsWith('### ')) drawWrapped(stripMd(trimmed), 13, true)
    else drawWrapped(stripMd(trimmed), 11, false)
  }

  return Buffer.from(await pdf.save())
}

// ── XLSX ──

export async function markdownToXlsx(markdown: string, sheetName = 'Sheet1'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31))
  const table = firstMarkdownTable(markdown)
  if (table) {
    ws.addRow(table.header.map(stripMd))
    ws.getRow(1).font = { bold: true }
    for (const row of table.rows) ws.addRow(row.map(stripMd))
    ws.columns.forEach((col) => {
      let max = 10
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        max = Math.max(max, String(cell.value ?? '').length + 2)
      })
      col.width = Math.min(max, 60)
    })
  } else {
    // No table — dump the text line by line.
    for (const line of markdown.split('\n')) ws.addRow([stripMd(line)])
    ws.getColumn(1).width = 100
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

export async function rowsToXlsx(rows: string[][], sheetName = 'Sheet1'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31))
  rows.forEach((r) => ws.addRow(r))
  if (rows.length) ws.getRow(1).font = { bold: true }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
