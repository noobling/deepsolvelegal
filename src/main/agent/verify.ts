/**
 * Deterministic citation verification for review-style deliverables.
 *
 * Small local models sometimes cite section numbers that do not exist in the
 * source (e.g. an invented "§12 Termination"). "Does §N exist in the document"
 * is a purely mechanical check, so we run it after the model finishes and flag
 * any reference we cannot find — turning a silent hallucination into a visible,
 * verifiable note.
 *
 * The check is deliberately conservative so it is safe for strong cloud models
 * too: it only references it can confidently disprove, and bails out entirely
 * when the source's numbering can't be parsed reliably (see `parseReliable`).
 */

const HEADING_RE = /^\s*(?:section\s+|§\s*|clause\s+|article\s+)?(\d{1,3})(?:\.\d+)*[.):]?\s+\S/i
const INLINE_RE = /(?:§\s*|\bsection\s+|\bclause\s+|\barticle\s+)(\d{1,3})(?:\.\d+)*/gi
const CITE_RE = /(?:§\s*|\bsections?\s+|\bsec\.?\s+|\bclauses?\s+|\barticle\s+)(\d{1,3})((?:\.\d+)*)/gi

// A citation immediately followed by one of these denotes an external statute
// (e.g. "Article 33(1) GDPR", "Section 5 of the Companies Act"), not a clause of
// the contract under review — so it must not be flagged as a missing section.
const EXTERNAL_REG =
  /^\s*(?:\(\d+\)\s*)?(?:of\s+the\s+|,?\s*)?(?:GDPR|CCPA|CPRA|UCC|DMCA|HIPAA|FCRA|COPPA|GLBA|TCPA|[A-Z][A-Za-z]+\s+(?:Act|Regulation|Directive|Code))/

/** Section numbers that appear as headings (the document's actual structure). */
function headingSections(source: string): Set<number> {
  const nums = new Set<number>()
  for (const line of source.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line)
    if (m) nums.add(parseInt(m[1], 10))
  }
  return nums
}

/** Section numbers mentioned inline (e.g. "under Section 7.2") — supplements the valid set. */
function inlineSections(source: string): Set<number> {
  const nums = new Set<number>()
  for (const m of source.matchAll(INLINE_RE)) nums.add(parseInt(m[1], 10))
  return nums
}

/** All top-level section numbers we consider present in the source. */
export function sourceSectionNumbers(source: string): Set<number> {
  return new Set<number>([...headingSections(source), ...inlineSections(source)])
}

/** Distinct contract section references cited in the deliverable (external statutes excluded). */
function citedSections(deliverable: string): Map<string, number> {
  const cited = new Map<string, number>()
  for (const m of deliverable.matchAll(CITE_RE)) {
    const tail = deliverable.slice(m.index + m[0].length)
    if (EXTERNAL_REG.test(tail)) continue // e.g. "Article 33 GDPR" — not a clause of this contract
    const display = `§${m[1]}${m[2] ?? ''}`
    if (!cited.has(display)) cited.set(display, parseInt(m[1], 10))
  }
  return cited
}

/**
 * Only trust the parse when the detected sections form a contiguous run 1..N.
 * A gap usually means extraction missed a heading, so flagging would risk false
 * positives on a correct citation — in that case we report but don't flag.
 */
function parseReliable(nums: Set<number>): boolean {
  if (nums.size < 2) return false
  const max = Math.max(...nums)
  for (let i = 1; i <= max; i++) if (!nums.has(i)) return false
  return true
}

export interface CitationCheck {
  /** Distinct section references cited in the deliverable. */
  cited: string[]
  /** References whose top-level number is absent from a reliably-parsed source. */
  unverified: string[]
}

export function verifyCitations(deliverable: string, source: string): CitationCheck {
  const cited = citedSections(deliverable)
  const headings = headingSections(source)
  const valid = new Set<number>([...headings, ...inlineSections(source)])
  // Judge reliability from headings only, so inline references to external
  // regs (e.g. "Article 33 GDPR") can't break the contiguity check.
  const unverified = parseReliable(headings)
    ? [...cited].filter(([, top]) => !valid.has(top)).map(([d]) => d)
    : []
  return { cited: [...cited.keys()], unverified }
}

/**
 * Section references inside a single document that don't resolve to one of its
 * own headings — i.e. broken internal cross-references. Unlike verifyCitations,
 * the valid set is headings ONLY: an inline "see Section 12" must not validate
 * itself. Returns [] when the heading numbering can't be parsed reliably.
 */
export function unresolvedSectionRefs(text: string): string[] {
  const headings = headingSections(text)
  if (!parseReliable(headings)) return []
  return [...citedSections(text)].filter(([, top]) => !headings.has(top)).map(([d]) => d)
}

/** A short Markdown footer reporting the citation-check result, or '' if there is nothing to say. */
export function citationFooter(check: CitationCheck): string {
  if (check.cited.length === 0) return ''
  if (check.unverified.length > 0) {
    const them = check.unverified.length > 1 ? 'them' : 'it'
    const others = check.cited.length - check.unverified.length
    return (
      `\n\n---\n> ⚠️ **Automated citation check:** ${check.unverified.join(', ')} ` +
      `could not be found in the source document and may be inaccurate — verify before relying on ${them}.` +
      (others > 0 ? ` The other ${others} cited reference(s) matched the source.` : '')
    )
  }
  return `\n\n---\n> ✓ **Automated citation check:** all ${check.cited.length} cited section references were found in the source document.`
}
