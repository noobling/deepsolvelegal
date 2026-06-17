import type { PracticeAreaMeta, Workflow } from './types'

export const PRACTICE_AREAS: PracticeAreaMeta[] = [
  {
    id: 'commercial',
    label: 'Commercial & Contracts',
    blurb: 'Review agreements, track renewals, flag what needs escalation.',
    icon: 'FileSignature',
    accent: '#c9a24b'
  },
  {
    id: 'litigation',
    label: 'Litigation',
    blurb: 'Draft demands, build chronologies, prep depositions.',
    icon: 'Scale',
    accent: '#7c9cbf'
  },
  {
    id: 'privacy',
    label: 'Privacy & Data',
    blurb: 'Respond to DSARs, review DPAs, triage new use cases.',
    icon: 'ShieldCheck',
    accent: '#8fbf9c'
  },
  {
    id: 'corporate',
    label: 'Corporate & M&A',
    blurb: 'Run cited diligence, build closing checklists, track entities.',
    icon: 'Building2',
    accent: '#c08fb4'
  }
]

const SUPPORTED_DOCS = '.pdf, .docx, .txt, or .xlsx'

export const WORKFLOWS: Workflow[] = [
  // ───────────────────────── Commercial ─────────────────────────
  {
    id: 'contract-review',
    area: 'commercial',
    title: 'Contract / NDA Review',
    cta: 'Review a contract',
    description: 'Issue-spot an agreement against your playbook and produce a redline-ready summary.',
    icon: 'FileSearch',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx', 'lint_document', 'apply_redline'],
    intakeFields: [
      {
        key: 'files',
        label: 'Agreement to review',
        type: 'files',
        required: true,
        help: `Attach the contract (${SUPPORTED_DOCS}).`
      },
      { key: 'counterparty', label: 'Counterparty', type: 'text', placeholder: 'Acme Corp.' },
      { key: 'our_role', label: 'We are the…', type: 'select', options: ['Customer', 'Vendor', 'Either / mutual'] },
      {
        key: 'concerns',
        label: 'Specific concerns (optional)',
        type: 'textarea',
        placeholder: 'e.g. liability cap, data security, auto-renewal'
      }
    ],
    runningLabel: 'Reading the agreement and spotting issues…',
    systemPrompt: `You are reviewing a commercial agreement on behalf of the user's organization.

First, read every attached document fully using the file tools. Then produce a structured review with these sections, formatted in Markdown:

## Snapshot
A 3–4 sentence plain-English summary: what this agreement is, the parties, term, and overall risk posture (Low / Medium / High) with one sentence of justification.

## Key Terms
A compact table of: Term length, Renewal mechanics, Payment terms, Liability cap, Indemnities, Termination rights, Governing law. Cite the clause/section number for each.

## Issues & Redlines
A numbered list, ordered by severity. For each issue give: **the clause**, **why it's a problem** for the user's side, and a **suggested redline** (proposed replacement language in a > blockquote). Tie each to the user's stated role and concerns.

## Recommended Position
Two or three bullets on what to push on vs. what to concede.

Run lint_document on the agreement and fold any defined-term, cross-reference, or execution-readiness issues it returns into your Issues list (these are deterministic, so trust them).

Be specific and cite section numbers. Cite only sections that actually appear in the document — never invent a clause, section number, or quotation. If an important protection is missing (e.g. no limitation of liability), call that out explicitly as an issue. When you have produced the review, offer to export it to Word.`,
    localGuidance: `COVERAGE CHECKLIST — work through every item against the document before writing the Issues section. For each, use search_files / the read tools to locate the governing clause, then record a finding (a flagged issue, "acceptable as drafted", or "NOT PRESENT"). Do not skip an item because it looks fine — say so explicitly.
1. Limitation of liability — the cap amount, and whether it is mutual or one-sided (does a carve-out leave our side uncapped?).
2. Indemnification — who indemnifies whom, and is our side's indemnity obligation uncapped or one-directional?
3. Termination — symmetry: can the counterparty terminate for convenience while we can only terminate for breach? Refunds on termination?
4. Auto-renewal & price escalation — the non-renewal notice window and any automatic fee increases.
5. Payment terms — net days, late interest/fees, and whether fees are non-refundable.
6. Data & IP — how our data may be used (especially any AI/ML training), data sharing, and IP ownership.
7. Assignment / change of control — can we assign in a merger or acquisition? Can the counterparty assign freely?
8. Unilateral amendment — can the counterparty change the terms without our consent (e.g. by posting an update)?
9. Governing law & venue — is it a foreign or otherwise inconvenient forum for our side?
10. MISSING protections — explicitly flag the ABSENCE of any standard protection you would expect: limitation of liability, data processing addendum (DPA), security commitments, SLA, warranty, or (for NDAs) carve-outs from the confidential-information definition.

If you cannot locate a clause for an item, write "not present" — never guess a citation.

SELF-AUDIT: After drafting the Issues list, re-read the checklist and the document once more. Add any material issue you missed (absent protections are easy to overlook) and remove any citation you cannot confirm. Only then produce the final review.`
  },
  {
    id: 'renewal-tracker',
    area: 'commercial',
    title: 'Renewal Tracker',
    cta: 'Track renewals & cancel-by dates',
    description: 'Extract renewal and cancel-by deadlines from a set of agreements into a tracker.',
    icon: 'CalendarClock',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'list_dir', 'write_xlsx'],
    intakeFields: [
      { key: 'files', label: 'Agreements', type: 'files', required: true, help: `Attach one or more contracts (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: 'Extracting renewal and cancel-by dates…',
    systemPrompt: `You are building a renewal register. Read each attached agreement and extract a row per contract with these columns: Counterparty, Agreement type, Effective date, Term, Auto-renews? (Y/N), Renewal term, Notice period, **Cancel-by date** (computed from the next renewal and notice period), Annual value (if stated). Output a Markdown table sorted by Cancel-by date (soonest first). Flag any contract whose cancel-by date is within 90 days with ⚠️. After the table, list any contracts where renewal terms were ambiguous and need human review. Offer to export the register to Excel.`
  },
  {
    id: 'escalation-flagger',
    area: 'commercial',
    title: 'Escalation Flagger',
    cta: 'Decide if this needs escalation',
    description: 'Triage an incoming request or clause against escalation rules and route it.',
    icon: 'Siren',
    outputType: 'memo',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights'],
    intakeFields: [
      { key: 'request', label: 'The request or clause', type: 'textarea', required: true, placeholder: 'Paste the ask, email, or clause here.' },
      { key: 'files', label: 'Related documents (optional)', type: 'files' }
    ],
    runningLabel: 'Triaging against escalation rules…',
    systemPrompt: `You are an in-house triage gate. Given the request and any documents, decide: **Handle now**, **Escalate**, or **Need more info**. Use the user's practice profile escalation rules if present. Output: a one-line decision, the reasoning (which rule or risk triggered it), who it should go to if escalated, and a draft 2-sentence message to that person. Be decisive.`
  },

  // ───────────────────────── Litigation ─────────────────────────
  {
    id: 'demand-draft',
    area: 'litigation',
    title: 'Demand Letter',
    cta: 'Draft a demand letter',
    description: 'Draft a persuasive, well-structured demand letter from the facts and legal basis.',
    icon: 'Mail',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'recipient', label: 'Recipient', type: 'text', required: true, placeholder: 'Name / company being demanded' },
      { key: 'client', label: 'Our client', type: 'text', placeholder: 'Who we represent' },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', placeholder: 'e.g. California' },
      { key: 'facts', label: 'Facts & legal basis', type: 'textarea', required: true, placeholder: 'What happened, what was breached, what we want.' },
      { key: 'files', label: 'Supporting documents (optional)', type: 'files' }
    ],
    runningLabel: 'Drafting the demand letter…',
    systemPrompt: `You are drafting a formal demand letter. Read any attached documents first. Produce a complete, send-ready letter in Markdown with: date line, recipient block, RE: line, an opening that identifies your client and purpose, a numbered factual background, the legal basis for the demand (cite the relevant doctrine/statute for the jurisdiction; verify with web search if helpful), a clear and specific demand with a deadline, a statement of consequences for non-compliance, and a professional closing. Keep the tone firm but professional. Do not fabricate citations — if you are unsure of a precise statute, describe the legal basis generally and flag it for attorney verification. Offer to export to Word.`
  },
  {
    id: 'chronology-builder',
    area: 'litigation',
    title: 'Chronology Builder',
    cta: 'Build a case chronology',
    description: 'Assemble a dated, sourced chronology of events from documents and notes.',
    icon: 'ListOrdered',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_xlsx'],
    intakeFields: [
      { key: 'files', label: 'Source documents', type: 'files', required: true, help: `Emails, contracts, notes (${SUPPORTED_DOCS}).` },
      { key: 'context', label: 'Matter context (optional)', type: 'textarea', placeholder: 'What is this dispute about?' }
    ],
    runningLabel: 'Extracting events into a chronology…',
    systemPrompt: `You are building a litigation chronology. Read every source document. Extract a row per discrete event with columns: Date, Event, Actor(s), **Source** (document name + page/section), Significance. Output a Markdown table sorted chronologically. Where a date is approximate or inferred, mark it (~). After the table, add a short "Gaps & ambiguities" list noting events with unclear dates or missing sources. Never assert a fact without a source. Offer to export to Excel.`
  },
  {
    id: 'deposition-prep',
    area: 'litigation',
    title: 'Deposition Prep',
    cta: 'Prep a deposition outline',
    description: 'Build a deposition outline with topic blocks, key exhibits, and questions.',
    icon: 'MessageSquareQuote',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_docx'],
    intakeFields: [
      { key: 'deponent', label: 'Deponent', type: 'text', required: true, placeholder: 'Who is being deposed + their role' },
      { key: 'theory', label: 'Case theory / goals', type: 'textarea', required: true, placeholder: 'What you need to establish or undermine.' },
      { key: 'files', label: 'Key documents (optional)', type: 'files' }
    ],
    runningLabel: 'Building the deposition outline…',
    systemPrompt: `You are preparing a deposition outline. Read attached documents. Produce an outline in Markdown organized into topic blocks. For each block: the objective, the foundational questions, the key questions (open then locking), and the exhibits to use (with where they came from). Integrate the case theory throughout — flag where an answer either way advances or threatens it. End with a list of admissions you are trying to lock in. Offer to export to Word.`
  },

  // ───────────────────────── Privacy ─────────────────────────
  {
    id: 'dsar-response',
    area: 'privacy',
    title: 'DSAR Response',
    cta: 'Respond to a data subject request',
    description: 'Draft a compliant response to a data subject access request with statutory timelines.',
    icon: 'UserSearch',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'regime', label: 'Regime', type: 'select', required: true, options: ['GDPR', 'CCPA/CPRA', 'UK GDPR', 'Other / multiple'] },
      { key: 'request', label: 'The request', type: 'textarea', required: true, placeholder: 'Paste the data subject’s request.' },
      { key: 'received', label: 'Date received', type: 'date' },
      { key: 'files', label: 'Request / correspondence (optional)', type: 'files' }
    ],
    runningLabel: 'Drafting the DSAR response…',
    systemPrompt: `You are handling a Data Subject Access Request. Identify the request type (access, deletion, correction, portability, opt-out) and the applicable regime. Output, in Markdown: (1) a **Timeline** box — the statutory response deadline computed from the date received (e.g. GDPR: 1 month; CCPA: 45 days), and any extension rules; (2) an **Identity verification** step; (3) a **Scope & exemptions** analysis — what must be provided and what may be withheld; (4) a complete **draft response letter** to the data subject in plain language. Cite the relevant articles/sections. Flag anything requiring human/DPO sign-off. Offer to export to Word.`
  },
  {
    id: 'dpa-review',
    area: 'privacy',
    title: 'DPA Review',
    cta: 'Review a data processing agreement',
    description: 'Review a DPA from your side (controller or processor) against required terms.',
    icon: 'FileLock2',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'files', label: 'DPA to review', type: 'files', required: true, help: `Attach the DPA (${SUPPORTED_DOCS}).` },
      { key: 'role', label: 'We are the…', type: 'select', required: true, options: ['Controller', 'Processor', 'Sub-processor'] },
      { key: 'transfers', label: 'International transfers?', type: 'select', options: ['No', 'Yes — SCCs', 'Yes — other', 'Unsure'] }
    ],
    runningLabel: 'Reviewing the DPA…',
    systemPrompt: `You are reviewing a Data Processing Agreement from the perspective indicated. Read the DPA fully. Check it against the required Article 28 GDPR processor terms (and CCPA service-provider terms if relevant): subject-matter/duration, processing only on instructions, confidentiality, security measures, sub-processor controls, data-subject-rights assistance, breach notification, deletion/return, audit rights, and international transfer mechanisms. Output a Markdown review: a coverage checklist (✅/⚠️/❌ per required term with the clause cite), an Issues & Redlines section with suggested language, and a transfer-mechanism assessment. Offer to export to Word.`
  },
  {
    id: 'use-case-triage',
    area: 'privacy',
    title: 'Use-Case Triage',
    cta: 'Triage a new data use case',
    description: 'Decide whether a new processing activity needs a PIA, a DPIA, or can proceed.',
    icon: 'GitBranch',
    outputType: 'memo',
    tools: ['read_file', 'web_search'],
    intakeFields: [
      { key: 'usecase', label: 'Describe the use case', type: 'textarea', required: true, placeholder: 'What data, for what purpose, what processing?' },
      { key: 'data_types', label: 'Data involved', type: 'text', placeholder: 'e.g. email, location, biometric, children’s data' }
    ],
    runningLabel: 'Triaging the use case…',
    systemPrompt: `You are a privacy triage gate. Given the use case, decide: **Proceed**, **PIA required**, or **DPIA required**. Apply the GDPR Art. 35 high-risk triggers (large-scale special categories, systematic monitoring, profiling with significant effects, etc.). Output: the decision, the specific triggers met or not met, the lawful basis question to resolve, and recommended next steps with owners. Be concise and decisive.`
  },

  // ───────────────────────── Corporate ─────────────────────────
  {
    id: 'tabular-diligence',
    area: 'corporate',
    title: 'Tabular Diligence Review',
    cta: 'Build a cited diligence table',
    description: 'Review a set of diligence documents into one cited row-per-document table.',
    icon: 'Table2',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'list_dir', 'write_xlsx'],
    intakeFields: [
      { key: 'files', label: 'Diligence documents', type: 'files', required: true, help: `Attach the data-room documents (${SUPPORTED_DOCS}).` },
      { key: 'focus', label: 'Review focus', type: 'text', placeholder: 'e.g. change-of-control, assignment, exclusivity' }
    ],
    runningLabel: 'Reviewing documents into a diligence table…',
    systemPrompt: `You are performing M&A due diligence with a tabular review: **one row per document, every cell cited**. Read each document. Produce a Markdown table with columns: Document, Type, Counterparty, Effective/Term, **Change-of-control / assignment** (quote + section cite), **Key risk flags**, Notes. Tailor a column to the stated review focus. Every substantive cell must cite the section it came from; if a document is silent on a point, write "Not addressed". After the table, list the top issues for the deal team, ranked by deal impact. Offer to export to Excel.`
  },
  {
    id: 'closing-checklist',
    area: 'corporate',
    title: 'Closing Checklist',
    cta: 'Build a closing checklist',
    description: 'Generate a closing checklist with responsible parties and status from the deal terms.',
    icon: 'ListChecks',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_xlsx'],
    intakeFields: [
      { key: 'deal', label: 'Deal description', type: 'textarea', required: true, placeholder: 'Type of transaction, parties, structure.' },
      { key: 'files', label: 'Term sheet / SPA (optional)', type: 'files' }
    ],
    runningLabel: 'Building the closing checklist…',
    systemPrompt: `You are preparing a closing checklist for the described transaction. Read any attached deal documents. Produce a Markdown checklist table grouped by phase (Conditions Precedent, Deliverables at Signing, Deliverables at Closing, Post-Closing) with columns: Item, Responsible party, Depends on, Status. Base items on the actual deal structure and any documents provided. After the table, flag the gating items that most threaten the closing timeline. Offer to export to Excel.`
  },
  {
    id: 'entity-compliance',
    area: 'corporate',
    title: 'Entity Compliance Tracker',
    cta: 'Track entity compliance',
    description: 'Summarize entity compliance obligations and deadlines across jurisdictions.',
    icon: 'Landmark',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_xlsx'],
    intakeFields: [
      { key: 'entities', label: 'Entities & jurisdictions', type: 'textarea', required: true, placeholder: 'List each entity and where it is registered.' },
      { key: 'files', label: 'Org chart / filings (optional)', type: 'files' }
    ],
    runningLabel: 'Compiling entity compliance obligations…',
    systemPrompt: `You are building an entity compliance tracker. For each entity and jurisdiction listed, identify the recurring corporate compliance obligations (annual report/return, registered agent, franchise tax, beneficial ownership filings, license renewals). Output a Markdown table: Entity, Jurisdiction, Obligation, Typical deadline, Notes. Use web search to confirm jurisdiction-specific requirements where helpful, and note where requirements should be confirmed with local counsel. Offer to export to Excel.`
  },

  // ───────────────────── Commercial (additional) ─────────────────────
  {
    id: 'nda-triage',
    area: 'commercial',
    title: 'NDA Triage',
    cta: 'Triage an NDA fast',
    description: 'Quick accept / redline / escalate decision on an NDA against standard positions.',
    icon: 'FileCheck2',
    outputType: 'memo',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_docx'],
    intakeFields: [
      { key: 'files', label: 'NDA', type: 'files', required: true, help: `Attach the NDA (${SUPPORTED_DOCS}).` },
      { key: 'our_role', label: 'We are the…', type: 'select', options: ['Disclosing party', 'Receiving party', 'Mutual'] }
    ],
    runningLabel: 'Triaging the NDA…',
    systemPrompt: `You are triaging an NDA for fast turnaround. Read it, then give a one-line verdict: **Accept as-is**, **Accept with redlines**, or **Escalate**. Check the standard NDA points and present them as a compact table (point, ✅/⚠️, clause cite): definition of Confidential Information, term & survival, permitted disclosures (incl. compelled disclosure), return/destruction, no license, residuals clause, non-solicit creep, governing law, injunctive relief. Then list only the 3–5 redlines that actually matter for the user's role, each with suggested replacement language in a > blockquote. Be fast and decisive. Offer to export to Word.`
  },
  {
    id: 'saas-review',
    area: 'commercial',
    title: 'SaaS Agreement Review',
    cta: 'Review a SaaS subscription',
    description: 'Review a SaaS / subscription agreement and order form for the terms that bite.',
    icon: 'Cloud',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'files', label: 'MSA / order form / DPA', type: 'files', required: true, help: `Attach the agreement(s) (${SUPPORTED_DOCS}).` },
      { key: 'our_role', label: 'We are the…', type: 'select', options: ['Customer', 'Vendor'] },
      { key: 'data', label: 'Involves personal data?', type: 'select', options: ['Yes', 'No', 'Unsure'] }
    ],
    runningLabel: 'Reviewing the SaaS agreement…',
    systemPrompt: `You are reviewing a SaaS subscription agreement (and any order form / DPA). Read everything. Focus on the terms that bite: pricing & renewal uplift caps, auto-renewal & termination for convenience, SLA & service credits, data security & privacy/DPA terms, IP ownership & feedback license, limitation of liability & carve-outs, indemnities, suspension rights, and data export/return on exit. Output in Markdown: Snapshot (risk posture Low/Med/High), Key Terms table with section cites, Issues & Redlines ordered by severity (each with suggested language in a > blockquote), and Recommended position from the user's side. Offer to export to Word.`
  },
  {
    id: 'amendment-history',
    area: 'commercial',
    title: 'Amendment History',
    cta: 'Trace an amendment history',
    description: 'Reconstruct how an agreement changed across amendments into a clean change log.',
    icon: 'GitCompare',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'list_dir', 'write_xlsx', 'diff_documents'],
    intakeFields: [
      { key: 'files', label: 'Base agreement + amendments', type: 'files', required: true, help: `Attach the base agreement and every amendment (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: 'Tracing the amendment history…',
    systemPrompt: `You are tracing an amendment history. Read the base agreement and every amendment/addendum. When two versions of the same document are provided, use diff_documents to get an exact redline before describing changes. Produce a Markdown table: Amendment (# / date), Sections changed, What changed (before → after, with cites), Effect. Then output a **Current effective terms** section that states, after applying all amendments in order, the operative position on the key provisions (term, pricing, liability cap, termination, renewal). Flag any conflicts or ambiguities between amendments that need human resolution. Offer to export to Excel.`
  },

  // ───────────────────── Litigation (additional) ─────────────────────
  {
    id: 'matter-intake',
    area: 'litigation',
    title: 'Matter Intake',
    cta: 'Open a new matter',
    description: 'Structured intake and issue-spotting work-up for a new dispute or claim.',
    icon: 'FolderPlus',
    outputType: 'memo',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search'],
    intakeFields: [
      { key: 'matter', label: 'What happened', type: 'textarea', required: true, placeholder: 'Parties, facts, what the dispute is about.' },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', placeholder: 'e.g. SDNY, California state' },
      { key: 'files', label: 'Documents (optional)', type: 'files' }
    ],
    runningLabel: 'Working up the matter…',
    systemPrompt: `You are doing a new-matter work-up for the attorney. Read any documents. Produce a memo with: Parties & roles; Summary of facts; Potential claims and defenses (state the elements and the jurisdiction's standard for each); Key dates and **limitations / statute-of-limitations risk** (flag prominently); Evidence we have vs. need; Immediate action items (litigation hold / preservation?); Recommended next steps. Do not overstate certainty; mark open questions. This is attorney work product, not advice to a client.`
  },
  {
    id: 'demand-triage',
    area: 'litigation',
    title: 'Demand Triage (Received)',
    cta: 'Triage a demand we received',
    description: 'Assess a demand letter received against us and recommend a response posture.',
    icon: 'Inbox',
    outputType: 'memo',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search'],
    intakeFields: [
      { key: 'demand', label: 'The demand', type: 'textarea', required: true, placeholder: 'Paste the demand, or summarize it and attach the letter below.' },
      { key: 'files', label: 'Demand letter (optional)', type: 'files' },
      { key: 'deadline', label: 'Response deadline (if any)', type: 'date' }
    ],
    runningLabel: 'Triaging the received demand…',
    systemPrompt: `You are triaging a demand letter received against the user's organization. Read it. Output: What they are claiming and the legal basis; Strength assessment (are the elements plausibly met? what's weak?); Our realistic exposure and range; Deadlines (response-by); Recommended posture (ignore / acknowledge / negotiate / reject-with-basis) with reasoning; and a draft holding response. Flag anything needing immediate document preservation, insurer/broker notice, or escalation. Be candid about risk.`
  },
  {
    id: 'claim-chart',
    area: 'litigation',
    title: 'Claim Chart',
    cta: 'Build a claim chart',
    description: 'Map each element of a claim (or each limitation of a patent claim) to evidence.',
    icon: 'Grid3x3',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_xlsx'],
    intakeFields: [
      { key: 'claim', label: 'The claim or cause of action', type: 'textarea', required: true, placeholder: 'e.g. breach of contract; or paste a patent claim.' },
      { key: 'files', label: 'Evidence / documents (optional)', type: 'files' }
    ],
    runningLabel: 'Building the claim chart…',
    systemPrompt: `You are building a claim chart. Break the stated claim or cause of action into its required elements (or, for a patent claim, its limitations). Produce a Markdown table: Element / Limitation, What it requires, **Supporting evidence** (with source cite), Gap / risk. Be rigorous — only cite evidence that actually appears in the materials; if there is none for an element, say "No support found". After the table, summarize which elements are well-supported vs. vulnerable. Offer to export to Excel.`
  },
  {
    id: 'privilege-log',
    area: 'litigation',
    title: 'Privilege Log Review',
    cta: 'Review for privilege',
    description: 'Assess documents or log entries for privilege and produce a defensible log.',
    icon: 'ShieldAlert',
    outputType: 'table',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'read_xlsx', 'write_xlsx'],
    intakeFields: [
      { key: 'files', label: 'Documents or existing log', type: 'files', required: true, help: `Attach the documents or a draft log (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: 'Reviewing for privilege…',
    systemPrompt: `You are reviewing for privilege. For each document or entry, assess the claim — attorney-client privilege, work product, or none — and the basis. Produce a Markdown table: Doc ID / Date, Author → Recipients, Description, **Privilege claim**, Basis, Confidence. Flag entries where the claim is weak (e.g. no attorney in the chain, business advice) or where the description is inadequate for a privilege log. State clearly that all calls require attorney review before any production. Offer to export to Excel.`
  },

  // ───────────────────── Privacy (additional) ─────────────────────
  {
    id: 'pia-generation',
    area: 'privacy',
    title: 'PIA / DPIA',
    cta: 'Generate a PIA / DPIA',
    description: 'Draft a privacy / data-protection impact assessment for a processing activity.',
    icon: 'ClipboardCheck',
    outputType: 'document',
    tools: ['read_file', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'usecase', label: 'Processing activity', type: 'textarea', required: true, placeholder: 'What data, for what purpose, by what means?' },
      { key: 'regime', label: 'Regime', type: 'select', required: true, options: ['GDPR', 'UK GDPR', 'CCPA/CPRA', 'Other / multiple'] },
      { key: 'data_types', label: 'Data involved', type: 'text', placeholder: 'e.g. health, location, children’s data' }
    ],
    runningLabel: 'Drafting the impact assessment…',
    systemPrompt: `You are drafting a DPIA / PIA. Produce the assessment in Markdown with sections: Description of processing (nature, scope, context, purposes); Necessity & proportionality; Lawful basis; Data flows & recipients (incl. transfers); Risks to data subjects (each rated likelihood × severity); Mitigations & residual risk; Consultation / sign-off required. Cite the relevant articles/sections. Conclude with an overall risk rating and whether prior consultation with the supervisory authority is required. Offer to export to Word.`
  },
  {
    id: 'policy-drift',
    area: 'privacy',
    title: 'Privacy Policy Drift',
    cta: 'Check a policy for drift',
    description: 'Compare a privacy policy against current practices or new rules to find gaps.',
    icon: 'Radar',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'web_search', 'write_docx'],
    intakeFields: [
      { key: 'files', label: 'Privacy policy', type: 'files', required: true, help: `Attach the current policy (${SUPPORTED_DOCS}).` },
      { key: 'changes', label: 'New practices or reg changes (optional)', type: 'textarea', placeholder: 'What changed in the product or the law?' }
    ],
    runningLabel: 'Checking the policy for drift…',
    systemPrompt: `You are reviewing a privacy policy for drift. Read the policy and compare it against the described practices / regulatory changes and current GDPR & CCPA/CPRA disclosure requirements. Output a gap table: Required/expected disclosure, Policy status (✅/⚠️/❌ + cite), Recommended update. Then a prioritized list of edits with suggested language, leading with anything that creates regulatory exposure or is materially inaccurate. Offer to export to Word.`
  },
  {
    id: 'breach-assessment',
    area: 'privacy',
    title: 'Breach Notification Assessment',
    cta: 'Assess a data breach',
    description: 'Assess notification obligations and timelines for a suspected data breach.',
    icon: 'FileWarning',
    outputType: 'memo',
    tools: ['read_file', 'web_search'],
    intakeFields: [
      { key: 'incident', label: 'The incident', type: 'textarea', required: true, placeholder: 'What happened, what data, when discovered, how many people.' },
      { key: 'regime', label: 'Regime', type: 'select', required: true, options: ['GDPR', 'UK GDPR', 'CCPA/CPRA', 'Multiple / unsure'] },
      { key: 'discovered', label: 'Date discovered', type: 'date' }
    ],
    runningLabel: 'Assessing notification obligations…',
    systemPrompt: `You are assessing a suspected personal data breach. Determine: Is this a personal data breach? Severity (data types, volume, likelihood and severity of harm). Notification obligations — to the supervisory authority (e.g. GDPR's 72-hour clock), to affected data subjects, and any processor→controller contractual notice. Compute deadlines from the discovery date. Output: a **Timeline** box, an obligations table (Who / When / Threshold met?), and recommended immediate steps. State clearly this requires DPO/counsel sign-off and is not a substitute for the incident-response plan.`
  },

  // ───────────────────── Corporate (additional) ─────────────────────
  {
    id: 'diligence-issues',
    area: 'corporate',
    title: 'Diligence Issue Extraction',
    cta: 'Extract diligence issues',
    description: 'Pull a ranked issues list out of diligence documents for the deal team.',
    icon: 'ListFilter',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'list_dir', 'write_docx'],
    intakeFields: [
      { key: 'files', label: 'Diligence documents', type: 'files', required: true, help: `Attach the data-room documents (${SUPPORTED_DOCS}).` },
      { key: 'deal_context', label: 'Deal context (optional)', type: 'text', placeholder: 'Type of deal, what matters most.' }
    ],
    runningLabel: 'Extracting and ranking diligence issues…',
    systemPrompt: `You are extracting diligence issues for the deal team. Read the documents. Produce a ranked issues list (not a per-document table). Group by category — Corporate, Contracts, IP, Employment, Litigation, Compliance. For each issue: Severity (High/Med/Low), the issue, the document(s) and section it arises from, deal impact, and recommended action (rep, indemnity, condition, price adjustment, or walk). Lead with the deal-breakers. Offer to export to Word.`
  },
  {
    id: 'written-consent',
    area: 'corporate',
    title: 'Written Consent / Resolution',
    cta: 'Draft a written consent',
    description: 'Draft board or stockholder written consents / resolutions for corporate actions.',
    icon: 'PenLine',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_docx'],
    intakeFields: [
      { key: 'action', label: 'What is being approved', type: 'textarea', required: true, placeholder: 'The corporate action(s) to authorize.' },
      { key: 'entity', label: 'Entity', type: 'text', placeholder: 'Entity name & type' },
      { key: 'body', label: 'Approving body', type: 'select', options: ['Board', 'Stockholders', 'Both'] }
    ],
    runningLabel: 'Drafting the written consent…',
    systemPrompt: `You are drafting a written consent in lieu of a meeting. Produce a send-ready document: title, entity & approving body, recitals (WHEREAS) establishing context, resolutions (RESOLVED) with operative language for each action, an omnibus "further actions" resolution, and a signature block with date lines. Match the requested action(s) precisely. Flag any approval that may require an actual meeting, a special vote, or stockholder (not just board) approval. Offer to export to Word.`
  },
  {
    id: 'board-minutes',
    area: 'corporate',
    title: 'Board Minutes',
    cta: 'Draft board minutes',
    description: 'Draft formal minutes of a board meeting from an agenda or notes.',
    icon: 'NotebookPen',
    outputType: 'document',
    tools: ['read_file', 'read_pdf', 'read_docx', 'extract_highlights', 'write_docx'],
    intakeFields: [
      { key: 'notes', label: 'Agenda / notes', type: 'textarea', required: true, placeholder: 'Agenda items, what was discussed, decisions made.' },
      { key: 'entity', label: 'Entity', type: 'text' },
      { key: 'date', label: 'Meeting date', type: 'date' }
    ],
    runningLabel: 'Drafting the board minutes…',
    systemPrompt: `You are drafting board meeting minutes. From the agenda/notes, produce proper minutes: header (entity, date, time, location/remote), attendance & quorum, call to order, approval of prior minutes, each agenda item with a neutral discussion summary and any resolutions adopted (with vote), and adjournment, ending with a secretary signature block. Record decisions and votes, not verbatim discussion. Flag any item that appears to need a formal resolution that was not clearly adopted. Offer to export to Word.`
  }
]

export function workflowById(id: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.id === id)
}

export function workflowsByArea(area: string): Workflow[] {
  return WORKFLOWS.filter((w) => w.area === area)
}
