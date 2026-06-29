// Parse .eml/.msg and render them to a clean, paginated PDF entirely in the browser
// (pdf-lib). Not a pixel-faithful render of rich HTML — a readable header + body layout,
// consistent for production. Also exposes parsed attachments for exclusion/production.

export interface EmailAttachment {
  name: string
  mime: string
  bytes: Uint8Array
}
export interface ParsedEmail {
  subject?: string
  from?: string
  to?: string
  cc?: string
  date?: string
  body: string
  attachments: EmailAttachment[]
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Addr { address?: string; name?: string }
const joinAddrs = (list?: Addr[]): string => (list || []).map((a) => a.address || a.name).filter(Boolean).join(', ')

export async function parseEmail(file: File, ext: string): Promise<ParsedEmail> {
  const buf = await file.arrayBuffer()
  if (ext === '.eml') {
    const { default: PostalMime } = await import('postal-mime')
    const e = await new PostalMime().parse(buf)
    return {
      subject: e.subject,
      from: e.from?.address || e.from?.name,
      to: joinAddrs(e.to as Addr[]),
      cc: joinAddrs(e.cc as Addr[]),
      date: e.date,
      body: e.text || (e.html ? stripHtml(e.html) : ''),
      attachments: (e.attachments || []).map((a) => ({
        name: a.filename || 'attachment',
        mime: a.mimeType || 'application/octet-stream',
        bytes: a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : new Uint8Array(a.content as unknown as ArrayBufferLike)
      }))
    }
  }
  if (ext === '.msg') {
    const { default: MsgReader } = await import('@kenjiuno/msgreader')
    const reader = new MsgReader(buf)
    const d = reader.getFileData() as {
      subject?: string; body?: string; senderName?: string; senderEmail?: string
      messageDeliveryTime?: string; recipients?: Array<{ email?: string; name?: string }>; attachments?: unknown[]
    }
    const attachments: EmailAttachment[] = (d.attachments || []).map((att, i) => {
      try {
        const a = (reader as unknown as { getAttachment: (x: unknown) => { fileName?: string; content: Uint8Array } }).getAttachment(i)
        return { name: a.fileName || `attachment-${i + 1}`, mime: 'application/octet-stream', bytes: new Uint8Array(a.content) }
      } catch {
        return { name: `attachment-${i + 1}`, mime: 'application/octet-stream', bytes: new Uint8Array() }
      }
      void att
    })
    return {
      subject: d.subject,
      from: d.senderEmail || d.senderName,
      to: (d.recipients || []).map((r) => r.email || r.name).filter(Boolean).join(', '),
      cc: '',
      date: d.messageDeliveryTime,
      body: d.body || '',
      attachments
    }
  }
  return { body: '', attachments: [] }
}

// Map common typographic characters to ASCII, then drop anything outside WinAnsi so pdf-lib's
// standard Helvetica can draw it.
function toWinAnsi(s: string): string {
  return (s || '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/\r/g, '')
    .replace(/[^\x09\x0a\x20-\x7e\xa1-\xff]/g, '?')
}

/** Render a parsed email to a US-Letter PDF (header block + wrapped, paginated body). */
export async function emailToPdf(email: ParsedEmail): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pageW = 612, pageH = 792, margin = 54, gap = 4
  const maxW = pageW - margin * 2
  let page = doc.addPage([pageW, pageH])
  let y = pageH - margin
  const newPage = (): void => { page = doc.addPage([pageW, pageH]); y = pageH - margin }
  const draw = (text: string, f = font, fs = 11, color = rgb(0, 0, 0)): void => {
    for (const rawLine of toWinAnsi(text).split('\n')) {
      const words = rawLine.split(' ')
      let line = ''
      const flush = (ln: string): void => {
        if (y < margin) newPage()
        page.drawText(ln, { x: margin, y, size: fs, font: f, color })
        y -= fs + gap
      }
      for (const w of words) {
        const test = line ? line + ' ' + w : w
        if (f.widthOfTextAtSize(test, fs) > maxW && line) { flush(line); line = w } else line = test
      }
      flush(line)
    }
  }
  if (email.subject) { draw(email.subject, bold, 14); y -= 4 }
  const hdr = (label: string, val?: string): void => { if (val) draw(`${label}: ${val}`, font, 10, rgb(0.3, 0.3, 0.3)) }
  hdr('From', email.from); hdr('To', email.to); if (email.cc) hdr('Cc', email.cc); hdr('Date', email.date)
  if (email.attachments.length) hdr('Attachments', email.attachments.map((a) => a.name).join(', '))
  y -= 6
  if (y < margin) newPage()
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) })
  y -= 16
  draw(email.body || '(no body)')
  return doc.save()
}
