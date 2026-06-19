import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import type { ToolDef } from './types'
import { resolvePath, str } from './types'
import { markdownToDocx, markdownToXlsx } from '../export/convert'
import { extractPdfText, extractDocxText, extractXlsxText } from '../library/extract'
import { extractHighlights as extractDocHighlights } from '../library/highlights'
import { convertEmailsToPdf } from '../export/emailToPdf'

export const readPdf: ToolDef = {
  name: 'read_pdf',
  description: 'Extract the text of a PDF file, page by page. Use this for any .pdf document.',
  needsPermission: false,
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, 'path'))
    if (!existsSync(file)) return { summary: `Not found: ${file}`, content: 'File does not exist.', isError: true }
    try {
      const text = await extractPdfText(file)
      return { summary: `Read PDF ${path.basename(file)}`, content: text || '(no extractable text — may be scanned)' }
    } catch (e) {
      return { summary: `PDF read failed`, content: `Could not read PDF: ${(e as Error).message}`, isError: true }
    }
  }
}

export const readDocx: ToolDef = {
  name: 'read_docx',
  description: 'Extract the text of a Microsoft Word (.docx) file.',
  needsPermission: false,
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, 'path'))
    if (!existsSync(file)) return { summary: `Not found: ${file}`, content: 'File does not exist.', isError: true }
    try {
      const value = await extractDocxText(file)
      return { summary: `Read Word doc ${path.basename(file)}`, content: value || '(empty document)' }
    } catch (e) {
      return { summary: `Word read failed`, content: `Could not read .docx: ${(e as Error).message}`, isError: true }
    }
  }
}

export const extractHighlights: ToolDef = {
  name: 'extract_highlights',
  description:
    "Extract the passages a reviewer marked with the highlighter — Microsoft Word's highlighter/shading in a .docx, or highlight annotations in a .pdf. Returns each highlighted snippet, its colour, and the surrounding clause for context. Use this to pull out the exact text a senior reviewer flagged.",
  needsPermission: false,
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, 'path'))
    if (!existsSync(file)) return { summary: `Not found: ${file}`, content: 'File does not exist.', isError: true }
    const ext = path.extname(file).toLowerCase()
    if (ext !== '.docx' && ext !== '.pdf') {
      return { summary: 'Unsupported file', content: 'Highlights can be extracted from .docx or .pdf files only.', isError: true }
    }
    try {
      const hits = await extractDocHighlights(file)
      if (hits.length === 0) {
        return { summary: `No highlights in ${path.basename(file)}`, content: 'No highlighted text found in this document.' }
      }
      const content = hits
        .map((h, i) => `${i + 1}. [${h.color}] "${h.text}"\n   in: ${h.context.slice(0, 280)}`)
        .join('\n\n')
      return { summary: `${hits.length} highlight${hits.length === 1 ? '' : 's'} in ${path.basename(file)}`, content }
    } catch (e) {
      return { summary: 'Highlight read failed', content: `Could not read highlights: ${(e as Error).message}`, isError: true }
    }
  }
}

export const convertEmailsToPdfTool: ToolDef = {
  name: 'convert_emails_to_pdf',
  description:
    'Convert every .eml email in a folder (including subfolders) to PDF, writing the PDFs into an output folder that mirrors the input structure. Non-email files are skipped. Prompts before writing.',
  needsPermission: true,
  inputSchema: {
    type: 'object',
    properties: {
      input_dir: { type: 'string', description: 'Folder of emails to convert (searched recursively).' },
      output_dir: { type: 'string', description: 'Folder to write the PDFs into (created if needed).' }
    },
    required: ['input_dir', 'output_dir']
  },
  async run(args, ctx) {
    const input = resolvePath(ctx, str(args, 'input_dir'))
    const output = resolvePath(ctx, str(args, 'output_dir'))
    if (!existsSync(input)) return { summary: `Not found: ${input}`, content: 'Input folder does not exist.', isError: true }
    const ok = await ctx.requestPermission('Convert emails to PDF', `Read .eml files in:\n${input}\n\nWrite PDFs to:\n${output}`)
    if (!ok) return { summary: 'Conversion denied', content: 'User denied the conversion.', isError: true }
    try {
      const r = await convertEmailsToPdf(input, output)
      const lines = [
        `Converted ${r.converted} email${r.converted === 1 ? '' : 's'} to PDF in ${output}`,
        `Extracted ${r.attachments} attachment${r.attachments === 1 ? '' : 's'} to "<name> - attachments" folders.`,
        `Skipped ${r.skipped} non-email file${r.skipped === 1 ? '' : 's'}.`
      ]
      if (r.errors.length) lines.push(`${r.errors.length} failed: ${r.errors.map((e) => path.basename(e.file)).join(', ')}`)
      return {
        summary: `${r.converted} email${r.converted === 1 ? '' : 's'} → PDF`,
        content: lines.join('\n') + (r.outputs.length ? '\n\n' + r.outputs.join('\n') : ''),
        isError: r.converted === 0 && r.errors.length > 0
      }
    } catch (e) {
      return { summary: 'Conversion failed', content: `Could not convert emails: ${(e as Error).message}`, isError: true }
    }
  }
}

export const readXlsx: ToolDef = {
  name: 'read_xlsx',
  description: 'Read a Microsoft Excel (.xlsx) file and return its sheets as text tables.',
  needsPermission: false,
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async run(args, ctx) {
    const file = resolvePath(ctx, str(args, 'path'))
    if (!existsSync(file)) return { summary: `Not found: ${file}`, content: 'File does not exist.', isError: true }
    try {
      const content = await extractXlsxText(file)
      return { summary: `Read Excel ${path.basename(file)}`, content }
    } catch (e) {
      return { summary: `Excel read failed`, content: `Could not read .xlsx: ${(e as Error).message}`, isError: true }
    }
  }
}

export const writeDocx: ToolDef = {
  name: 'write_docx',
  description:
    'Generate a Microsoft Word (.docx) document from Markdown content (headings, bullets, blockquotes, and tables are supported). Prompts the user before writing.',
  needsPermission: true,
  inputSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, e.g. "Contract Review.docx".' },
      title: { type: 'string', description: 'Optional document title.' },
      markdown: { type: 'string', description: 'The document body as Markdown.' }
    },
    required: ['filename', 'markdown']
  },
  async run(args, ctx) {
    let filename = str(args, 'filename', 'document.docx')
    if (!filename.toLowerCase().endsWith('.docx')) filename += '.docx'
    const file = resolvePath(ctx, filename)
    const ok = await ctx.requestPermission('Create Word document', `Generate:\n${file}`)
    if (!ok) return { summary: 'Write denied', content: 'User denied the write.', isError: true }
    const buf = await markdownToDocx(str(args, 'markdown'), str(args, 'title') || undefined)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, buf)
    return { summary: `Wrote ${path.basename(file)}`, content: `Word document saved to ${file}` }
  }
}

export const writeXlsx: ToolDef = {
  name: 'write_xlsx',
  description:
    'Generate a Microsoft Excel (.xlsx) file from a Markdown table. Prompts the user before writing.',
  needsPermission: true,
  inputSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, e.g. "Diligence.xlsx".' },
      sheet_name: { type: 'string' },
      markdown_table: { type: 'string', description: 'A Markdown table to write as the sheet.' }
    },
    required: ['filename', 'markdown_table']
  },
  async run(args, ctx) {
    let filename = str(args, 'filename', 'data.xlsx')
    if (!filename.toLowerCase().endsWith('.xlsx')) filename += '.xlsx'
    const file = resolvePath(ctx, filename)
    const ok = await ctx.requestPermission('Create Excel file', `Generate:\n${file}`)
    if (!ok) return { summary: 'Write denied', content: 'User denied the write.', isError: true }
    const buf = await markdownToXlsx(str(args, 'markdown_table'), str(args, 'sheet_name', 'Sheet1'))
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, buf)
    return { summary: `Wrote ${path.basename(file)}`, content: `Excel file saved to ${file}` }
  }
}
