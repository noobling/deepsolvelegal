import path from 'path'
import type { ToolDef } from './types'
import { resolvePath, str } from './types'
import { extractText } from '../library/extract'

/**
 * Deterministic version comparison between two document drafts. Produces a
 * redline in the same <ins>/<del> markup the deliverable pane renders, so a
 * returned counterparty draft can be diffed against our last version and the
 * model can then explain what changed — judgement on top of an exact diff.
 */

interface Op<T> {
  type: 'eq' | 'del' | 'ins'
  val: T
}

/** Longest-common-subsequence diff of two sequences. */
function diffSeq<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op<T>[] {
  const n = a.length
  const m = b.length
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Op<T>[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) out.push({ type: 'eq', val: a[i++] }), j++
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', val: a[i++] })
    else out.push({ type: 'ins', val: b[j++] })
  }
  while (i < n) out.push({ type: 'del', val: a[i++] })
  while (j < m) out.push({ type: 'ins', val: b[j++] })
  return out
}

/** Inline word-level redline between two short strings (used inside a changed block). */
function wordRedline(oldText: string, newText: string): string {
  const ops = diffSeq(
    oldText.split(/(\s+)/).filter(Boolean),
    newText.split(/(\s+)/).filter(Boolean),
    (x, y) => x === y
  )
  let out = ''
  let del = ''
  let ins = ''
  const flush = (): void => {
    if (del.trim()) out += `<del>${del}</del>`
    if (ins.trim()) out += `<ins>${ins}</ins>`
    del = ''
    ins = ''
  }
  for (const op of ops) {
    if (op.type === 'eq') {
      flush()
      out += op.val
    } else if (op.type === 'del') del += op.val
    else ins += op.val
  }
  flush()
  return out
}

export interface DiffResult {
  markup: string
  added: number
  removed: number
}

/** Compare two documents line-by-line and render a redline; refine changed blocks at word level. */
export function redlineDiff(oldText: string, newText: string): DiffResult {
  const ops = diffSeq(oldText.split('\n'), newText.split('\n'), (x, y) => x === y)
  const lines: string[] = []
  let added = 0
  let removed = 0
  let dels: string[] = []
  let inss: string[] = []

  const flush = (): void => {
    if (dels.length && inss.length) {
      lines.push(wordRedline(dels.join('\n'), inss.join('\n')))
    } else if (dels.length) {
      for (const d of dels) lines.push(d.trim() ? `<del>${d}</del>` : d)
    } else if (inss.length) {
      for (const s of inss) lines.push(s.trim() ? `<ins>${s}</ins>` : s)
    }
    removed += dels.length
    added += inss.length
    dels = []
    inss = []
  }

  for (const op of ops) {
    if (op.type === 'eq') {
      flush()
      lines.push(op.val)
    } else if (op.type === 'del') dels.push(op.val)
    else inss.push(op.val)
  }
  flush()
  return { markup: lines.join('\n'), added, removed }
}

export const diffDocumentsTool: ToolDef = {
  name: 'diff_documents',
  description:
    'Deterministically compare two versions of a document (e.g. our last draft vs a counterparty redline) and ' +
    'return a line/word-level redline using <ins>/<del> markup. Use this before summarizing what changed.',
  needsPermission: false,
  inputSchema: {
    type: 'object',
    properties: {
      original: { type: 'string', description: 'Path to the earlier/our version (relative to the matter workspace).' },
      revised: { type: 'string', description: 'Path to the later/their version (relative to the matter workspace).' }
    },
    required: ['original', 'revised']
  },
  async run(args, ctx) {
    const a = resolvePath(ctx, str(args, 'original'))
    const b = resolvePath(ctx, str(args, 'revised'))
    let oldText: string
    let newText: string
    try {
      oldText = (await extractText(a)).text
      newText = (await extractText(b)).text
    } catch {
      return { summary: 'Could not read both documents', content: 'One or both files could not be read.', isError: true }
    }
    const { markup, added, removed } = redlineDiff(oldText, newText)
    const header = `Redline of ${path.basename(a)} → ${path.basename(b)} (${added} line(s) added, ${removed} removed):\n\n`
    return { summary: `Diff: +${added} / -${removed}`, content: header + markup }
  }
}
