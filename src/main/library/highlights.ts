import { promises as fs } from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

// Extract text a reviewer marked with Word's highlighter pen. A docx is a zip;
// the body lives in word/document.xml. The highlighter emits <w:highlight w:val="..."/>
// inside a run's <w:rPr>; some reviewers instead use character shading
// (<w:shd w:fill="..."/>). We pull both, merging consecutive same-colour runs
// into one passage and keeping the surrounding paragraph as locating context.

export interface HighlightPassage {
  /** The highlighted text. */
  text: string
  /** Word highlight colour name (e.g. "yellow") or a "#RRGGBB" shading fill. */
  color: string
  /** The full paragraph the highlight sits in — helps locate the clause. */
  context: string
}

type XmlNode = {
  nodeName: string
  childNodes?: { length: number; item(i: number): XmlNode | null }
  getAttribute?(name: string): string | null
  getElementsByTagName?(name: string): { length: number; item(i: number): XmlNode | null }
  textContent?: string | null
}

function children(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = []
  const list = node.childNodes
  if (!list) return out
  for (let i = 0; i < list.length; i++) {
    const c = list.item(i)
    if (c) out.push(c)
  }
  return out
}

function tagged(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = []
  const list = node.getElementsByTagName?.(tag)
  if (!list) return out
  for (let i = 0; i < list.length; i++) {
    const c = list.item(i)
    if (c) out.push(c)
  }
  return out
}

/** First direct child element with the given (prefixed) tag name. */
function firstChild(node: XmlNode, tag: string): XmlNode | undefined {
  return children(node).find((c) => c.nodeName === tag)
}

/** Concatenated text of all <w:t> runs-of-text under a node. */
function textOf(node: XmlNode): string {
  return tagged(node, 'w:t')
    .map((t) => t.textContent ?? '')
    .join('')
}

/** The highlight colour applied to a run, or '' if the run isn't highlighted. */
function runHighlight(run: XmlNode): string {
  const rPr = firstChild(run, 'w:rPr')
  if (!rPr) return ''
  const hl = firstChild(rPr, 'w:highlight')
  const val = hl?.getAttribute?.('w:val')
  if (val && val !== 'none') return val
  // Fall back to character shading used as a manual highlight.
  const shd = firstChild(rPr, 'w:shd')
  const fill = shd?.getAttribute?.('w:fill')
  if (fill && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'ffffff') return '#' + fill
  return ''
}

export async function extractDocxHighlights(filePath: string): Promise<HighlightPassage[]> {
  const buf = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buf)
  const entry = zip.file('word/document.xml')
  if (!entry) return []
  const xml = await entry.async('text')
  const dom = new DOMParser().parseFromString(xml, 'text/xml') as unknown as XmlNode

  const passages: HighlightPassage[] = []

  // getElementsByTagName returns document order, including paragraphs in tables.
  for (const para of tagged(dom, 'w:p')) {
    const context = textOf(para).replace(/\s+/g, ' ').trim()
    let buffer = ''
    let color = ''
    const flush = (): void => {
      const text = buffer.replace(/\s+/g, ' ').trim()
      if (text) passages.push({ text, color, context })
      buffer = ''
      color = ''
    }
    for (const run of tagged(para, 'w:r')) {
      const hl = runHighlight(run)
      if (hl) {
        if (color && hl !== color) flush() // colour changed → new passage
        color = hl
        buffer += textOf(run)
      } else if (buffer) {
        flush() // highlight ended
      }
    }
    flush() // end of paragraph
  }

  return passages
}

// ───────────────────────── PDF ─────────────────────────

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

// Word-highlighter palette → name, matched by nearest RGB within a threshold.
const PDF_COLORS: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: 'yellow', rgb: [255, 255, 0] },
  { name: 'green', rgb: [0, 255, 0] },
  { name: 'cyan', rgb: [0, 255, 255] },
  { name: 'magenta', rgb: [255, 0, 255] },
  { name: 'blue', rgb: [0, 0, 255] },
  { name: 'red', rgb: [255, 0, 0] },
  { name: 'darkGreen', rgb: [0, 128, 0] },
  { name: 'orange', rgb: [255, 165, 0] },
  { name: 'gray', rgb: [128, 128, 128] }
]

function colorName(color: ArrayLike<number> | null | undefined): string {
  if (!color || color.length < 3) return 'highlight'
  const [r, g, b] = [color[0], color[1], color[2]]
  let best = ''
  let bestDist = Infinity
  for (const c of PDF_COLORS) {
    const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2
    if (d < bestDist) {
      bestDist = d
      best = c.name
    }
  }
  if (bestDist <= 60 * 60) return best
  const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return '#' + hex(r) + hex(g) + hex(b)
}

/** The highlight's rectangles, from flat QuadPoints (8/quad) or the bounding Rect. */
function quadsOf(annot: { quadPoints?: ArrayLike<number> | null; rect?: number[] }): Box[] {
  const qp = annot.quadPoints
  const boxes: Box[] = []
  if (qp && qp.length >= 8) {
    for (let i = 0; i + 8 <= qp.length; i += 8) {
      const xs = [qp[i], qp[i + 2], qp[i + 4], qp[i + 6]]
      const ys = [qp[i + 1], qp[i + 3], qp[i + 5], qp[i + 7]]
      boxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) })
    }
  } else if (annot.rect && annot.rect.length === 4) {
    const [a, b, c, d] = annot.rect
    boxes.push({ x0: Math.min(a, c), x1: Math.max(a, c), y0: Math.min(b, d), y1: Math.max(b, d) })
  }
  return boxes
}

// A text item is "under" a quad if its horizontal centre sits within the quad
// (tolerant) and their vertical spans overlap.
function inside(it: Box, q: Box): boolean {
  const cx = (it.x0 + it.x1) / 2
  return cx >= q.x0 - 1 && cx <= q.x1 + 1 && it.y1 > q.y0 && it.y0 < q.y1
}

function orderText(items: Array<Box & { str: string }>): string {
  return items
    .slice()
    .sort((a, b) => (Math.abs(a.y0 - b.y0) > 4 ? b.y0 - a.y0 : a.x0 - b.x0)) // top line first, then L→R
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function extractPdfHighlights(filePath: string): Promise<HighlightPassage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise
  const out: HighlightPassage[] = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    let annots: Array<{ subtype?: string; quadPoints?: ArrayLike<number> | null; rect?: number[]; color?: ArrayLike<number> | null }>
    try {
      annots = (await page.getAnnotations()) as typeof annots
    } catch {
      continue
    }
    const highlights = annots.filter((a) => a.subtype === 'Highlight')
    if (!highlights.length) continue

    const tc = await page.getTextContent()
    const items: Array<Box & { str: string }> = []
    for (const raw of tc.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number }
      if (!it.str || !it.transform || !it.str.trim()) continue
      const x0 = it.transform[4]
      const y0 = it.transform[5]
      items.push({ str: it.str, x0, x1: x0 + (it.width || 0), y0, y1: y0 + (it.height || 0) })
    }

    for (const a of highlights) {
      const quads = quadsOf(a)
      if (!quads.length) continue
      const text = orderText(items.filter((it) => quads.some((q) => inside(it, q))))
      if (!text) continue
      const bandY0 = Math.min(...quads.map((q) => q.y0))
      const bandY1 = Math.max(...quads.map((q) => q.y1))
      const context = orderText(items.filter((it) => it.y1 > bandY0 - 2 && it.y0 < bandY1 + 2))
      out.push({ text, color: colorName(a.color), context })
    }
  }

  return out
}

/** Extract highlighted passages from a .docx or .pdf; [] for other types. */
export async function extractHighlights(filePath: string): Promise<HighlightPassage[]> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx') return extractDocxHighlights(filePath)
  if (ext === '.pdf') return extractPdfHighlights(filePath)
  return []
}
