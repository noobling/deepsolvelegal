// Reproduce + verify the attachment-exclusion behaviour over the demo set: excluding an
// attachment must remove BOTH its produced slip/imaged PDF AND its native file, and write an
// exclude-map so the tree can resolve either produced file back to the source attachment.
import { app } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import type { Collection, IndexedDoc, IndexEvent } from '@shared/types'
import { buildProduction } from '../src/main/export/production'

app.on('window-all-closed', () => {})

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p)))
    else out.push(p)
  }
  return out
}

async function run(label: string, over: Partial<Collection>): Promise<void> {
  const inbox = path.join(os.homedir(), 'Documents', 'Quantum Law Group Demo', 'inbox')
  const out = path.join(os.tmpdir(), 'dsl-excl-' + label + '-' + process.pid)
  await fs.rm(out, { recursive: true, force: true }).catch(() => {})
  const files = (await fs.readdir(inbox)).filter((f) => f.endsWith('.eml')).map((f) => path.join(inbox, f))
  const docs: IndexedDoc[] = []
  for (const p of files) {
    const st = await fs.stat(p)
    docs.push({ id: createHash('sha1').update(p).digest('hex').slice(0, 16), path: p, name: path.basename(p), ext: '.eml', size: st.size, modifiedAt: Math.floor(st.mtimeMs), kind: 'email', textChars: 0 })
  }
  const c = {
    id: 'excltest', name: 'x', folders: [inbox], output: out, createdAt: 0, updatedAt: 0,
    fileCount: docs.length, status: 'ready', aiEnrich: false, bates: { prefix: 'DEMO', start: 1 },
    combineAttachments: false, excludeSignatures: true, features: { emailToPdf: true, reviewIndex: true, loadFile: true, highlights: false, aiEnrich: false },
    ...over
  } as Collection
  const r = await buildProduction(c, docs, (_e: IndexEvent) => {}, () => false)
  const docFiles = (await listFiles(path.join(out, 'Documents'))).map((f) => path.basename(f))
  const exclFiles = (await listFiles(path.join(out, 'Excluded'))).map((f) => path.basename(f))
  const budgetInDocs = docFiles.filter((f) => /Q3 Budget/i.test(f))
  const budgetInExcl = exclFiles.filter((f) => /Q3 Budget/i.test(f))
  const map = await fs.readFile(path.join(out, '.exclude-map.json'), 'utf8').then((s) => JSON.parse(s)).catch(() => null)
  console.log(`\n### ${label}: pdfCount=${r.pdfCount} excludedAtt=${r.excludedAttachments}`)
  console.log('  Q3 Budget files in Documents/:', JSON.stringify(budgetInDocs))
  console.log('  Q3 Budget files in Excluded/: ', JSON.stringify(budgetInExcl))
  if (map) {
    const budgetMap = Object.entries(map).filter(([k]) => /Q3 Budget/i.test(k))
    console.log('  .exclude-map entries for Q3 Budget:', JSON.stringify(budgetMap))
  } else console.log('  .exclude-map.json: (none)')
  await fs.rm(out, { recursive: true, force: true }).catch(() => {})
}

async function main(): Promise<void> {
  await app.whenReady()
  await run('baseline', {})
  await run('exclude-Q3', { excludeAttachments: ['Q3 Budget.xlsx'] })
  app.quit()
}
main().catch((e) => { console.error(e); app.quit() })
