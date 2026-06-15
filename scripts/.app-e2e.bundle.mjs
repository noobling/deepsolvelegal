// scripts/app-e2e.ts
import { app as app4 } from "electron";
import os from "os";
import path8 from "path";
import { promises as fs8 } from "fs";

// src/main/storage/store.ts
import { app } from "electron";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
var userData = () => app.getPath("userData");
var settingsPath = () => path.join(userData(), "settings.json");
var mattersDir = () => path.join(userData(), "matters");
function defaultSettings() {
  return {
    provider: "anthropic",
    model: "claude-opus-4-8",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "",
    matterRoot: path.join(app.getPath("documents"), "DeepSolve Legal"),
    profile: "",
    autoApproveReads: true
  };
}
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}
async function getSettings() {
  return readJson(settingsPath(), defaultSettings());
}
async function setSettings(patch) {
  const next = { ...await getSettings(), ...patch };
  await writeJson(settingsPath(), next);
  return next;
}
function matterPath(id) {
  return path.join(mattersDir(), id);
}
function matterFilesDir(id) {
  return path.join(matterPath(id), "files");
}
async function createMatter(meta) {
  const folder = matterPath(meta.id);
  await ensureDir(path.join(folder, "files"));
  const full = { ...meta, folder };
  await writeJson(path.join(folder, "meta.json"), full);
  await writeJson(path.join(folder, "thread.json"), { messages: [], activities: [] });
  return full;
}
async function getMatter(id) {
  const metaFile = path.join(matterPath(id), "meta.json");
  if (!existsSync(metaFile)) return null;
  const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
  const thread = await readJson(path.join(matterPath(id), "thread.json"), {
    messages: [],
    activities: []
  });
  return { ...meta, ...thread };
}
async function loadThread(id) {
  return readJson(path.join(matterPath(id), "thread.json"), {
    messages: [],
    activities: []
  });
}
async function saveThread(id, thread) {
  await writeJson(path.join(matterPath(id), "thread.json"), thread);
  const metaFile = path.join(matterPath(id), "meta.json");
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
    meta.updatedAt = Date.now();
    await writeJson(metaFile, meta);
  }
}
async function appendMessage(id, message) {
  const thread = await loadThread(id);
  thread.messages.push(message);
  await saveThread(id, thread);
}
async function updateMessageText(id, messageId, text) {
  const thread = await loadThread(id);
  const m = thread.messages.find((x) => x.id === messageId);
  if (m) {
    m.text = text;
    await saveThread(id, thread);
  }
}
async function appendActivity(id, activity) {
  const thread = await loadThread(id);
  thread.activities.push(activity);
  await saveThread(id, thread);
}
async function getApiMessages(id) {
  const file = path.join(matterPath(id), "api.json");
  return readJson(file, { messages: [] }).then((d) => d.messages);
}
async function setApiMessages(id, messages) {
  await writeJson(path.join(matterPath(id), "api.json"), { messages });
}
async function finishActivity(id, activityId, ok, summary) {
  const thread = await loadThread(id);
  const a = thread.activities.find((x) => x.id === activityId);
  if (a) {
    a.ok = ok;
    a.summary = summary;
    a.endedAt = Date.now();
    await saveThread(id, thread);
  }
}

// src/main/agent/runAgent.ts
import path7 from "path";
import { promises as fs7 } from "fs";
import { existsSync as existsSync6 } from "fs";

// src/shared/workflows.ts
var SUPPORTED_DOCS = ".pdf, .docx, .txt, or .xlsx";
var WORKFLOWS = [
  // ───────────────────────── Commercial ─────────────────────────
  {
    id: "contract-review",
    area: "commercial",
    title: "Contract / NDA Review",
    cta: "Review a contract",
    description: "Issue-spot an agreement against your playbook and produce a redline-ready summary.",
    icon: "FileSearch",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      {
        key: "files",
        label: "Agreement to review",
        type: "files",
        required: true,
        help: `Attach the contract (${SUPPORTED_DOCS}).`
      },
      { key: "counterparty", label: "Counterparty", type: "text", placeholder: "Acme Corp." },
      { key: "our_role", label: "We are the\u2026", type: "select", options: ["Customer", "Vendor", "Either / mutual"] },
      {
        key: "concerns",
        label: "Specific concerns (optional)",
        type: "textarea",
        placeholder: "e.g. liability cap, data security, auto-renewal"
      }
    ],
    runningLabel: "Reading the agreement and spotting issues\u2026",
    systemPrompt: `You are reviewing a commercial agreement on behalf of the user's organization.

First, read every attached document fully using the file tools. Then produce a structured review with these sections, formatted in Markdown:

## Snapshot
A 3\u20134 sentence plain-English summary: what this agreement is, the parties, term, and overall risk posture (Low / Medium / High) with one sentence of justification.

## Key Terms
A compact table of: Term length, Renewal mechanics, Payment terms, Liability cap, Indemnities, Termination rights, Governing law. Cite the clause/section number for each.

## Issues & Redlines
A numbered list, ordered by severity. For each issue give: **the clause**, **why it's a problem** for the user's side, and a **suggested redline** (proposed replacement language in a > blockquote). Tie each to the user's stated role and concerns.

## Recommended Position
Two or three bullets on what to push on vs. what to concede.

Be specific and cite section numbers. Never invent clauses that aren't in the document. If something important is missing from the contract (e.g. no limitation of liability), call that out explicitly as an issue. When you have produced the review, offer to export it to Word.`
  },
  {
    id: "renewal-tracker",
    area: "commercial",
    title: "Renewal Tracker",
    cta: "Track renewals & cancel-by dates",
    description: "Extract renewal and cancel-by deadlines from a set of agreements into a tracker.",
    icon: "CalendarClock",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "list_dir", "write_xlsx"],
    intakeFields: [
      { key: "files", label: "Agreements", type: "files", required: true, help: `Attach one or more contracts (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: "Extracting renewal and cancel-by dates\u2026",
    systemPrompt: `You are building a renewal register. Read each attached agreement and extract a row per contract with these columns: Counterparty, Agreement type, Effective date, Term, Auto-renews? (Y/N), Renewal term, Notice period, **Cancel-by date** (computed from the next renewal and notice period), Annual value (if stated). Output a Markdown table sorted by Cancel-by date (soonest first). Flag any contract whose cancel-by date is within 90 days with \u26A0\uFE0F. After the table, list any contracts where renewal terms were ambiguous and need human review. Offer to export the register to Excel.`
  },
  {
    id: "escalation-flagger",
    area: "commercial",
    title: "Escalation Flagger",
    cta: "Decide if this needs escalation",
    description: "Triage an incoming request or clause against escalation rules and route it.",
    icon: "Siren",
    outputType: "memo",
    tools: ["read_file", "read_pdf", "read_docx"],
    intakeFields: [
      { key: "request", label: "The request or clause", type: "textarea", required: true, placeholder: "Paste the ask, email, or clause here." },
      { key: "files", label: "Related documents (optional)", type: "files" }
    ],
    runningLabel: "Triaging against escalation rules\u2026",
    systemPrompt: `You are an in-house triage gate. Given the request and any documents, decide: **Handle now**, **Escalate**, or **Need more info**. Use the user's practice profile escalation rules if present. Output: a one-line decision, the reasoning (which rule or risk triggered it), who it should go to if escalated, and a draft 2-sentence message to that person. Be decisive.`
  },
  // ───────────────────────── Litigation ─────────────────────────
  {
    id: "demand-draft",
    area: "litigation",
    title: "Demand Letter",
    cta: "Draft a demand letter",
    description: "Draft a persuasive, well-structured demand letter from the facts and legal basis.",
    icon: "Mail",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      { key: "recipient", label: "Recipient", type: "text", required: true, placeholder: "Name / company being demanded" },
      { key: "client", label: "Our client", type: "text", placeholder: "Who we represent" },
      { key: "jurisdiction", label: "Jurisdiction", type: "text", placeholder: "e.g. California" },
      { key: "facts", label: "Facts & legal basis", type: "textarea", required: true, placeholder: "What happened, what was breached, what we want." },
      { key: "files", label: "Supporting documents (optional)", type: "files" }
    ],
    runningLabel: "Drafting the demand letter\u2026",
    systemPrompt: `You are drafting a formal demand letter. Read any attached documents first. Produce a complete, send-ready letter in Markdown with: date line, recipient block, RE: line, an opening that identifies your client and purpose, a numbered factual background, the legal basis for the demand (cite the relevant doctrine/statute for the jurisdiction; verify with web search if helpful), a clear and specific demand with a deadline, a statement of consequences for non-compliance, and a professional closing. Keep the tone firm but professional. Do not fabricate citations \u2014 if you are unsure of a precise statute, describe the legal basis generally and flag it for attorney verification. Offer to export to Word.`
  },
  {
    id: "chronology-builder",
    area: "litigation",
    title: "Chronology Builder",
    cta: "Build a case chronology",
    description: "Assemble a dated, sourced chronology of events from documents and notes.",
    icon: "ListOrdered",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "write_xlsx"],
    intakeFields: [
      { key: "files", label: "Source documents", type: "files", required: true, help: `Emails, contracts, notes (${SUPPORTED_DOCS}).` },
      { key: "context", label: "Matter context (optional)", type: "textarea", placeholder: "What is this dispute about?" }
    ],
    runningLabel: "Extracting events into a chronology\u2026",
    systemPrompt: `You are building a litigation chronology. Read every source document. Extract a row per discrete event with columns: Date, Event, Actor(s), **Source** (document name + page/section), Significance. Output a Markdown table sorted chronologically. Where a date is approximate or inferred, mark it (~). After the table, add a short "Gaps & ambiguities" list noting events with unclear dates or missing sources. Never assert a fact without a source. Offer to export to Excel.`
  },
  {
    id: "deposition-prep",
    area: "litigation",
    title: "Deposition Prep",
    cta: "Prep a deposition outline",
    description: "Build a deposition outline with topic blocks, key exhibits, and questions.",
    icon: "MessageSquareQuote",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "write_docx"],
    intakeFields: [
      { key: "deponent", label: "Deponent", type: "text", required: true, placeholder: "Who is being deposed + their role" },
      { key: "theory", label: "Case theory / goals", type: "textarea", required: true, placeholder: "What you need to establish or undermine." },
      { key: "files", label: "Key documents (optional)", type: "files" }
    ],
    runningLabel: "Building the deposition outline\u2026",
    systemPrompt: `You are preparing a deposition outline. Read attached documents. Produce an outline in Markdown organized into topic blocks. For each block: the objective, the foundational questions, the key questions (open then locking), and the exhibits to use (with where they came from). Integrate the case theory throughout \u2014 flag where an answer either way advances or threatens it. End with a list of admissions you are trying to lock in. Offer to export to Word.`
  },
  // ───────────────────────── Privacy ─────────────────────────
  {
    id: "dsar-response",
    area: "privacy",
    title: "DSAR Response",
    cta: "Respond to a data subject request",
    description: "Draft a compliant response to a data subject access request with statutory timelines.",
    icon: "UserSearch",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      { key: "regime", label: "Regime", type: "select", required: true, options: ["GDPR", "CCPA/CPRA", "UK GDPR", "Other / multiple"] },
      { key: "request", label: "The request", type: "textarea", required: true, placeholder: "Paste the data subject\u2019s request." },
      { key: "received", label: "Date received", type: "date" },
      { key: "files", label: "Request / correspondence (optional)", type: "files" }
    ],
    runningLabel: "Drafting the DSAR response\u2026",
    systemPrompt: `You are handling a Data Subject Access Request. Identify the request type (access, deletion, correction, portability, opt-out) and the applicable regime. Output, in Markdown: (1) a **Timeline** box \u2014 the statutory response deadline computed from the date received (e.g. GDPR: 1 month; CCPA: 45 days), and any extension rules; (2) an **Identity verification** step; (3) a **Scope & exemptions** analysis \u2014 what must be provided and what may be withheld; (4) a complete **draft response letter** to the data subject in plain language. Cite the relevant articles/sections. Flag anything requiring human/DPO sign-off. Offer to export to Word.`
  },
  {
    id: "dpa-review",
    area: "privacy",
    title: "DPA Review",
    cta: "Review a data processing agreement",
    description: "Review a DPA from your side (controller or processor) against required terms.",
    icon: "FileLock2",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      { key: "files", label: "DPA to review", type: "files", required: true, help: `Attach the DPA (${SUPPORTED_DOCS}).` },
      { key: "role", label: "We are the\u2026", type: "select", required: true, options: ["Controller", "Processor", "Sub-processor"] },
      { key: "transfers", label: "International transfers?", type: "select", options: ["No", "Yes \u2014 SCCs", "Yes \u2014 other", "Unsure"] }
    ],
    runningLabel: "Reviewing the DPA\u2026",
    systemPrompt: `You are reviewing a Data Processing Agreement from the perspective indicated. Read the DPA fully. Check it against the required Article 28 GDPR processor terms (and CCPA service-provider terms if relevant): subject-matter/duration, processing only on instructions, confidentiality, security measures, sub-processor controls, data-subject-rights assistance, breach notification, deletion/return, audit rights, and international transfer mechanisms. Output a Markdown review: a coverage checklist (\u2705/\u26A0\uFE0F/\u274C per required term with the clause cite), an Issues & Redlines section with suggested language, and a transfer-mechanism assessment. Offer to export to Word.`
  },
  {
    id: "use-case-triage",
    area: "privacy",
    title: "Use-Case Triage",
    cta: "Triage a new data use case",
    description: "Decide whether a new processing activity needs a PIA, a DPIA, or can proceed.",
    icon: "GitBranch",
    outputType: "memo",
    tools: ["read_file", "web_search"],
    intakeFields: [
      { key: "usecase", label: "Describe the use case", type: "textarea", required: true, placeholder: "What data, for what purpose, what processing?" },
      { key: "data_types", label: "Data involved", type: "text", placeholder: "e.g. email, location, biometric, children\u2019s data" }
    ],
    runningLabel: "Triaging the use case\u2026",
    systemPrompt: `You are a privacy triage gate. Given the use case, decide: **Proceed**, **PIA required**, or **DPIA required**. Apply the GDPR Art. 35 high-risk triggers (large-scale special categories, systematic monitoring, profiling with significant effects, etc.). Output: the decision, the specific triggers met or not met, the lawful basis question to resolve, and recommended next steps with owners. Be concise and decisive.`
  },
  // ───────────────────────── Corporate ─────────────────────────
  {
    id: "tabular-diligence",
    area: "corporate",
    title: "Tabular Diligence Review",
    cta: "Build a cited diligence table",
    description: "Review a set of diligence documents into one cited row-per-document table.",
    icon: "Table2",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "list_dir", "write_xlsx"],
    intakeFields: [
      { key: "files", label: "Diligence documents", type: "files", required: true, help: `Attach the data-room documents (${SUPPORTED_DOCS}).` },
      { key: "focus", label: "Review focus", type: "text", placeholder: "e.g. change-of-control, assignment, exclusivity" }
    ],
    runningLabel: "Reviewing documents into a diligence table\u2026",
    systemPrompt: `You are performing M&A due diligence with a tabular review: **one row per document, every cell cited**. Read each document. Produce a Markdown table with columns: Document, Type, Counterparty, Effective/Term, **Change-of-control / assignment** (quote + section cite), **Key risk flags**, Notes. Tailor a column to the stated review focus. Every substantive cell must cite the section it came from; if a document is silent on a point, write "Not addressed". After the table, list the top issues for the deal team, ranked by deal impact. Offer to export to Excel.`
  },
  {
    id: "closing-checklist",
    area: "corporate",
    title: "Closing Checklist",
    cta: "Build a closing checklist",
    description: "Generate a closing checklist with responsible parties and status from the deal terms.",
    icon: "ListChecks",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "write_xlsx"],
    intakeFields: [
      { key: "deal", label: "Deal description", type: "textarea", required: true, placeholder: "Type of transaction, parties, structure." },
      { key: "files", label: "Term sheet / SPA (optional)", type: "files" }
    ],
    runningLabel: "Building the closing checklist\u2026",
    systemPrompt: `You are preparing a closing checklist for the described transaction. Read any attached deal documents. Produce a Markdown checklist table grouped by phase (Conditions Precedent, Deliverables at Signing, Deliverables at Closing, Post-Closing) with columns: Item, Responsible party, Depends on, Status. Base items on the actual deal structure and any documents provided. After the table, flag the gating items that most threaten the closing timeline. Offer to export to Excel.`
  },
  {
    id: "entity-compliance",
    area: "corporate",
    title: "Entity Compliance Tracker",
    cta: "Track entity compliance",
    description: "Summarize entity compliance obligations and deadlines across jurisdictions.",
    icon: "Landmark",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_xlsx"],
    intakeFields: [
      { key: "entities", label: "Entities & jurisdictions", type: "textarea", required: true, placeholder: "List each entity and where it is registered." },
      { key: "files", label: "Org chart / filings (optional)", type: "files" }
    ],
    runningLabel: "Compiling entity compliance obligations\u2026",
    systemPrompt: `You are building an entity compliance tracker. For each entity and jurisdiction listed, identify the recurring corporate compliance obligations (annual report/return, registered agent, franchise tax, beneficial ownership filings, license renewals). Output a Markdown table: Entity, Jurisdiction, Obligation, Typical deadline, Notes. Use web search to confirm jurisdiction-specific requirements where helpful, and note where requirements should be confirmed with local counsel. Offer to export to Excel.`
  },
  // ───────────────────── Commercial (additional) ─────────────────────
  {
    id: "nda-triage",
    area: "commercial",
    title: "NDA Triage",
    cta: "Triage an NDA fast",
    description: "Quick accept / redline / escalate decision on an NDA against standard positions.",
    icon: "FileCheck2",
    outputType: "memo",
    tools: ["read_file", "read_pdf", "read_docx", "write_docx"],
    intakeFields: [
      { key: "files", label: "NDA", type: "files", required: true, help: `Attach the NDA (${SUPPORTED_DOCS}).` },
      { key: "our_role", label: "We are the\u2026", type: "select", options: ["Disclosing party", "Receiving party", "Mutual"] }
    ],
    runningLabel: "Triaging the NDA\u2026",
    systemPrompt: `You are triaging an NDA for fast turnaround. Read it, then give a one-line verdict: **Accept as-is**, **Accept with redlines**, or **Escalate**. Check the standard NDA points and present them as a compact table (point, \u2705/\u26A0\uFE0F, clause cite): definition of Confidential Information, term & survival, permitted disclosures (incl. compelled disclosure), return/destruction, no license, residuals clause, non-solicit creep, governing law, injunctive relief. Then list only the 3\u20135 redlines that actually matter for the user's role, each with suggested replacement language in a > blockquote. Be fast and decisive. Offer to export to Word.`
  },
  {
    id: "saas-review",
    area: "commercial",
    title: "SaaS Agreement Review",
    cta: "Review a SaaS subscription",
    description: "Review a SaaS / subscription agreement and order form for the terms that bite.",
    icon: "Cloud",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      { key: "files", label: "MSA / order form / DPA", type: "files", required: true, help: `Attach the agreement(s) (${SUPPORTED_DOCS}).` },
      { key: "our_role", label: "We are the\u2026", type: "select", options: ["Customer", "Vendor"] },
      { key: "data", label: "Involves personal data?", type: "select", options: ["Yes", "No", "Unsure"] }
    ],
    runningLabel: "Reviewing the SaaS agreement\u2026",
    systemPrompt: `You are reviewing a SaaS subscription agreement (and any order form / DPA). Read everything. Focus on the terms that bite: pricing & renewal uplift caps, auto-renewal & termination for convenience, SLA & service credits, data security & privacy/DPA terms, IP ownership & feedback license, limitation of liability & carve-outs, indemnities, suspension rights, and data export/return on exit. Output in Markdown: Snapshot (risk posture Low/Med/High), Key Terms table with section cites, Issues & Redlines ordered by severity (each with suggested language in a > blockquote), and Recommended position from the user's side. Offer to export to Word.`
  },
  {
    id: "amendment-history",
    area: "commercial",
    title: "Amendment History",
    cta: "Trace an amendment history",
    description: "Reconstruct how an agreement changed across amendments into a clean change log.",
    icon: "GitCompare",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "list_dir", "write_xlsx"],
    intakeFields: [
      { key: "files", label: "Base agreement + amendments", type: "files", required: true, help: `Attach the base agreement and every amendment (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: "Tracing the amendment history\u2026",
    systemPrompt: `You are tracing an amendment history. Read the base agreement and every amendment/addendum. Produce a Markdown table: Amendment (# / date), Sections changed, What changed (before \u2192 after, with cites), Effect. Then output a **Current effective terms** section that states, after applying all amendments in order, the operative position on the key provisions (term, pricing, liability cap, termination, renewal). Flag any conflicts or ambiguities between amendments that need human resolution. Offer to export to Excel.`
  },
  // ───────────────────── Litigation (additional) ─────────────────────
  {
    id: "matter-intake",
    area: "litigation",
    title: "Matter Intake",
    cta: "Open a new matter",
    description: "Structured intake and issue-spotting work-up for a new dispute or claim.",
    icon: "FolderPlus",
    outputType: "memo",
    tools: ["read_file", "read_pdf", "read_docx", "web_search"],
    intakeFields: [
      { key: "matter", label: "What happened", type: "textarea", required: true, placeholder: "Parties, facts, what the dispute is about." },
      { key: "jurisdiction", label: "Jurisdiction", type: "text", placeholder: "e.g. SDNY, California state" },
      { key: "files", label: "Documents (optional)", type: "files" }
    ],
    runningLabel: "Working up the matter\u2026",
    systemPrompt: `You are doing a new-matter work-up for the attorney. Read any documents. Produce a memo with: Parties & roles; Summary of facts; Potential claims and defenses (state the elements and the jurisdiction's standard for each); Key dates and **limitations / statute-of-limitations risk** (flag prominently); Evidence we have vs. need; Immediate action items (litigation hold / preservation?); Recommended next steps. Do not overstate certainty; mark open questions. This is attorney work product, not advice to a client.`
  },
  {
    id: "demand-triage",
    area: "litigation",
    title: "Demand Triage (Received)",
    cta: "Triage a demand we received",
    description: "Assess a demand letter received against us and recommend a response posture.",
    icon: "Inbox",
    outputType: "memo",
    tools: ["read_file", "read_pdf", "read_docx", "web_search"],
    intakeFields: [
      { key: "demand", label: "The demand", type: "textarea", required: true, placeholder: "Paste the demand, or summarize it and attach the letter below." },
      { key: "files", label: "Demand letter (optional)", type: "files" },
      { key: "deadline", label: "Response deadline (if any)", type: "date" }
    ],
    runningLabel: "Triaging the received demand\u2026",
    systemPrompt: `You are triaging a demand letter received against the user's organization. Read it. Output: What they are claiming and the legal basis; Strength assessment (are the elements plausibly met? what's weak?); Our realistic exposure and range; Deadlines (response-by); Recommended posture (ignore / acknowledge / negotiate / reject-with-basis) with reasoning; and a draft holding response. Flag anything needing immediate document preservation, insurer/broker notice, or escalation. Be candid about risk.`
  },
  {
    id: "claim-chart",
    area: "litigation",
    title: "Claim Chart",
    cta: "Build a claim chart",
    description: "Map each element of a claim (or each limitation of a patent claim) to evidence.",
    icon: "Grid3x3",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "write_xlsx"],
    intakeFields: [
      { key: "claim", label: "The claim or cause of action", type: "textarea", required: true, placeholder: "e.g. breach of contract; or paste a patent claim." },
      { key: "files", label: "Evidence / documents (optional)", type: "files" }
    ],
    runningLabel: "Building the claim chart\u2026",
    systemPrompt: `You are building a claim chart. Break the stated claim or cause of action into its required elements (or, for a patent claim, its limitations). Produce a Markdown table: Element / Limitation, What it requires, **Supporting evidence** (with source cite), Gap / risk. Be rigorous \u2014 only cite evidence that actually appears in the materials; if there is none for an element, say "No support found". After the table, summarize which elements are well-supported vs. vulnerable. Offer to export to Excel.`
  },
  {
    id: "privilege-log",
    area: "litigation",
    title: "Privilege Log Review",
    cta: "Review for privilege",
    description: "Assess documents or log entries for privilege and produce a defensible log.",
    icon: "ShieldAlert",
    outputType: "table",
    tools: ["read_file", "read_pdf", "read_docx", "read_xlsx", "write_xlsx"],
    intakeFields: [
      { key: "files", label: "Documents or existing log", type: "files", required: true, help: `Attach the documents or a draft log (${SUPPORTED_DOCS}).` }
    ],
    runningLabel: "Reviewing for privilege\u2026",
    systemPrompt: `You are reviewing for privilege. For each document or entry, assess the claim \u2014 attorney-client privilege, work product, or none \u2014 and the basis. Produce a Markdown table: Doc ID / Date, Author \u2192 Recipients, Description, **Privilege claim**, Basis, Confidence. Flag entries where the claim is weak (e.g. no attorney in the chain, business advice) or where the description is inadequate for a privilege log. State clearly that all calls require attorney review before any production. Offer to export to Excel.`
  },
  // ───────────────────── Privacy (additional) ─────────────────────
  {
    id: "pia-generation",
    area: "privacy",
    title: "PIA / DPIA",
    cta: "Generate a PIA / DPIA",
    description: "Draft a privacy / data-protection impact assessment for a processing activity.",
    icon: "ClipboardCheck",
    outputType: "document",
    tools: ["read_file", "web_search", "write_docx"],
    intakeFields: [
      { key: "usecase", label: "Processing activity", type: "textarea", required: true, placeholder: "What data, for what purpose, by what means?" },
      { key: "regime", label: "Regime", type: "select", required: true, options: ["GDPR", "UK GDPR", "CCPA/CPRA", "Other / multiple"] },
      { key: "data_types", label: "Data involved", type: "text", placeholder: "e.g. health, location, children\u2019s data" }
    ],
    runningLabel: "Drafting the impact assessment\u2026",
    systemPrompt: `You are drafting a DPIA / PIA. Produce the assessment in Markdown with sections: Description of processing (nature, scope, context, purposes); Necessity & proportionality; Lawful basis; Data flows & recipients (incl. transfers); Risks to data subjects (each rated likelihood \xD7 severity); Mitigations & residual risk; Consultation / sign-off required. Cite the relevant articles/sections. Conclude with an overall risk rating and whether prior consultation with the supervisory authority is required. Offer to export to Word.`
  },
  {
    id: "policy-drift",
    area: "privacy",
    title: "Privacy Policy Drift",
    cta: "Check a policy for drift",
    description: "Compare a privacy policy against current practices or new rules to find gaps.",
    icon: "Radar",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "web_search", "write_docx"],
    intakeFields: [
      { key: "files", label: "Privacy policy", type: "files", required: true, help: `Attach the current policy (${SUPPORTED_DOCS}).` },
      { key: "changes", label: "New practices or reg changes (optional)", type: "textarea", placeholder: "What changed in the product or the law?" }
    ],
    runningLabel: "Checking the policy for drift\u2026",
    systemPrompt: `You are reviewing a privacy policy for drift. Read the policy and compare it against the described practices / regulatory changes and current GDPR & CCPA/CPRA disclosure requirements. Output a gap table: Required/expected disclosure, Policy status (\u2705/\u26A0\uFE0F/\u274C + cite), Recommended update. Then a prioritized list of edits with suggested language, leading with anything that creates regulatory exposure or is materially inaccurate. Offer to export to Word.`
  },
  {
    id: "breach-assessment",
    area: "privacy",
    title: "Breach Notification Assessment",
    cta: "Assess a data breach",
    description: "Assess notification obligations and timelines for a suspected data breach.",
    icon: "FileWarning",
    outputType: "memo",
    tools: ["read_file", "web_search"],
    intakeFields: [
      { key: "incident", label: "The incident", type: "textarea", required: true, placeholder: "What happened, what data, when discovered, how many people." },
      { key: "regime", label: "Regime", type: "select", required: true, options: ["GDPR", "UK GDPR", "CCPA/CPRA", "Multiple / unsure"] },
      { key: "discovered", label: "Date discovered", type: "date" }
    ],
    runningLabel: "Assessing notification obligations\u2026",
    systemPrompt: `You are assessing a suspected personal data breach. Determine: Is this a personal data breach? Severity (data types, volume, likelihood and severity of harm). Notification obligations \u2014 to the supervisory authority (e.g. GDPR's 72-hour clock), to affected data subjects, and any processor\u2192controller contractual notice. Compute deadlines from the discovery date. Output: a **Timeline** box, an obligations table (Who / When / Threshold met?), and recommended immediate steps. State clearly this requires DPO/counsel sign-off and is not a substitute for the incident-response plan.`
  },
  // ───────────────────── Corporate (additional) ─────────────────────
  {
    id: "diligence-issues",
    area: "corporate",
    title: "Diligence Issue Extraction",
    cta: "Extract diligence issues",
    description: "Pull a ranked issues list out of diligence documents for the deal team.",
    icon: "ListFilter",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "list_dir", "write_docx"],
    intakeFields: [
      { key: "files", label: "Diligence documents", type: "files", required: true, help: `Attach the data-room documents (${SUPPORTED_DOCS}).` },
      { key: "deal_context", label: "Deal context (optional)", type: "text", placeholder: "Type of deal, what matters most." }
    ],
    runningLabel: "Extracting and ranking diligence issues\u2026",
    systemPrompt: `You are extracting diligence issues for the deal team. Read the documents. Produce a ranked issues list (not a per-document table). Group by category \u2014 Corporate, Contracts, IP, Employment, Litigation, Compliance. For each issue: Severity (High/Med/Low), the issue, the document(s) and section it arises from, deal impact, and recommended action (rep, indemnity, condition, price adjustment, or walk). Lead with the deal-breakers. Offer to export to Word.`
  },
  {
    id: "written-consent",
    area: "corporate",
    title: "Written Consent / Resolution",
    cta: "Draft a written consent",
    description: "Draft board or stockholder written consents / resolutions for corporate actions.",
    icon: "PenLine",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "write_docx"],
    intakeFields: [
      { key: "action", label: "What is being approved", type: "textarea", required: true, placeholder: "The corporate action(s) to authorize." },
      { key: "entity", label: "Entity", type: "text", placeholder: "Entity name & type" },
      { key: "body", label: "Approving body", type: "select", options: ["Board", "Stockholders", "Both"] }
    ],
    runningLabel: "Drafting the written consent\u2026",
    systemPrompt: `You are drafting a written consent in lieu of a meeting. Produce a send-ready document: title, entity & approving body, recitals (WHEREAS) establishing context, resolutions (RESOLVED) with operative language for each action, an omnibus "further actions" resolution, and a signature block with date lines. Match the requested action(s) precisely. Flag any approval that may require an actual meeting, a special vote, or stockholder (not just board) approval. Offer to export to Word.`
  },
  {
    id: "board-minutes",
    area: "corporate",
    title: "Board Minutes",
    cta: "Draft board minutes",
    description: "Draft formal minutes of a board meeting from an agenda or notes.",
    icon: "NotebookPen",
    outputType: "document",
    tools: ["read_file", "read_pdf", "read_docx", "write_docx"],
    intakeFields: [
      { key: "notes", label: "Agenda / notes", type: "textarea", required: true, placeholder: "Agenda items, what was discussed, decisions made." },
      { key: "entity", label: "Entity", type: "text" },
      { key: "date", label: "Meeting date", type: "date" }
    ],
    runningLabel: "Drafting the board minutes\u2026",
    systemPrompt: `You are drafting board meeting minutes. From the agenda/notes, produce proper minutes: header (entity, date, time, location/remote), attendance & quorum, call to order, approval of prior minutes, each agenda item with a neutral discussion summary and any resolutions adopted (with vote), and adjournment, ending with a secretary signature block. Record decisions and votes, not verbatim discussion. Flag any item that appears to need a formal resolution that was not clearly adopted. Offer to export to Word.`
  }
];
function workflowById(id) {
  return WORKFLOWS.find((w) => w.id === id);
}

// src/main/agent/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";

// src/main/secureKey.ts
import { app as app2, safeStorage } from "electron";
import { promises as fs2 } from "fs";
import { existsSync as existsSync2, readFileSync } from "fs";
import path2 from "path";
var keyFile = () => path2.join(app2.getPath("userData"), "anthropic.key");
function getBundledKey() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path2.join(process.resourcesPath, "bundled.key"));
  try {
    candidates.push(path2.join(app2.getAppPath(), "bundled.key"));
  } catch {
  }
  for (const f of candidates) {
    try {
      if (existsSync2(f)) {
        const v = readFileSync(f, "utf8").trim();
        if (v) return v;
      }
    } catch {
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  return null;
}
async function getUserKey() {
  const file = keyFile();
  if (!existsSync2(file)) return null;
  try {
    const buf = await fs2.readFile(file);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch {
        return buf.toString("utf8");
      }
    }
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
async function getApiKey() {
  return await getUserKey() ?? getBundledKey();
}

// src/main/agent/anthropic.ts
async function getClient() {
  const key = await getApiKey();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}
function buildAnthropicTools(tools, serverTools) {
  const arr = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }));
  for (const s of serverTools) {
    if (s === "web_search") arr.push({ type: "web_search_20250305", name: "web_search", max_uses: 6 });
  }
  return arr;
}
function createAnthropicProvider() {
  return {
    id: "anthropic",
    async runTurn(o) {
      const client = await getClient();
      if (!client) throw new Error("No Anthropic API key set. Add one in Settings.");
      const stream = client.messages.stream(
        {
          model: o.model,
          max_tokens: o.maxTokens,
          system: o.system,
          tools: buildAnthropicTools(o.tools, o.serverTools),
          messages: o.messages
        },
        { signal: o.signal }
      );
      stream.on("text", (d) => o.onText(d));
      const final = await stream.finalMessage();
      const toolUses = final.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
      return {
        assistantContent: final.content,
        toolUses,
        stopReason: final.stop_reason
      };
    },
    async complete(o) {
      const client = await getClient();
      if (!client) throw new Error("No Anthropic API key set.");
      const res = await client.messages.create({
        model: o.model,
        max_tokens: o.maxTokens ?? 1024,
        system: o.system,
        messages: [{ role: "user", content: o.prompt }]
      });
      const t = res.content.find((b) => b.type === "text");
      return t && "text" in t ? t.text : "";
    },
    async test() {
      const client = await getClient();
      if (!client) return { ok: false, error: "No API key set." };
      const { model } = await getSettings();
      try {
        await client.messages.create({ model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] });
        return { ok: true, model };
      } catch (e) {
        return { ok: false, error: e.message, model };
      }
    }
  };
}

// src/main/agent/ollama.ts
import http from "node:http";
import https from "node:https";
function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || "GET", headers: opts.headers },
      (res) => {
        const queue = [];
        const waiters = [];
        let ended = false;
        let errored = null;
        res.on("data", (c) => {
          const chunk = new Uint8Array(c);
          const w = waiters.shift();
          if (w) w({ done: false, value: chunk });
          else queue.push(chunk);
        });
        res.on("end", () => {
          ended = true;
          let w;
          while (w = waiters.shift()) w({ done: true });
        });
        res.on("error", (e) => {
          errored = e;
          let w;
          while (w = waiters.shift()) w({ done: true });
        });
        const reader = {
          read: () => {
            if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
            if (errored) return Promise.reject(errored);
            if (ended) return Promise.resolve({ done: true });
            return new Promise((r) => waiters.push(r));
          }
        };
        const collectText = async () => {
          let out = "";
          const td = new TextDecoder();
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            out += td.decode(value, { stream: true });
          }
          return out + td.decode();
        };
        resolve({
          ok: res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          body: { getReader: () => reader },
          text: collectText,
          json: async () => JSON.parse(await collectText())
        });
      }
    );
    req.setTimeout(0);
    req.on("error", reject);
    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy(new Error("aborted"));
        return;
      }
      opts.signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
    }
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
function blockText(content) {
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => "text" in b ? b.text : "").join("");
}
function toOllamaMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    const content = m.content;
    if (m.role === "user") {
      if (typeof content === "string") {
        out.push({ role: "user", content });
      } else {
        for (const b of content) {
          if (b.type === "tool_result") {
            const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
            out.push({ role: "tool", content: c });
          } else if (b.type === "text") {
            out.push({ role: "user", content: b.text });
          }
        }
      }
    } else {
      const blocks = typeof content === "string" ? [] : content;
      const text = blockText(content);
      const toolCalls = blocks.filter((b) => b.type === "tool_use").map((b) => ({
        function: {
          name: b.name,
          arguments: b.input ?? {}
        }
      }));
      const msg = { role: "assistant", content: typeof content === "string" ? content : text };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    }
  }
  return out;
}
function toOllamaTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }));
}
function createOllamaProvider(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    id: "ollama",
    async runTurn(o) {
      const res = await request(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: o.signal,
        body: JSON.stringify({
          model: o.model,
          messages: toOllamaMessages(o.system, o.messages),
          tools: toOllamaTools(o.tools),
          stream: true,
          options: { num_predict: o.maxTokens }
        })
      });
      if (!res.ok || !res.body) {
        throw new Error(`Ollama error ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      const toolUses = [];
      let n = 0;
      const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let obj;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (obj.error) throw new Error(obj.error);
        const msg = obj.message;
        if (msg?.content) {
          text += msg.content;
          o.onText(msg.content);
        }
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            n += 1;
            const args = tc.function.arguments;
            const input = typeof args === "string" ? (() => {
              try {
                return JSON.parse(args);
              } catch {
                return {};
              }
            })() : args ?? {};
            toolUses.push({ id: `call_${Date.now()}_${n}`, name: tc.function.name, input });
          }
        }
      };
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          handleLine(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
        }
      }
      if (buffer.trim()) handleLine(buffer);
      const assistantContent = [];
      if (text) assistantContent.push({ type: "text", text });
      for (const tu of toolUses) {
        assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      if (assistantContent.length === 0) assistantContent.push({ type: "text", text: "" });
      return {
        assistantContent,
        toolUses,
        stopReason: toolUses.length ? "tool_use" : "end_turn"
      };
    },
    async complete(o) {
      const res = await request(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: o.model,
          messages: [
            ...o.system ? [{ role: "system", content: o.system }] : [],
            { role: "user", content: o.prompt }
          ],
          stream: false,
          options: { num_predict: o.maxTokens ?? 1024 }
        })
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}`);
      const json = await res.json();
      return json.message?.content ?? "";
    },
    async listModels() {
      const res = await request(`${base}/api/tags`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.models ?? []).map((m) => m.name);
    },
    async test() {
      try {
        const res = await request(`${base}/api/tags`);
        if (!res.ok) return { ok: false, error: `Ollama responded ${res.status}` };
        const json = await res.json();
        const models = (json.models ?? []).map((m) => m.name);
        if (!models.length) {
          return { ok: false, error: 'Ollama is running but has no models. Run e.g. "ollama pull llama3.1".' };
        }
        return { ok: true, model: models[0] };
      } catch {
        return {
          ok: false,
          error: `Can't reach Ollama at ${base}. Install it from ollama.com, start it, then run "ollama pull llama3.1".`
        };
      }
    }
  };
}

// src/main/agent/provider.ts
function getProvider(settings) {
  if (settings.provider === "ollama") {
    return createOllamaProvider(settings.ollamaBaseUrl || "http://127.0.0.1:11434");
  }
  return createAnthropicProvider();
}
function activeModel(settings) {
  return settings.provider === "ollama" ? settings.ollamaModel : settings.model;
}

// src/main/agent/systemPrompts.ts
var BASE = `You are DeepSolve Legal, an AI legal assistant embedded in a native desktop app with access to the user's computer through tools.

Operating principles:
- You assist legal professionals. Be precise, cite sources, and never invent facts, clauses, citations, or quotations. If something is not in the provided material, say so.
- You produce real work product. Your main text response IS the deliverable shown to the user in a document pane \u2014 write it cleanly in Markdown, ready to use. Do not narrate your tool use in the deliverable; just produce the work.
- Read every attached or referenced document fully (using the file tools) before drafting.
- Use the dedicated tools: read_pdf / read_docx / read_xlsx for those file types, read_file for plain text.
- When you offer to export, the user can click an Export button \u2014 you do not need to write the file unless they ask. If they ask to save, use write_docx / write_xlsx.
- This is drafting assistance, not legal advice to an end client. Flag anything that needs licensed-attorney review or sign-off.`;
function buildSystemPrompt(workflow, settings, intakeSummary) {
  const profile = settings.profile?.trim() ? `

## The user's practice profile
Apply this throughout (house style, escalation rules, preferences):
${settings.profile.trim()}` : "";
  return `${BASE}

## Current task: ${workflow.title}
${workflow.systemPrompt}

## Intake provided by the user
${intakeSummary}${profile}`;
}

// src/main/tools/filesystem.ts
import { promises as fs3 } from "fs";
import { existsSync as existsSync3 } from "fs";
import path4 from "path";

// src/main/tools/types.ts
import path3 from "path";
function resolvePath(ctx, p) {
  if (!p) return ctx.filesDir;
  return path3.isAbsolute(p) ? p : path3.join(ctx.filesDir, p);
}
function str(args, key, fallback = "") {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

// src/main/tools/filesystem.ts
var MAX_READ = 4e5;
var listDir = {
  name: "list_dir",
  description: "List files and folders in a directory. Relative paths resolve inside the matter workspace; absolute paths access the full computer.",
  needsPermission: false,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path (relative or absolute)." } },
    required: ["path"]
  },
  async run(args, ctx) {
    const dir = resolvePath(ctx, str(args, "path", "."));
    if (!existsSync3(dir)) return { summary: `No such dir: ${dir}`, content: "Directory does not exist.", isError: true };
    const entries = await fs3.readdir(dir, { withFileTypes: true });
    const lines = entries.map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`);
    return { summary: `Listed ${entries.length} items in ${path4.basename(dir)}`, content: lines.join("\n") || "(empty)" };
  }
};
var readFile = {
  name: "read_file",
  description: "Read a UTF-8 text file (e.g. .txt, .md, .csv, source code). For PDF/Word/Excel use the dedicated tools.",
  needsPermission: false,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"]
  },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, "path"));
    if (!existsSync3(file)) return { summary: `Not found: ${file}`, content: "File does not exist.", isError: true };
    let text = await fs3.readFile(file, "utf8");
    let note = "";
    if (text.length > MAX_READ) {
      text = text.slice(0, MAX_READ);
      note = `

[...truncated at ${MAX_READ} chars]`;
    }
    return { summary: `Read ${path4.basename(file)}`, content: text + note };
  }
};
var searchFiles = {
  name: "search_files",
  description: "Search file names and text contents under a directory for a query string. Useful for finding a document in the workspace.",
  needsPermission: false,
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "Directory to search (defaults to the matter workspace)." },
      query: { type: "string" }
    },
    required: ["query"]
  },
  async run(args, ctx) {
    const root = resolvePath(ctx, str(args, "dir", "."));
    const query = str(args, "query").toLowerCase();
    const hits = [];
    async function walk(dir, depth) {
      if (depth > 4 || hits.length > 50) return;
      let entries;
      try {
        entries = await fs3.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path4.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          await walk(full, depth + 1);
        } else {
          if (e.name.toLowerCase().includes(query)) hits.push(`${full} (filename match)`);
          else if (/\.(txt|md|csv|json|log)$/i.test(e.name)) {
            try {
              const content = await fs3.readFile(full, "utf8");
              if (content.toLowerCase().includes(query)) hits.push(`${full} (content match)`);
            } catch {
            }
          }
        }
      }
    }
    await walk(root, 0);
    return {
      summary: `Found ${hits.length} match(es) for "${query}"`,
      content: hits.length ? hits.join("\n") : "No matches found."
    };
  }
};
var writeFile = {
  name: "write_file",
  description: "Write a UTF-8 text file. Relative paths save into the matter workspace. Prompts the user before writing.",
  needsPermission: true,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"]
  },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, "path"));
    const content = str(args, "content");
    const ok = await ctx.requestPermission("Write file", `Save ${content.length} chars to:
${file}`);
    if (!ok) return { summary: "Write denied", content: "User denied the write.", isError: true };
    await fs3.mkdir(path4.dirname(file), { recursive: true });
    await fs3.writeFile(file, content, "utf8");
    return { summary: `Wrote ${path4.basename(file)}`, content: `Saved to ${file}` };
  }
};

// src/main/tools/office.ts
import { promises as fs5 } from "fs";
import { existsSync as existsSync4 } from "fs";
import path5 from "path";

// src/main/export/convert.ts
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
function parseInlineRuns(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return new TextRun({ text: p.slice(2, -2), bold: true });
    }
    return new TextRun(p);
  });
}
function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function isTableDivider(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}
function firstMarkdownTable(markdown) {
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes("|") && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && !isTableDivider(lines[j])) {
        if (lines[j].trim()) rows.push(splitTableRow(lines[j]));
        j++;
      }
      return { header, rows };
    }
  }
  return null;
}
function stripMd(text) {
  return text.replace(/\*\*/g, "").replace(/^#+\s*/, "").replace(/^>\s?/, "").replace(/^[-*]\s+/, "\u2022 ");
}
async function markdownToDocx(markdown, title) {
  const children = [];
  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  }
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && !isTableDivider(lines[j])) {
        if (lines[j].trim()) rows.push(splitTableRow(lines[j]));
        j++;
      }
      const tableRows = [header, ...rows].map(
        (cells, idx) => new TableRow({
          children: cells.map(
            (c) => new TableCell({
              width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: stripMd(c), bold: idx === 0 })] })]
            })
          )
        })
      );
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
      i = j - 1;
      continue;
    }
    if (!trimmed) {
      children.push(new Paragraph(""));
    } else if (trimmed.startsWith("### ")) {
      children.push(new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (trimmed.startsWith("## ")) {
      children.push(new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (trimmed.startsWith("# ")) {
      children.push(new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (trimmed.startsWith("> ")) {
      children.push(
        new Paragraph({ children: parseInlineRuns(trimmed.slice(2)), indent: { left: 480 }, spacing: { before: 60 } })
      );
    } else if (/^[-*]\s+/.test(trimmed)) {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed.replace(/^[-*]\s+/, "")), bullet: { level: 0 } }));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed.replace(/^\d+\.\s+/, "")), numbering: void 0, bullet: { level: 0 } }));
    } else {
      children.push(new Paragraph({ children: parseInlineRuns(trimmed) }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
async function markdownToXlsx(markdown, sheetName = "Sheet1") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  const table = firstMarkdownTable(markdown);
  if (table) {
    ws.addRow(table.header.map(stripMd));
    ws.getRow(1).font = { bold: true };
    for (const row of table.rows) ws.addRow(row.map(stripMd));
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        max = Math.max(max, String(cell.value ?? "").length + 2);
      });
      col.width = Math.min(max, 60);
    });
  } else {
    for (const line of markdown.split("\n")) ws.addRow([stripMd(line)]);
    ws.getColumn(1).width = 100;
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// src/main/library/extract.ts
import { promises as fs4 } from "fs";
import mammoth from "mammoth";
import ExcelJS2 from "exceljs";
async function extractPdfText(filePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs4.readFile(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it && typeof it === "object" && "str" in it ? it.str : "").join(" ");
    pages.push(`--- Page ${i} ---
${text}`);
  }
  return pages.join("\n\n");
}
async function extractDocxText(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value;
}
async function extractXlsxText(filePath) {
  const wb = new ExcelJS2.Workbook();
  await wb.xlsx.readFile(filePath);
  const out = [];
  wb.eachSheet((ws) => {
    out.push(`# Sheet: ${ws.name}`);
    ws.eachRow((row) => {
      const vals = row.values.slice(1).map((v) => v == null ? "" : String(v));
      out.push(vals.join("	"));
    });
    out.push("");
  });
  return out.join("\n");
}

// src/main/tools/office.ts
var readPdf = {
  name: "read_pdf",
  description: "Extract the text of a PDF file, page by page. Use this for any .pdf document.",
  needsPermission: false,
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, "path"));
    if (!existsSync4(file)) return { summary: `Not found: ${file}`, content: "File does not exist.", isError: true };
    try {
      const text = await extractPdfText(file);
      return { summary: `Read PDF ${path5.basename(file)}`, content: text || "(no extractable text \u2014 may be scanned)" };
    } catch (e) {
      return { summary: `PDF read failed`, content: `Could not read PDF: ${e.message}`, isError: true };
    }
  }
};
var readDocx = {
  name: "read_docx",
  description: "Extract the text of a Microsoft Word (.docx) file.",
  needsPermission: false,
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, "path"));
    if (!existsSync4(file)) return { summary: `Not found: ${file}`, content: "File does not exist.", isError: true };
    try {
      const value = await extractDocxText(file);
      return { summary: `Read Word doc ${path5.basename(file)}`, content: value || "(empty document)" };
    } catch (e) {
      return { summary: `Word read failed`, content: `Could not read .docx: ${e.message}`, isError: true };
    }
  }
};
var readXlsx = {
  name: "read_xlsx",
  description: "Read a Microsoft Excel (.xlsx) file and return its sheets as text tables.",
  needsPermission: false,
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, "path"));
    if (!existsSync4(file)) return { summary: `Not found: ${file}`, content: "File does not exist.", isError: true };
    try {
      const content = await extractXlsxText(file);
      return { summary: `Read Excel ${path5.basename(file)}`, content };
    } catch (e) {
      return { summary: `Excel read failed`, content: `Could not read .xlsx: ${e.message}`, isError: true };
    }
  }
};
var writeDocx = {
  name: "write_docx",
  description: "Generate a Microsoft Word (.docx) document from Markdown content (headings, bullets, blockquotes, and tables are supported). Prompts the user before writing.",
  needsPermission: true,
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: 'File name, e.g. "Contract Review.docx".' },
      title: { type: "string", description: "Optional document title." },
      markdown: { type: "string", description: "The document body as Markdown." }
    },
    required: ["filename", "markdown"]
  },
  async run(args, ctx) {
    let filename = str(args, "filename", "document.docx");
    if (!filename.toLowerCase().endsWith(".docx")) filename += ".docx";
    const file = resolvePath(ctx, filename);
    const ok = await ctx.requestPermission("Create Word document", `Generate:
${file}`);
    if (!ok) return { summary: "Write denied", content: "User denied the write.", isError: true };
    const buf = await markdownToDocx(str(args, "markdown"), str(args, "title") || void 0);
    await fs5.mkdir(path5.dirname(file), { recursive: true });
    await fs5.writeFile(file, buf);
    return { summary: `Wrote ${path5.basename(file)}`, content: `Word document saved to ${file}` };
  }
};
var writeXlsx = {
  name: "write_xlsx",
  description: "Generate a Microsoft Excel (.xlsx) file from a Markdown table. Prompts the user before writing.",
  needsPermission: true,
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: 'File name, e.g. "Diligence.xlsx".' },
      sheet_name: { type: "string" },
      markdown_table: { type: "string", description: "A Markdown table to write as the sheet." }
    },
    required: ["filename", "markdown_table"]
  },
  async run(args, ctx) {
    let filename = str(args, "filename", "data.xlsx");
    if (!filename.toLowerCase().endsWith(".xlsx")) filename += ".xlsx";
    const file = resolvePath(ctx, filename);
    const ok = await ctx.requestPermission("Create Excel file", `Generate:
${file}`);
    if (!ok) return { summary: "Write denied", content: "User denied the write.", isError: true };
    const buf = await markdownToXlsx(str(args, "markdown_table"), str(args, "sheet_name", "Sheet1"));
    await fs5.mkdir(path5.dirname(file), { recursive: true });
    await fs5.writeFile(file, buf);
    return { summary: `Wrote ${path5.basename(file)}`, content: `Excel file saved to ${file}` };
  }
};

// src/main/tools/web.ts
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}
var fetchUrl = {
  name: "fetch_url",
  description: "Fetch a specific URL and return its readable text content. Use for reading a known page (statute, regulation, article).",
  needsPermission: false,
  inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  async run(args) {
    const url = str(args, "url");
    try {
      const res = await fetch(url, { headers: { "User-Agent": "DeepSolveLegal/0.1" } });
      if (!res.ok) return { summary: `HTTP ${res.status} for ${url}`, content: `Request failed: ${res.status} ${res.statusText}`, isError: true };
      const ct = res.headers.get("content-type") || "";
      const body = await res.text();
      const text = ct.includes("html") ? htmlToText(body) : body;
      const clipped = text.slice(0, 12e4);
      return { summary: `Fetched ${new URL(url).hostname}`, content: clipped };
    } catch (e) {
      return { summary: "Fetch failed", content: `Could not fetch URL: ${e.message}`, isError: true };
    }
  }
};

// src/main/tools/shell.ts
import { exec } from "child_process";
import { promisify } from "util";
var execAsync = promisify(exec);
var runCommand = {
  name: "run_command",
  description: "Run a shell command on the user's Windows machine (e.g. open a folder in Explorer, launch an app, run a script). High-impact \u2014 always asks the user for approval first.",
  needsPermission: true,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line to execute." },
      cwd: { type: "string", description: "Optional working directory." }
    },
    required: ["command"]
  },
  async run(args, ctx) {
    const command = str(args, "command");
    const cwd = args.cwd ? resolvePath(ctx, str(args, "cwd")) : ctx.filesDir;
    const ok = await ctx.requestPermission("Run command", `${command}

(in ${cwd})`);
    if (!ok) return { summary: "Command denied", content: "User denied the command.", isError: true };
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 6e4, windowsHide: true, maxBuffer: 4e6 });
      const out = `${stdout || ""}${stderr ? `
[stderr]
${stderr}` : ""}`.slice(0, 6e4);
      return { summary: `Ran: ${command.slice(0, 48)}`, content: out || "(no output)" };
    } catch (e) {
      return { summary: `Command failed`, content: `Error: ${e.message}`, isError: true };
    }
  }
};

// src/main/library/lexical.ts
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "it",
  "as",
  "at",
  "by",
  "with",
  "from",
  "we",
  "you",
  "i",
  "he",
  "she"
]);
function tokenize(text) {
  const out = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 2 && raw.length <= 40 && !STOPWORDS.has(raw)) out.push(raw);
  }
  return out;
}
function createIndex() {
  return { postings: {}, docLen: {}, snippets: {} };
}
function makeSnippet(text, queryTerms) {
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of queryTerms) {
    const p = lower.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  const start = pos < 0 ? 0 : Math.max(0, pos - 60);
  const snip = text.slice(start, start + 220).replace(/\s+/g, " ").trim();
  return (start > 0 ? "\u2026" : "") + snip + (text.length > start + 220 ? "\u2026" : "");
}
function search(idx, query, k = 50) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const docIds = Object.keys(idx.docLen);
  const N = docIds.length;
  if (!N) return [];
  const avgdl = docIds.reduce((s, id) => s + idx.docLen[id], 0) / N;
  const k1 = 1.5;
  const b = 0.75;
  const scores = /* @__PURE__ */ new Map();
  for (const term of new Set(terms)) {
    const posting = idx.postings[term];
    if (!posting) continue;
    const df = posting.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (const [docId, tf] of posting) {
      const dl = idx.docLen[docId] || 1;
      const denom = tf + k1 * (1 - b + b * (dl / avgdl));
      const add = idf * (tf * (k1 + 1) / denom);
      scores.set(docId, (scores.get(docId) ?? 0) + add);
    }
  }
  return [...scores.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, k).map(([docId, score]) => ({ docId, score, snippet: makeSnippet(idx.snippets[docId] || "", terms) }));
}

// src/main/library/store.ts
import { app as app3 } from "electron";
import { promises as fs6 } from "fs";
import { existsSync as existsSync5 } from "fs";
import path6 from "path";
var libraryDir = () => path6.join(app3.getPath("userData"), "library");
var collPath = (id) => path6.join(libraryDir(), id);
async function readJson2(file, fallback) {
  try {
    return JSON.parse(await fs6.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function listCollections() {
  const dir = libraryDir();
  if (!existsSync5(dir)) return [];
  const ids = await fs6.readdir(dir);
  const out = [];
  for (const id of ids) {
    const f = path6.join(dir, id, "collection.json");
    if (existsSync5(f)) {
      try {
        out.push(JSON.parse(await fs6.readFile(f, "utf8")));
      } catch {
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function getDocs(id) {
  return readJson2(path6.join(collPath(id), "docs.json"), []);
}
async function getLexical(id) {
  return readJson2(path6.join(collPath(id), "lexical.json"), createIndex());
}

// src/main/library/search.ts
async function searchCollection(id, query, k = 50) {
  const [docs, lex] = await Promise.all([getDocs(id), getLexical(id)]);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const hits = [];
  for (const h of search(lex, query, k)) {
    const doc = byId.get(h.docId);
    if (doc) hits.push({ doc, score: h.score, snippet: h.snippet });
  }
  return hits;
}
async function searchLibrary(query, k = 20, scope) {
  const collections = await listCollections();
  const targets = scope ? collections.filter((c) => c.id === scope || c.name.toLowerCase() === scope.toLowerCase()) : collections;
  const all = [];
  for (const c of targets) {
    const hits = await searchCollection(c.id, query, k);
    for (const h of hits) all.push({ ...h, collection: c.name });
  }
  return all.sort((a, b) => b.score - a.score).slice(0, k);
}

// src/main/tools/library.ts
var searchLibraryTool = {
  name: "search_library",
  description: "Search the user's indexed document Library (collections of emails, contracts, and other documents) for relevant material by keyword. Returns the top matching documents with their file path, key metadata, and a snippet. Use this to find precedents, prior correspondence, or related documents instead of asking the user to attach them.",
  needsPermission: false,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords or phrase to search for." },
      collection: { type: "string", description: "Optional: limit to a collection by name or id." },
      limit: { type: "number", description: "Max results (default 10)." }
    },
    required: ["query"]
  },
  async run(args) {
    const query = str(args, "query");
    const scope = args.collection ? str(args, "collection") : void 0;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 30) : 10;
    const hits = await searchLibrary(query, limit, scope);
    if (!hits.length) {
      return { summary: `No library matches for "${query}"`, content: "No matching documents found in the Library." };
    }
    const lines = hits.map((h, i) => {
      const d = h.doc;
      const meta = d.kind === "email" ? `${d.date || ""} | From: ${d.from || "?"} | To: ${d.to || "?"} | Subject: ${d.subject || d.name}` : `${d.docType || d.ext} | ${d.title || d.name}`;
      return `${i + 1}. [${h.collection}] ${meta}
   Path: ${d.path}
   ${d.summary ? d.summary + "\n   " : ""}\u2026${h.snippet}\u2026`;
    });
    return { summary: `Found ${hits.length} match(es) for "${query}"`, content: lines.join("\n\n") };
  }
};

// src/main/tools/registry.ts
var LOCAL_TOOLS = {
  list_dir: listDir,
  read_file: readFile,
  search_files: searchFiles,
  write_file: writeFile,
  read_pdf: readPdf,
  read_docx: readDocx,
  read_xlsx: readXlsx,
  write_docx: writeDocx,
  write_xlsx: writeXlsx,
  fetch_url: fetchUrl,
  run_command: runCommand,
  search_library: searchLibraryTool
};
var SERVER_TOOLS = /* @__PURE__ */ new Set(["web_search"]);
function buildTools(allowed) {
  const names = /* @__PURE__ */ new Set([...allowed, "list_dir", "read_file", "search_files", "search_library"]);
  const tools = [];
  const local = {};
  const serverTools = [];
  for (const name of names) {
    if (SERVER_TOOLS.has(name)) {
      serverTools.push(name);
      continue;
    }
    const def = LOCAL_TOOLS[name];
    if (!def) continue;
    local[name] = def;
    tools.push({ name: def.name, description: def.description, inputSchema: def.inputSchema });
  }
  return { tools, local, serverTools };
}

// src/main/permissions.ts
var pending = /* @__PURE__ */ new Map();
var alwaysAllowed = /* @__PURE__ */ new Set();
var counter = 0;
function nextId() {
  counter += 1;
  return `perm_${Date.now()}_${counter}`;
}
async function requestPermission(ask) {
  if (alwaysAllowed.has(ask.tool)) return true;
  const requestId = nextId();
  const decision = await new Promise((resolve) => {
    pending.set(requestId, { resolve });
    ask.emit({
      type: "permission-request",
      matterId: ask.matterId,
      requestId,
      tool: ask.tool,
      title: ask.title,
      detail: ask.detail
    });
  });
  if (decision === "allow-always") {
    alwaysAllowed.add(ask.tool);
    return true;
  }
  return decision === "allow";
}
function resolvePermission(requestId, decision) {
  const p = pending.get(requestId);
  if (p) {
    pending.delete(requestId);
    p.resolve(decision);
  }
}

// src/main/agent/runAgent.ts
var MAX_ITERATIONS = 16;
var active = /* @__PURE__ */ new Map();
var idCounter = 0;
function uid(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}
function summarizeIntake(intakeFields, intake, copied) {
  const lines = [];
  for (const f of intakeFields) {
    if (f.key === "files") continue;
    const v = intake[f.key];
    if (v != null && String(v).trim()) lines.push(`- ${f.label}: ${String(v)}`);
  }
  if (copied.length) {
    lines.push(`- Attached documents (in the matter workspace): ${copied.map((p) => path7.basename(p)).join(", ")}`);
  }
  return lines.join("\n") || "(no additional details provided)";
}
async function importFiles(matterId, files) {
  const dir = matterFilesDir(matterId);
  await fs7.mkdir(dir, { recursive: true });
  const out = [];
  for (const src of files) {
    if (!existsSync6(src)) continue;
    const dest = path7.join(dir, path7.basename(src));
    try {
      await fs7.copyFile(src, dest);
      out.push(dest);
    } catch {
      out.push(src);
    }
  }
  return out;
}
async function startThread(input, emit) {
  const workflow = workflowById(input.workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${input.workflowId}`);
  const matterId = uid("matter");
  const counterparty = input.intake.counterparty || input.intake.recipient || input.intake.deponent || "";
  const title = `${workflow.title}${counterparty ? ` \u2014 ${counterparty}` : ""}`;
  await createMatter({
    id: matterId,
    title,
    workflowId: workflow.id,
    area: workflow.area,
    outputType: workflow.outputType,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  const copied = await importFiles(matterId, input.files);
  const intakeSummary = summarizeIntake(workflow.intakeFields, input.intake, copied);
  const userText = `Please complete this task.

${intakeSummary}`;
  await appendMessage(matterId, { id: uid("msg"), role: "user", text: userText, createdAt: Date.now() });
  await setApiMessages(matterId, [{ role: "user", content: userText }]);
  void runTurn(matterId, emit);
  return { matterId };
}
async function runTurn(matterId, emit) {
  const run = { cancelled: false };
  active.set(matterId, run);
  try {
    const settings = await getSettings();
    const provider = getProvider(settings);
    const model = activeModel(settings);
    if (!model) {
      emit({
        type: "error",
        matterId,
        message: settings.provider === "ollama" ? "No local model selected. Pick an Ollama model in Settings." : "No model selected. Choose a model in Settings."
      });
      emit({ type: "done", matterId });
      return;
    }
    const detail = await getMatter(matterId);
    const workflow = detail ? workflowById(detail.workflowId) : void 0;
    if (!workflow) {
      emit({ type: "error", matterId, message: "Workflow not found for this matter." });
      emit({ type: "done", matterId });
      return;
    }
    const { tools, local, serverTools } = buildTools(workflow.tools);
    const system = buildSystemPrompt(workflow, settings, "(see the conversation)");
    const ctx = {
      matterId,
      filesDir: matterFilesDir(matterId),
      matterRoot: settings.matterRoot,
      requestPermission: (title, detailText) => requestPermission({
        matterId,
        tool: title,
        title,
        detail: detailText,
        emit
      })
    };
    const apiMessages = await getApiMessages(matterId);
    const messageId = uid("msg");
    emit({ type: "turn-start", matterId, messageId });
    await appendMessage(matterId, { id: messageId, role: "assistant", text: "", createdAt: Date.now() });
    let assembled = "";
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (run.cancelled) break;
      const controller = new AbortController();
      run.controller = controller;
      let turn;
      try {
        turn = await provider.runTurn({
          system,
          messages: apiMessages,
          tools,
          serverTools,
          model,
          maxTokens: 8e3,
          onText: (delta) => {
            assembled += delta;
            emit({ type: "text", matterId, messageId, delta });
          },
          signal: controller.signal
        });
      } catch (e) {
        if (run.cancelled) break;
        emit({ type: "error", matterId, message: e.message });
        break;
      }
      apiMessages.push({ role: "assistant", content: turn.assistantContent });
      await setApiMessages(matterId, apiMessages);
      await updateMessageText(matterId, messageId, assembled);
      const toolUses = turn.toolUses;
      if (turn.stopReason !== "tool_use" || toolUses.length === 0) {
        break;
      }
      const toolResults = [];
      for (const tu of toolUses) {
        if (run.cancelled) break;
        const def = local[tu.name];
        const activityId = uid("act");
        emit({ type: "tool-start", matterId, messageId, toolId: tu.id, name: tu.name, input: tu.input });
        await appendActivity(matterId, {
          id: activityId,
          name: tu.name,
          input: tu.input,
          startedAt: Date.now()
        });
        if (!def) {
          await finishActivity(matterId, activityId, false, "Unknown tool");
          emit({ type: "tool-end", matterId, toolId: tu.id, ok: false, summary: "Unknown tool" });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Unknown tool", is_error: true });
          continue;
        }
        try {
          const result = await def.run(tu.input, ctx);
          await finishActivity(matterId, activityId, !result.isError, result.summary);
          emit({ type: "tool-end", matterId, toolId: tu.id, ok: !result.isError, summary: result.summary });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result.content,
            is_error: result.isError
          });
        } catch (e) {
          const msg = e.message;
          await finishActivity(matterId, activityId, false, msg);
          emit({ type: "tool-end", matterId, toolId: tu.id, ok: false, summary: msg });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${msg}`, is_error: true });
        }
      }
      if (run.cancelled) break;
      apiMessages.push({ role: "user", content: toolResults });
      await setApiMessages(matterId, apiMessages);
    }
    await updateMessageText(matterId, messageId, assembled);
    emit({ type: "turn-end", matterId, messageId });
  } catch (e) {
    emit({ type: "error", matterId, message: e.message });
  } finally {
    active.delete(matterId);
    emit({ type: "done", matterId });
  }
}

// scripts/app-e2e.ts
var log = (...a) => process.stdout.write(a.join(" ") + "\n");
async function main() {
  const tmp = path8.join(os.tmpdir(), "dsl-app-e2e-" + process.pid);
  app4.setPath("userData", tmp);
  await app4.whenReady();
  await setSettings({ provider: "ollama", ollamaModel: "llama3.2:3b" });
  const s = await getSettings();
  log("settings.provider =", s.provider, "| ollamaModel =", s.ollamaModel);
  log("typeof global fetch =", typeof fetch);
  try {
    const pf = await fetch("http://127.0.0.1:11434/api/tags");
    log("preflight GET /api/tags ->", pf.status);
  } catch (e) {
    const err = e;
    log("preflight GET FAILED:", err.message, "| cause:", String(err.cause?.message ?? err.cause));
  }
  try {
    const ac = new AbortController();
    const pf = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({ model: "llama3.2:3b", messages: [{ role: "user", content: "hi" }], stream: true, options: { num_predict: 1 } })
    });
    log("preflight POST /api/chat ->", pf.status, "| has body:", !!pf.body);
    const reader = pf.body.getReader();
    let chunks = 0;
    for (; ; ) {
      const { done: done2 } = await reader.read();
      if (done2) break;
      chunks++;
    }
    log("preflight POST streamed chunks:", chunks);
  } catch (e) {
    const err = e;
    log("preflight POST FAILED:", err.message, "| cause:", String(err.cause?.message ?? JSON.stringify(err.cause)));
  }
  try {
    const ac = new AbortController();
    const pf = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "List the workspace files." }],
        tools: [
          { type: "function", function: { name: "list_dir", description: "List a directory", parameters: { type: "object", properties: { path: { type: "string" } } } } }
        ],
        stream: true,
        options: { num_predict: 256 }
      })
    });
    log("preflight POST+tools ->", pf.status);
    const reader = pf.body.getReader();
    let chunks = 0;
    for (; ; ) {
      const { done: done2 } = await reader.read();
      if (done2) break;
      chunks++;
    }
    log("preflight POST+tools streamed chunks:", chunks);
  } catch (e) {
    const err = e;
    log("preflight POST+tools FAILED:", err.message, "| cause:", String(err.cause?.message ?? JSON.stringify(err.cause)));
  }
  let text = "";
  const eventLog = [];
  let matterId = "";
  const done = new Promise((resolve) => {
    const emit = (e) => {
      switch (e.type) {
        case "turn-start":
          eventLog.push("turn-start");
          break;
        case "text":
          text += e.delta;
          break;
        case "tool-start":
          eventLog.push("tool-start:" + e.name);
          break;
        case "tool-end":
          eventLog.push("tool-end:" + (e.ok ? "ok" : "fail"));
          break;
        case "permission-request":
          eventLog.push("permission-request:" + e.tool + " -> auto-allow");
          resolvePermission(e.requestId, "allow");
          break;
        case "error":
          eventLog.push("ERROR:" + e.message);
          resolve();
          break;
        case "done":
          eventLog.push("done");
          resolve();
          break;
      }
    };
    void startThread(
      {
        workflowId: "demand-draft",
        intake: {
          recipient: "Apex Industrial Supply, Inc.",
          facts: "On 2026-03-01 Apex agreed to deliver 500 steel brackets by 2026-04-15 for $42,000 (PO #DS-1188). Nothing was delivered and Apex has not responded to three follow-ups. We demand delivery or a full refund within 14 days."
        },
        files: []
      },
      emit
    ).then((r) => {
      matterId = r.matterId;
      log("startThread -> matterId =", matterId);
    });
  });
  await done;
  const detail = matterId ? await getMatter(matterId) : null;
  const persisted = detail?.messages.find((m) => m.role === "assistant")?.text ?? "";
  log("\n==== EVENTS ====");
  log(eventLog.join("  \xB7  "));
  log("\n==== DELIVERABLE (streamed, " + text.length + " chars) ====");
  log(text.trim().slice(0, 1400));
  log("\n==== PERSISTED TO MATTER (" + persisted.length + " chars) ====");
  log(persisted.length ? "OK \u2014 assistant message saved to thread.json" : "MISSING");
  const ok = s.provider === "ollama" && eventLog.includes("done") && text.trim().length > 100 && persisted.length > 100 && !eventLog.some((x) => x.startsWith("ERROR"));
  log("\n==== RESULT: " + (ok ? "PASS" : "FAIL") + " ====");
  await fs8.rm(tmp, { recursive: true, force: true }).catch(() => {
  });
  app4.exit(ok ? 0 : 1);
}
void main();
