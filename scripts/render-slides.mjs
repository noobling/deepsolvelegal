// Render demo slides as styled HTML via Electron offscreen capturePage (no screen needed),
// embedding the rasterized production pages. Outputs numbered PNGs for ffmpeg to concatenate.
import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

const SRC = '/tmp/dsl-demo-frames/src'
const OUT = '/tmp/dsl-demo-frames/frames'
const W = 1600, H = 1100

const dataUri = async (file) => 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64')
const find = async (glob) => {
  const files = await fs.readdir(SRC)
  return path.join(SRC, files.find((f) => f.startsWith(glob)))
}

const shell = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#0f1115;
    font-family:-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;color:#e7eaf0}
  .mark{position:absolute;top:26px;left:40px;font-weight:700;font-size:24px;color:#c9a24b;letter-spacing:.2px}
  .stage{position:absolute;top:90px;left:0;right:0;bottom:140px;display:flex;align-items:center;justify-content:center}
  .stage img{max-width:1480px;max-height:860px;border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.55);background:#fff}
  .cap{position:absolute;left:0;right:0;bottom:0;height:120px;background:#171a21;display:flex;align-items:center;justify-content:center;
    padding:0 80px;text-align:center;font-size:34px;line-height:1.3;color:#fff;border-top:1px solid #252a34}
  .cap b{color:#c9a24b;font-weight:600}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 120px}
  .center h1{font-size:64px;color:#c9a24b;font-weight:700;letter-spacing:.3px}
  .center .sub{margin-top:18px;font-size:32px;color:#aab0bb}
  .center .big{font-size:34px;line-height:1.6;color:#d7dbe3}
  .panel{position:absolute;top:90px;left:0;right:0;bottom:60px;padding:10px 90px}
  .panel h2{font-size:42px;color:#fff;font-weight:600;margin-bottom:26px}
  .panel pre{font-family:"SF Mono",Menlo,monospace;font-size:23px;line-height:1.55;color:#cdd3dd;white-space:pre}
  .panel pre .b{color:#c9a24b}
</style></head><body>${inner}</body></html>`

const wordmark = '<div class="mark">DeepSolve Legal</div>'
const pageSlide = (img, cap) => shell(`${wordmark}<div class="stage"><img src="${img}"></div><div class="cap"><span>${cap}</span></div>`)
const titleSlide = () => shell(`${wordmark}<div class="center"><h1>DeepSolve Legal</h1><div class="sub">Local e-discovery production — a 90-second demo</div></div>`)
const panelSlide = (title, pre) => shell(`${wordmark}<div class="panel"><h2>${title}</h2><pre>${pre}</pre></div>`)
const closeSlide = () => shell(`${wordmark}<div class="center"><div class="big">5 emails &nbsp;→&nbsp; <b style="color:#c9a24b">10 Bates-stamped documents</b> &nbsp;(DEMO000001–000014)<br>.DAT metadata + .OPT image load file + Review Index<br><span style="color:#8b93a1">Everything runs 100% on-device.</span></div></div>`)

const tree = `<span class="b">Documents/</span>
  DEMO000001   Project kickoff <span class="b">(email)</span>
  DEMO000002   Proposal.pdf            attachment · pp. 000002–000004
  DEMO000005   Layout diagram.pdf + .png
  DEMO000006   Q3 budget <span class="b">(email)</span>
  DEMO000007   Q3 Budget.pdf <span class="b">(slip)</span> + .xlsx <span class="b">(native)</span>
  DEMO000008   Site photos <span class="b">(email)</span>
  DEMO000009   Site photo.pdf + .png
  DEMO000010   Meeting notes <span class="b">(email — no attachments)</span>
  DEMO000011   Contract draft <span class="b">(email)</span>
  DEMO000012   Proposal.pdf            kept again — not a logo

<span class="b">Excluded/</span>   signature.png ×5 (recurring logo)   tracker.png (156 B)`

const load = `<span class="b">Production Load File.dat</span>   document metadata
  BEGBATES   ENDBATES   BEGATTACH  ENDATTACH  …  NATIVELINK  PAGES
  DEMO000001 DEMO000001 DEMO000001 DEMO000005  …             1
  DEMO000002 DEMO000004 DEMO000001 DEMO000005  …             3   ← 3-page attachment
  DEMO000007 DEMO000007 DEMO000006 DEMO000007  …  …Q3.xlsx    1   ← native link

<span class="b">Production Load File.opt</span>   page-level image map
  DEMO000002,,…\\Proposal.pdf,Y,,,3
  DEMO000003,,…\\Proposal.pdf,,,,
  DEMO000004,,…\\Proposal.pdf,,,,`

async function shoot(win, html, out) {
  await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 350))
  const img = await win.webContents.capturePage()
  await fs.writeFile(out, img.toPNG())
}

async function main() {
  await app.whenReady()
  await fs.mkdir(OUT, { recursive: true })
  const win = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(30)
  const slides = [
    ['01.png', titleSlide()],
    ['02.png', pageSlide(await dataUri(await find('DEMO000001')), 'Every email → a clean, <b>Bates-stamped PDF</b> &nbsp;(DEMO000001)')],
    ['03.png', pageSlide(await dataUri(await find('DEMO000002 - Proposal')), 'Each attachment is its <b>own Bates document</b> — Proposal spans DEMO000002–000004')],
    ['04.png', pageSlide(await dataUri(await find('DEMO000007 - Q3 Budget')), 'Spreadsheets: native <b>.xlsx</b> kept + a Bates <b>slip-sheet</b> placeholder')],
    ['05.png', pageSlide(await dataUri(await find('DEMO000009 - Site photo')), 'Images: imaged to a stamped page, native <b>.png</b> kept alongside')],
    ['06.png', pageSlide(await dataUri(await find('signature')), 'Recurring <b>signature logo</b> — auto-detected across 5 emails → set aside')],
    ['07.png', panelSlide('One Bates-numbered bundle', tree)],
    ['08.png', panelSlide('Standard load files — Relativity-ready', load)],
    ['09.png', closeSlide()]
  ]
  for (const [name, html] of slides) {
    await shoot(win, html, path.join(OUT, name))
    console.log('rendered', name)
  }
  win.destroy()
  app.quit()
}
main().catch((e) => { console.error(e); app.quit() })
