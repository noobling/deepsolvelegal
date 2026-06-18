import { promises as fs } from 'fs'
import path from 'path'
import type { EmailToPdfResult } from '@shared/types'
import { parseEmlFile } from '../library/email'
import { markdownToPdf } from './convert'

// Batch-convert .eml files in a folder tree to PDFs, mirroring the subfolder
// structure into an output folder. Non-email files are skipped.

export type { EmailToPdfResult }

// parseEmlFile reads the .eml as latin1 (to tolerate any bytes), so a UTF-8 body
// arrives byte-mangled. Re-decode as UTF-8, but only when the bytes are valid
// UTF-8 (round-trips exactly) — otherwise the email really was latin1, keep it.
function recodeUtf8(s: string): string {
  const buf = Buffer.from(s, 'latin1')
  const utf8 = buf.toString('utf8')
  return Buffer.from(utf8, 'utf8').equals(buf) ? utf8 : s
}

// pdf-lib's standard fonts only encode WinAnsi (CP1252); replace common smart
// punctuation and drop anything else so a stray glyph can't fail the whole doc.
function pdfSafe(raw: string): string {
  const s = recodeUtf8(raw)
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[•●▪]/g, '- ')
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, '')
}

/** Recursively collect .eml files and count the rest. Never descends into outDir. */
async function collectEml(dir: string, skipDir: string, found: string[], counts: { skipped: number }): Promise<void> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (path.resolve(full) === skipDir) continue // don't walk into the output folder
      await collectEml(full, skipDir, found, counts)
    } else if (path.extname(e.name).toLowerCase() === '.eml') {
      found.push(full)
    } else {
      counts.skipped++ // a non-email file — leave it alone
    }
  }
}

function emailMarkdown(from: string, to: string, date: string, subject: string, body: string): string {
  return [
    `From: ${pdfSafe(from) || '(unknown)'}`,
    `To: ${pdfSafe(to) || '(unknown)'}`,
    `Date: ${pdfSafe(date) || '(unknown)'}`,
    '',
    '--------------------------------------------------------------------------------',
    '',
    pdfSafe(body) || '(no message body)'
  ].join('\n')
}

export async function convertEmailsToPdf(inputDir: string, outputDir: string): Promise<EmailToPdfResult> {
  const inRoot = path.resolve(inputDir)
  const outRoot = path.resolve(outputDir)
  const result: EmailToPdfResult = { converted: 0, skipped: 0, errors: [], outputs: [] }

  // Collect first, so writing PDFs can't interfere with the walk.
  const emls: string[] = []
  const counts = { skipped: 0 }
  await collectEml(inRoot, outRoot, emls, counts)
  result.skipped = counts.skipped

  for (const eml of emls) {
    try {
      const m = await parseEmlFile(eml)
      const md = emailMarkdown(m.from, m.to, m.date, m.subject, m.body)
      const pdf = await markdownToPdf(md, pdfSafe(m.subject) || '(no subject)')

      // Mirror the relative path; swap .eml → .pdf.
      const rel = path.relative(inRoot, eml).replace(/\.eml$/i, '.pdf')
      const outPath = path.join(outRoot, rel)
      await fs.mkdir(path.dirname(outPath), { recursive: true })
      await fs.writeFile(outPath, pdf)
      result.outputs.push(outPath)
      result.converted++
    } catch (e) {
      result.errors.push({ file: eml, error: (e as Error).message })
    }
  }

  return result
}
