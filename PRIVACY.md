# Quantum Law Group — Data Handling & Privacy

This document describes, accurately and without overstatement, how Quantum Law Group handles
data. It is intended for review by a law firm's IT, risk, or general-counsel function.

## TL;DR

- **Local-first.** Your matters, the documents you work on, drafts, settings, and the document
  Library index live **only on the user's computer**. Quantum Law Group operates **no server or cloud**
  and never receives your data. There is **no analytics or telemetry** in the app.
- **One external service: Anthropic.** To generate analysis and drafts, the text of the task you
  run — your instructions plus the documents you attach or have the assistant read for that task —
  is transmitted over an encrypted (TLS) connection to **Anthropic's API**. This is inherent to
  how the AI works; that content does leave the machine.
- **The key confidentiality decision** for a firm is therefore: *are you comfortable with that
  task content being processed by Anthropic under their commercial terms?* The protections below
  are what make that defensible; the firm should review and execute Anthropic's terms.

## Where data is stored

| Data | Location | Leaves the machine? |
|---|---|---|
| Matters, threads, drafts | `%APPDATA%\quantumlawgroup\matters\` (local JSON) | No |
| Settings & practice profile | `%APPDATA%\quantumlawgroup\settings.json` | No |
| Document Library index (BM25) | `%APPDATA%\quantumlawgroup\library\` (local JSON) | No |
| Anthropic API key (user-entered) | `%APPDATA%\quantumlawgroup\anthropic.key`, encrypted with Windows **DPAPI** | No |
| Exported Word/PDF/Excel | The folder you choose in Settings | No |

There is no Quantum Law Group backend. Uninstalling and deleting `%APPDATA%\quantumlawgroup` removes all
local data.

## What is sent to Anthropic, and when

Data is sent to `api.anthropic.com` **only when you run a workflow or chat**, and consists of:

- your instructions / prompt for that task;
- the **extracted text of documents** you attach in the intake, or that the assistant reads from
  disk to complete the task;
- results of the web-search / URL-fetch tools, **only if** the workflow uses them.

Under **Anthropic's Commercial Terms of Service**:

- API inputs and outputs are **not used to train Anthropic's models**.
- Anthropic retains limited data for trust-and-safety / abuse monitoring (a bounded retention
  window), and offers **Zero Data Retention (ZDR)** to eligible organizations on request.

> The firm should review and execute Anthropic's **Commercial Terms** and **Data Processing
> Addendum**, and apply for **Zero Data Retention** if its confidentiality obligations require it.
> See <https://www.anthropic.com/legal/commercial-terms> and Anthropic's Trust Center.

The **document Library index is built and stored locally**; indexing a folder does **not** send
anything to Anthropic — *unless* you enable the optional **"AI summaries"** toggle on a collection,
in which case a short excerpt of each document is sent to generate the summary.

## Security controls

- **Encryption at rest** for the user-entered API key (Windows DPAPI; tied to the Windows user
  account).
- **Encryption in transit** to Anthropic (TLS, via the official Anthropic SDK).
- **Permission gating:** every file *write* and every *shell command* prompts the user for
  explicit approval before it runs. File *reads* are allowed so the assistant can read the
  documents you point it at.
- **No background activity:** the app does nothing with your data unless you start a task.

## Honest caveats

- **Content is processed by Anthropic.** This is not a fully on-device/offline tool. The most
  sensitive privileged material should only be run through workflows if the firm is comfortable
  with Anthropic's processing terms (consider ZDR).
- **Bundled-key distribution (if used).** If the app is distributed with an embedded API key, that
  key is stored in the application package and is **extractable** by a technical user. This is a
  billing/key-abuse consideration, *not* a firm-document-confidentiality one. Mitigate with a
  **unique key per customer + a spend limit + rotation**, or move to a server-side proxy so the key
  never ships to clients.
- **Broad local file access.** The assistant can read files on the machine when you direct it to;
  writes and shell actions are gated by approval prompts.

## Recommendations for a law-firm deployment

1. Execute Anthropic's Commercial Terms + DPA; apply for **Zero Data Retention** if required.
2. Use a **dedicated Anthropic key per firm/customer**, each with a **monthly spend limit**.
3. Establish an internal policy on which matter types / sensitivity levels may be run through the
   tool, and obtain client consent where the engagement terms require it.
4. Keep the app and its bundled key out of any public code repository (already enforced via
   `.gitignore`).
