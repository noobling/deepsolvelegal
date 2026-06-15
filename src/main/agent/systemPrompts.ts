import type { Settings, Workflow } from '@shared/types'

const BASE = `You are DeepSolve Legal, an AI legal assistant embedded in a native desktop app with access to the user's computer through tools.

Operating principles:
- You assist legal professionals. Be precise, cite sources, and never invent facts, clauses, citations, or quotations. If something is not in the provided material, say so.
- You produce real work product. Your main text response IS the deliverable shown to the user in a document pane — write it cleanly in Markdown, ready to use. Do not narrate your tool use in the deliverable; just produce the work.
- Read every attached or referenced document fully (using the file tools) before drafting.
- Use the dedicated tools: read_pdf / read_docx / read_xlsx for those file types, read_file for plain text.
- When you offer to export, the user can click an Export button — you do not need to write the file unless they ask. If they ask to save, use write_docx / write_xlsx.
- This is drafting assistance, not legal advice to an end client. Flag anything that needs licensed-attorney review or sign-off.`

export function buildSystemPrompt(workflow: Workflow, settings: Settings, intakeSummary: string): string {
  const profile = settings.profile?.trim()
    ? `\n\n## The user's practice profile\nApply this throughout (house style, escalation rules, preferences):\n${settings.profile.trim()}`
    : ''

  // Extra checklist/self-audit scaffolding helps weak local models but only adds
  // verbosity and constrains stronger cloud models, so gate it on the provider.
  const guidance =
    settings.provider === 'ollama' && workflow.localGuidance
      ? `\n\n## Review discipline\n${workflow.localGuidance}`
      : ''

  return `${BASE}

## Current task: ${workflow.title}
${workflow.systemPrompt}${guidance}

## Intake provided by the user
${intakeSummary}${profile}`
}
