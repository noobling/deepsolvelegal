import path from 'path'
import type { ToolDef } from './types'
import { resolvePath, str } from './types'
import { extractText } from '../library/extract'
import { unresolvedSectionRefs } from '../agent/verify'

/**
 * Deterministic contract "linting" — the checks a careful associate runs by hand:
 * defined-term hygiene, internal cross-reference integrity, and execution
 * readiness. No model involved, so the findings are reliable and groundable.
 */

export interface LintFinding {
  category: 'Defined terms' | 'Cross-references' | 'Execution readiness'
  severity: 'high' | 'medium' | 'low'
  detail: string
}

const DEF_MEANS_RE = /["“]([A-Z][\w '’\-]{1,60}?)["”]\s+(?:means\b|shall mean\b|refers to\b|has the meaning)/g
const DEF_PAREN_RE = /\((?:the\s+|each\s+(?:an?\s+)?|collectively,?\s+|an?\s+)?["“]([A-Z][\w '’\-]{1,60}?)["”]\)/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Map of defined term → how many times it is *defined*. */
function definitions(text: string): Map<string, number> {
  const defs = new Map<string, number>()
  for (const re of [DEF_MEANS_RE, DEF_PAREN_RE]) {
    for (const m of text.matchAll(re)) {
      const term = m[1].trim()
      defs.set(term, (defs.get(term) ?? 0) + 1)
    }
  }
  return defs
}

/** Total occurrences of a term string in the text (definition uses included). */
function occurrences(text: string, term: string): number {
  return (text.match(new RegExp(escapeRe(term), 'g')) ?? []).length
}

export function checkDefinedTerms(text: string): LintFinding[] {
  const out: LintFinding[] = []
  for (const [term, defCount] of definitions(text)) {
    if (defCount > 1) {
      out.push({
        category: 'Defined terms',
        severity: 'high',
        detail: `"${term}" is defined ${defCount} times — consolidate to one definition to avoid conflicts.`
      })
    }
    // "Used" beyond its definition(s): an occurrence count at or below the number
    // of definitions means the term is never actually referenced.
    if (occurrences(text, term) <= defCount) {
      out.push({
        category: 'Defined terms',
        severity: 'low',
        detail: `"${term}" is defined but never used — consider removing the definition.`
      })
    }
  }
  return out
}

const EXHIBIT_REF_RE = /\b(Exhibit|Schedule|Appendix|Annex)\s+([A-Z]|\d{1,2})\b/g
const EXHIBIT_HEAD_RE = /^\s*(?:Exhibit|Schedule|Appendix|Annex)\s+([A-Z]|\d{1,2})\b/gim

export function checkCrossReferences(text: string): LintFinding[] {
  const out: LintFinding[] = []
  // Section references that point to a section number not present in the document.
  for (const ref of unresolvedSectionRefs(text)) {
    out.push({
      category: 'Cross-references',
      severity: 'high',
      detail: `Reference to ${ref} does not resolve to any section in this document.`
    })
  }
  // Exhibit/Schedule references — only checked when the document attaches at least
  // one such heading (otherwise exhibits are likely attached separately).
  const headings = new Set([...text.matchAll(EXHIBIT_HEAD_RE)].map((m) => m[1].toUpperCase()))
  if (headings.size > 0) {
    const seen = new Set<string>()
    for (const m of text.matchAll(EXHIBIT_REF_RE)) {
      const key = `${m[1]} ${m[2]}`.toUpperCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!headings.has(m[2].toUpperCase())) {
        out.push({
          category: 'Cross-references',
          severity: 'medium',
          detail: `${m[1]} ${m[2]} is referenced but no matching ${m[1]} heading was found.`
        })
      }
    }
  }
  return out
}

const BLANK_RES: RegExp[] = [
  /\[\s*_{2,}\s*\]/g,
  /_{4,}/g,
  /\[(?:DATE|NAME|ADDRESS|AMOUNT|TBD|INSERT[^\]]*|[•·]|\s*)\]/gi,
  /\bTBD\b/g,
  /\bTO BE (?:DETERMINED|COMPLETED|CONFIRMED)\b/gi
]
// Markers of an actual signature block. Deliberately excludes the bare word
// "signature", which appears in ordinary prose (e.g. "date of the last signature").
const SIGNATURE_MARKERS = /\b(IN WITNESS WHEREOF|By:\s|Name:\s|Title:\s|Authorized Signator|_{6,}\s*\n\s*(?:Name|Signature))/i

export function checkExecutionReadiness(text: string): LintFinding[] {
  const out: LintFinding[] = []
  const blanks = new Set<string>()
  for (const re of BLANK_RES) for (const m of text.matchAll(re)) blanks.add(m[0].trim())
  if (blanks.size > 0) {
    out.push({
      category: 'Execution readiness',
      severity: 'high',
      detail: `Unfilled placeholder(s) found: ${[...blanks].slice(0, 8).join(', ')}${blanks.size > 8 ? ' …' : ''}.`
    })
  }
  if (!SIGNATURE_MARKERS.test(text)) {
    out.push({
      category: 'Execution readiness',
      severity: 'medium',
      detail: 'No signature block detected (no "By:/Name:/Title:" or "IN WITNESS WHEREOF").'
    })
  }
  return out
}

export function lintDocument(text: string): LintFinding[] {
  return [...checkDefinedTerms(text), ...checkCrossReferences(text), ...checkExecutionReadiness(text)]
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

function sortedFindings(findings: LintFinding[]): LintFinding[] {
  return findings.slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Render findings as a compact Markdown report for the model / activity log. */
export function lintReport(findings: LintFinding[]): string {
  if (findings.length === 0) return 'No defined-term, cross-reference, or execution-readiness issues found.'
  const lines = sortedFindings(findings).map((f) => `- [${f.severity.toUpperCase()}] ${f.category}: ${f.detail}`)
  return `${findings.length} issue(s) found:\n${lines.join('\n')}`
}

/**
 * A Markdown section appended to a review deliverable, reporting the deterministic
 * lint findings. Returns '' when there is nothing to report.
 */
export function lintFooter(findings: LintFinding[]): string {
  if (findings.length === 0) return ''
  const lines = sortedFindings(findings).map((f) => `- **${f.severity.toUpperCase()}** · ${f.category}: ${f.detail}`)
  return `\n\n---\n### Automated document checks\n_Deterministic checks (not AI) — defined terms, internal cross-references, and execution readiness:_\n${lines.join('\n')}`
}

export const lintDocumentTool: ToolDef = {
  name: 'lint_document',
  description:
    'Deterministically lint a contract for defined-term consistency (duplicate/unused definitions), ' +
    'internal cross-reference integrity (Section/Exhibit references that do not resolve), and execution ' +
    'readiness (unfilled blanks, missing signature block). Returns reliable, non-AI findings to fold into a review.',
  needsPermission: false,
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Document to lint (relative to the matter workspace).' } },
    required: ['path']
  },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, 'path'))
    let text: string
    try {
      text = (await extractText(file)).text
    } catch {
      return { summary: `Could not read ${path.basename(file)}`, content: 'File could not be read.', isError: true }
    }
    const findings = lintDocument(text)
    return { summary: `Lint: ${findings.length} issue(s) in ${path.basename(file)}`, content: lintReport(findings) }
  }
}
