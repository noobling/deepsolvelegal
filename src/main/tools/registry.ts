import type { ToolDef } from './types'
import type { ToolSpec } from '../agent/provider'
import { listDir, readFile, searchFiles, writeFile } from './filesystem'
import { readPdf, readDocx, readXlsx, writeDocx, writeXlsx, extractHighlights } from './office'
import { fetchUrl } from './web'
import { runCommand } from './shell'
import { searchLibraryTool } from './library'
import { lintDocumentTool } from './lint'
import { diffDocumentsTool } from './diff'
import { applyRedlineTool } from './redline'

// All locally-executed tools, by name.
export const LOCAL_TOOLS: Record<string, ToolDef> = {
  list_dir: listDir,
  read_file: readFile,
  search_files: searchFiles,
  write_file: writeFile,
  read_pdf: readPdf,
  read_docx: readDocx,
  read_xlsx: readXlsx,
  extract_highlights: extractHighlights,
  write_docx: writeDocx,
  write_xlsx: writeXlsx,
  fetch_url: fetchUrl,
  run_command: runCommand,
  search_library: searchLibraryTool,
  lint_document: lintDocumentTool,
  diff_documents: diffDocumentsTool,
  apply_redline: applyRedlineTool
}

// 'web_search' is a server-side Anthropic tool (executed by the API, not locally).
const SERVER_TOOLS = new Set(['web_search'])

export interface BuiltTools {
  /** Provider-neutral custom tool specs. */
  tools: ToolSpec[]
  /** Local dispatch map (name → executable tool). */
  local: Record<string, ToolDef>
  /** Server-side tool names (e.g. web_search) — only some providers support these. */
  serverTools: string[]
}

/**
 * Given a workflow's allowed tool names, produce provider-neutral tool specs,
 * the local dispatch map, and any server-side tool names. We always include the
 * core read tools (so the agent can navigate the workspace) and search_library
 * (so it can pull relevant documents from the indexed Library in any workflow).
 */
export function buildTools(allowed: string[]): BuiltTools {
  const names = new Set<string>([...allowed, 'list_dir', 'read_file', 'search_files', 'search_library'])
  const tools: ToolSpec[] = []
  const local: Record<string, ToolDef> = {}
  const serverTools: string[] = []

  for (const name of names) {
    if (SERVER_TOOLS.has(name)) {
      serverTools.push(name)
      continue
    }
    const def = LOCAL_TOOLS[name]
    if (!def) continue
    local[name] = def
    tools.push({ name: def.name, description: def.description, inputSchema: def.inputSchema })
  }

  return { tools, local, serverTools }
}
