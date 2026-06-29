/**
 * Convert our document Markdown (with <ins>/<del> redlines) into Syncfusion's
 * SFDT JSON — rendered fully client-side by the Document Editor, no docx→SFDT
 * server. Insertions/deletions become native SFDT tracked-change revisions so
 * they show as accept/reject suggestions.
 */

interface Inline {
  text: string
  characterFormat?: Record<string, unknown>
  revisionIds?: string[]
}
interface Block {
  inlines: Inline[]
  paragraphFormat?: Record<string, unknown>
}
interface Revision {
  author: string
  date: string
  revisionType: 'Insertion' | 'Deletion'
  revisionId: string
}

const AUTHOR = 'Quantum Law Group AI'
const INLINE_RE = /(\*\*[^*]+\*\*|<ins>[\s\S]*?<\/ins>|<del>[\s\S]*?<\/del>)/g

// Deterministic ids (no Math.random — keeps output stable for the same input).
let revCounter = 0
function nextRevId(): string {
  revCounter += 1
  return `rev-${revCounter}`
}

function inlinesFor(text: string, revisions: Revision[], date: string): Inline[] {
  return text
    .split(INLINE_RE)
    .filter(Boolean)
    .map((part): Inline => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return { text: part.slice(2, -2), characterFormat: { bold: true } }
      }
      if (part.startsWith('<ins>') || part.startsWith('<del>')) {
        const isIns = part.startsWith('<ins>')
        const inner = part.slice(5, -6)
        const id = nextRevId()
        revisions.push({ author: AUTHOR, date, revisionType: isIns ? 'Insertion' : 'Deletion', revisionId: id })
        return { text: inner, revisionIds: [id], characterFormat: {} }
      }
      return { text: part, characterFormat: {} }
    })
}

export function markdownToSfdt(markdown: string): string {
  revCounter = 0
  const date = '2026-06-16T00:00:00Z'
  const revisions: Revision[] = []
  const blocks: Block[] = []

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      blocks.push({ inlines: [] })
    } else if (line.startsWith('### ')) {
      blocks.push({ inlines: inlinesFor(line.slice(4), revisions, date), paragraphFormat: { styleName: 'Heading 3' } })
    } else if (line.startsWith('## ')) {
      blocks.push({ inlines: inlinesFor(line.slice(3), revisions, date), paragraphFormat: { styleName: 'Heading 2' } })
    } else if (line.startsWith('# ')) {
      blocks.push({ inlines: inlinesFor(line.slice(2), revisions, date), paragraphFormat: { styleName: 'Heading 1' } })
    } else if (/^\s*[-*]\s+/.test(line)) {
      blocks.push({
        inlines: inlinesFor(line.replace(/^\s*[-*]\s+/, ''), revisions, date),
        paragraphFormat: { listFormat: { listId: 0 } }
      })
    } else {
      blocks.push({ inlines: inlinesFor(line.trim(), revisions, date) })
    }
  }

  return JSON.stringify({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
        blocks,
        headersFooters: {}
      }
    ],
    characterFormat: { fontSize: 11, fontFamily: 'Calibri' },
    paragraphFormat: {},
    defaultTabWidth: 36,
    revisions,
    styles: []
  })
}
