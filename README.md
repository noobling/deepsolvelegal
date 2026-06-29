# Quantum Law Group

An action-first legal AI desktop app for Windows, powered by the Anthropic API. Instead of a blank chatbox, Quantum Law Group gives you a **launchpad of legal workflows** — pick an action ("Review a contract", "Draft a demand letter", "Respond to a DSAR", "Build a diligence table"), answer a short intake, and get a real, exportable work product. The feature set is modeled on Anthropic's [claude-for-legal](https://github.com/anthropics/claude-for-legal) plugin suite.

## What it does

- **Launchpad** of action cards grouped by practice area: Commercial/Contracts, Litigation, Privacy, Corporate/M&A.
- **Structured intake** per workflow (attach documents + a few fields) — a clear start, not an empty prompt.
- **Workspace** with a live **deliverable pane** (the drafted document or cited table) and an **activity rail** showing the agent's tool use and a follow-up chat for revisions.
- **Full computer access** through permissioned tools: read/write files, parse & generate Word/PDF/Excel, run shell commands, and search the web.
- **Export** any deliverable to Word, PDF, or Excel.
- Your **Anthropic API key** is stored encrypted on your PC (Windows DPAPI via Electron `safeStorage`) and only used to call the API.

## Architecture

Electron, two processes:

- **Main (Node):** the agent loop (`@anthropic-ai/sdk` streaming tool-use), the tool catalog, the permission broker, secure key storage, and JSON persistence of matters/threads. Everything privileged lives here.
- **Renderer (React + TypeScript + Tailwind):** pure UI, talking to main over a typed IPC bridge (`window.api`).

Workflows are **declarative configs** in `src/shared/workflows.ts` (title, intake fields, allowed tools, system prompt). Adding a new workflow is data, not code.

```
src/
  shared/      types.ts, workflows.ts        (IPC contract + workflow catalog)
  main/        index.ts, ipc.ts, secureKey.ts
    agent/     anthropic.ts, runAgent.ts, systemPrompts.ts
    tools/     filesystem, office, web, shell, registry
    export/    convert.ts  (Markdown → docx/pdf/xlsx)
    storage/   store.ts
  preload/     index.ts  (contextBridge → window.api)
  renderer/    React app (pages: Launchpad, Workspace, Settings)
```

## Tools available to the agent

| Tool | Gated? | Purpose |
|---|---|---|
| `list_dir`, `read_file`, `search_files` | no | Browse/read the workspace & disk |
| `read_pdf`, `read_docx`, `read_xlsx` | no | Extract text/tables from legal documents |
| `write_file`, `write_docx`, `write_xlsx` | yes | Save drafts and generate deliverables |
| `run_command` | yes (always) | Shell/automation on Windows |
| `web_search` | no | Anthropic server-side web search |
| `fetch_url` | no | Read a specific URL |

Gated tools prompt you with an Allow once / Always allow / Deny dialog.

## Getting started

```bash
npm install
npm run dev        # launches the app with hot reload
```

1. Open **Settings** and paste your Anthropic API key (get one at console.anthropic.com). Click **Test connection**.
2. Optionally set your **Export folder** and fill in a **Practice profile** (house style / escalation rules — injected into every workflow).
3. Back on **Workflows**, pick an action card, complete the intake, and **Start**.

## Build a distributable

```bash
npm run dist:win              # arm64 (this machine) → dist\Quantum-Law-Group-<ver>-win-arm64.zip
npm run dist:win -- x64       # Intel/AMD build
```

This compiles the app, packages a self-contained folder with `@electron/packager`, bundles the
per-user installer scripts, and zips it. End users either double-click **`Install Quantum Law Group.bat`**
(per-user install, no admin), run `install.ps1` from a terminal, or run the `.exe` portably — see
[installer/INSTALL.md](installer/INSTALL.md).

> We use `@electron/packager` + a per-user install script rather than a signed NSIS `.exe`: building the
> NSIS installer requires symlink-creation privilege (Windows Developer Mode / admin) that wasn't available
> on the build machine. On a machine with that enabled, `electron-builder --win` can produce a signed `.exe`.

## Notes

- Quantum Law Group produces **drafting assistance for legal professionals**, not legal advice to an end client. Outputs flag items needing licensed-attorney review.
- `run_command` is the highest-risk capability and always asks before running.
