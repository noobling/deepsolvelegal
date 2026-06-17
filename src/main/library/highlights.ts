import { promises as fs } from 'fs'
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
