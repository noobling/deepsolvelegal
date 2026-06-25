import { app, BrowserWindow, shell, dialog, protocol, net } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'
import { appendFileSync } from 'fs'

// electron-updater is CommonJS, but the bundled main process is ESM — a named ESM import
// (`import { autoUpdater }`) throws "Named export not found" at runtime. Load it through
// createRequire so the CJS module resolves correctly.
const { autoUpdater } = createRequire(import.meta.url)('electron-updater')

let mainWindow: BrowserWindow | null = null

// The production renderer drives a pool of offscreen BrowserWindows through printToPDF.
// On some GPUs that path wedges — the compositor floods "Invalid mailbox" GPU errors and
// printToPDF never resolves, hanging a whole run at 100% CPU. We don't need hardware
// compositing for a forms-and-PDF app, so force software compositing: it removes the GPU
// mailbox path entirely and makes offscreen rendering reliable. Must run before app ready.
app.disableHardwareAcceleration()

// A privileged scheme for previewing on-disk files (PDFs/images) inside the
// renderer. The native PDF viewer can't read renderer-created blob: URLs
// ("Not allowed to load local resource: blob:"), so we stream the file from
// disk through this protocol instead. Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dsfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }
])

function diag(msg: string): void {
  try {
    appendFileSync(path.join(app.getPath('userData'), 'diag.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (e) => diag(`uncaughtException: ${e.stack || e}`))
process.on('unhandledRejection', (e) => diag(`unhandledRejection: ${e}`))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'DeepSolve Legal',
    backgroundColor: '#0b0f1a',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Enable Chromium's built-in PDF viewer so the file explorer can preview
      // produced PDFs inline (off by default; blob-URL PDFs render blank without it).
      plugins: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  const wc = mainWindow.webContents
  wc.on('did-fail-load', (_e, code, desc, url) => diag(`did-fail-load ${code} ${desc} ${url}`))
  wc.on('preload-error', (_e, p, err) => diag(`preload-error ${p}: ${err.stack || err}`))
  wc.on('render-process-gone', (_e, d) => diag(`render-process-gone: ${JSON.stringify(d)}`))
  wc.on('console-message', (_e, level, message, line, source) =>
    diag(`console[${level}] ${message} (${source}:${line})`)
  )

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Serve dsfile://file/<encoded-absolute-path> by streaming that file off disk.
  protocol.handle('dsfile', (request) => {
    try {
      const encoded = new URL(request.url).pathname.replace(/^\//, '')
      const abs = decodeURIComponent(encoded)
      return net.fetch(pathToFileURL(abs).toString())
    } catch (e) {
      diag(`dsfile fetch failed: ${(e as Error).message}`)
      return new Response('Not found', { status: 404 })
    }
  })

  try {
    const { registerIpc } = await import('./ipc')
    registerIpc(() => mainWindow)
  } catch (e) {
    const err = e as Error
    diag(`startup import failed: ${err.stack || err}`)
    dialog.showErrorBox('DeepSolve Legal — startup error', String(err.stack || err))
  }
  createWindow()

  // Packaged builds check GitHub Releases for a newer version and download it in the
  // background, prompting to install on quit. No-op in dev (no app-update.yml). Best-effort
  // — a failed check (offline, rate-limited) must never block startup.
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.on('error', (e: Error) => diag(`autoUpdate error: ${e?.stack || e}`))
    autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => diag(`autoUpdate check failed: ${String(e)}`))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
