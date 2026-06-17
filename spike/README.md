# Word + .NET spike

Proof-of-concept: the Syncfusion Word editor backed by a .NET import service,
beside a lightweight chat redline harness. Answers two questions:

1. **Fidelity** — can a real `.docx` (tables, styles, numbering) be imported with
   full Word fidelity that our in-app `markdownToSfdt` can't reproduce?
2. **Redline-in-place** — can a chat instruction apply as a native tracked change
   on that high-fidelity document?

Both: **yes** (verified — table-cell and body-clause redlines as tracked changes).

## Why a .NET sidecar

Syncfusion's `.docx → SFDT` conversion ships only as a .NET library
(`Syncfusion.EJ2.WordEditor.AspNet.Core`). There is no Node/JS equivalent, so
true DOCX import requires this service. The in-app path (`src/renderer/src/lib/sfdt.ts`)
avoids it by generating SFDT from our Markdown, at the cost of fidelity.

## Run it

```bash
# 1. .NET 8 SDK (one-time; user-local, no sudo)
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir "$HOME/.dotnet"
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet"

# 2. Start the import service on :5111
cd spike/DocEditorServer
dotnet run --no-launch-profile --urls http://localhost:5111

# 3. In the app: sidebar → "Word + .NET spike"
#    (the renderer CSP allows connect-src http://localhost:5111)
```

The service exposes `POST /api/documenteditor/Import` (multipart `.docx` → SFDT).
The front end is `src/renderer/src/pages/DotnetWordSpike.tsx`; it imports the
bundled `public/msa-fidelity.docx` and applies redlines via the editor's
search/replace API with track changes on.

## Shipping caveats (not solved here)

- Bundling/spawning a .NET runtime alongside Electron (process mgmt, port,
  startup) — out of scope; this runs the service manually.
- Server-side Syncfusion also needs a license for production.
- The redline here is a deterministic `old => new` find/replace; production would
  drive it from the real `apply_redline` agent loop.
