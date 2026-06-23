// Headless validation that the synthetic demo set triggers every feature, BEFORE recording.
// Offscreen render — no unlocked screen needed. Prints counts, the Documents tree, and the
// Excluded/ contents so we can confirm the recurring logo + tiny icon were set aside.
import { app } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import type { Collection, IndexedDoc, IndexEvent } from '@shared/types'
import { buildProduction } from '../src/main/export/production'

app.on('window-all-closed', () => {})

async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(prefix + (e.isDirectory() ? '📁 ' : '   ') + e.name)
    if (e.isDirectory()) out.push(...(await tree(path.join(dir, e.name), prefix + '   ')))
  }
  return out
}

async function main(): Promise<void> {
  await app.whenReady()
  const inbox = path.join(os.homedir(), 'Documents', 'DeepSolve Demo', 'inbox')
  const out = path.join(os.homedir(), 'Documents', 'DeepSolve Demo', 'output')
  await fs.rm(out, { recursive: true, force: true }).catch(() => {})
  const files = (await fs.readdir(inbox)).filter((f) => f.endsWith('.eml')).map((f) => path.join(inbox, f))
  const docs: IndexedDoc[] = []
  for (const p of files) {
    const st = await fs.stat(p)
    docs.push({ id: createHash('sha1').update(p).digest('hex').slice(0, 16), path: p, name: path.basename(p), ext: '.eml', size: st.size, modifiedAt: Math.floor(st.mtimeMs), kind: 'email', textChars: 0 })
  }
  const collection = {
    id: 'demo', name: 'Northbridge Demo', folders: [inbox], output: out,
    createdAt: 0, updatedAt: 0, fileCount: docs.length, status: 'ready', aiEnrich: false,
    bates: { prefix: 'DEMO', start: 1 }, combineAttachments: false, excludeSignatures: true,
    features: { emailToPdf: true, reviewIndex: true, loadFile: true, highlights: false, aiEnrich: false }
  } as Collection
  const r = await buildProduction(collection, docs, (_e: IndexEvent) => {}, () => false)
  console.log(`\npdfCount=${r.pdfCount} processed=${r.processed} excludedAttachments=${r.excludedAttachments} slipSheets=${r.slipSheets} errors=${r.errors.length} bates=${JSON.stringify(r.batesRange)}`)
  if (r.errors.length) console.log('ERRORS', JSON.stringify(r.errors.slice(0, 5)))
  console.log('\n=== Documents/ ===')
  console.log((await tree(path.join(out, 'Documents'))).join('\n'))
  console.log('\n=== Excluded/ ===')
  console.log((await tree(path.join(out, 'Excluded'))).join('\n'))
  console.log('\nBundle kept at:', out)
  app.quit()
}
main().catch((e) => { console.error(e); app.quit() })
