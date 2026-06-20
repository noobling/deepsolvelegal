import type { ParsedMail, Attachment } from 'mailparser'

// Build a clean, Mac-Mail-like HTML document for an email: a styled header
// (subject + From/Date/To/Cc), the email's own HTML body (inline images
// embedded), and an attachments footer. Pure (no Electron) so it's testable and
// reusable; emailToPdf.ts renders the result with printToPDF.

const TRANSPARENT_PX =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function esc(s = ''): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font: 13.5px/1.55 -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1d1d1f; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .dsl-subject { font-size: 21px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; margin: 0 0 12px; color: #1d1d1f; }
  .dsl-meta { border-collapse: collapse; margin: 0 0 14px; font-size: 12.5px; }
  .dsl-meta td { padding: 1.5px 0; vertical-align: top; }
  .dsl-meta .k { color: #86868b; font-weight: 500; padding-right: 12px; white-space: nowrap; width: 1%; }
  .dsl-meta .v { color: #1d1d1f; }
  .dsl-sep { border: 0; border-top: 1px solid #e3e3e6; margin: 0 0 20px; }
  .dsl-body { font-size: 13.5px; line-height: 1.55; color: #1d1d1f; word-wrap: break-word; overflow-wrap: break-word; }
  .dsl-body img { max-width: 100%; height: auto; }
  .dsl-body table { max-width: 100%; }
  .dsl-body a { color: #0066cc; }
  .dsl-body blockquote { margin: 10px 0; padding-left: 14px; border-left: 3px solid #d2d2d7; color: #515154; }
  .dsl-body pre, .dsl-body code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
  .dsl-body pre { white-space: pre-wrap; word-wrap: break-word; }
  .dsl-atts { margin-top: 24px; padding: 12px 14px; border: 1px solid #e3e3e6; border-radius: 10px;
    background: #f5f5f7; font-size: 12.5px; color: #1d1d1f; }
  .dsl-atts .t { font-weight: 600; margin-bottom: 5px; }
  .dsl-atts .f { color: #515154; }
`

/** Width/height from a PNG/GIF/JPEG buffer header, or null if not parseable. */
function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } // PNG
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) } // GIF
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2 // JPEG: walk markers to the start-of-frame for dimensions
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      if (m === 0xd8 || m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

/**
 * Whether an inline image is a signature graphic (company logo, social icon) vs.
 * content (a photo, screenshot, or floor plan — which must be preserved as it may
 * be evidence). Signatures are small in BOTH bytes and pixels; anything sizeable
 * in either is kept.
 */
export function isSignatureGraphic(buf?: Buffer, filename?: string): boolean {
  if (!buf || !buf.length) return false
  // Camera / screenshot / descriptive filenames are user content — never strip,
  // even when small (a phone photo can be a small thumbnail). Outlook's generic
  // "imageNNN" auto-name is NOT excluded here (it's used for both logos and
  // pasted screenshots), so those fall through to the size checks below.
  const name = (filename || '').toLowerCase()
  if (/img[-_ ]?\d|dsc\d|screenshot|screen shot|photo|capture|whatsapp|\.heic|\d{8}/.test(name)) return false
  const bytes = buf.length
  if (bytes >= 150 * 1024) return false // clearly a photo
  const d = imageSize(buf)
  const maxDim = d ? Math.max(d.w, d.h) : null
  if (maxDim != null && maxDim >= 800) return false // large dimensions → screenshot / diagram
  // Small in bytes and pixels → a logo or social icon (a signature graphic).
  if (bytes <= 40 * 1024) return true
  return maxDim != null && maxDim <= 650 // a mid-size logo with small dimensions
}

/**
 * Whether a file attachment is likely non-substantive and can be set aside for
 * review (Excluded/) rather than produced. Two signals, both opt-in:
 *  - a logo/icon image (small in bytes AND pixels) when excludeSignatures is on —
 *    reuses the inline-image heuristic, so photos/screenshots are still kept;
 *  - any file smaller than `underBytes` (the user's "small ⇒ probably not important"
 *    threshold), regardless of type.
 * Excluding only sets a file aside for review — it is never deleted.
 */
export function isInsignificantAttachment(
  a: Attachment,
  opts: { excludeSignatures?: boolean; underBytes?: number }
): boolean {
  const size = a.content?.length || 0
  if (opts.underBytes && size > 0 && size < opts.underBytes) return true
  if (opts.excludeSignatures && a.contentType?.startsWith('image/') && isSignatureGraphic(a.content, a.filename)) return true
  return false
}

/**
 * Remove common footer boilerplate — confidentiality/privilege disclaimers,
 * email-scan notices, and "Sent from my …" lines. Bounded + anchored on closing
 * markers so it can't run away; the sender's name/contact and substantive text
 * are left intact.
 */
export function stripBoilerplate(html: string): string {
  return html
    .replace(/Sent from my [^<\n]{0,40}/gi, '')
    .replace(/_{6,}(?:\s|<[^>]+>)*This (?:e-?mail|message) has been scanned by[\s\S]{0,200}?(?:cloud service\.?|Symantec[^<.]*\.?)(?:\s|<[^>]+>)*_{6,}/gi, '')
    .replace(/This (?:e-?mail|message) has been scanned by[\s\S]{0,160}?(?:cloud service\.?|Symantec[^<.]*\.?)/gi, '')
    .replace(/The information contained in this (?:message|e-?mail)[\s\S]{0,700}?(?:\(IDSC\d+\)|delete the (?:message|e-?mail)\.?|strictly prohibited\.?)/gi, '')
    .replace(/This (?:e-?mail|message)(?: and any (?:attachments?|files? transmitted with it))? (?:is|are) (?:strictly )?(?:confidential|intended)[\s\S]{0,700}?(?:delete[\s\S]{0,80}?\.|prohibited\.?|notify the sender[\s\S]{0,60}?\.)/gi, '')
}

export function buildEmailHtml(
  mail: ParsedMail,
  opts: { excludeSignatures?: boolean; excludeAttachments?: string[]; excludeUnderBytes?: number } = {}
): { html: string; fileAttachments: Attachment[]; excludedAttachments: Attachment[] } {
  const atts = (mail.attachments || []) as Attachment[]
  const excludeSignatures = !!opts.excludeSignatures
  const excludeUnderBytes = opts.excludeUnderBytes || 0
  const excludeNames = new Set((opts.excludeAttachments || []).map((s) => s.trim().toLowerCase()).filter(Boolean))
  let body = typeof mail.html === 'string' && mail.html ? mail.html : mail.textAsHtml || '<p>(no message body)</p>'

  // Apple Mail interleaves several full <html>…</html> documents (one per inline
  // part). Flatten the document wrappers so nested <body> margins/<meta> don't
  // add large empty gaps; the inner content + styling is preserved.
  body = body.replace(/<\/?(?:html|head|body)[^>]*>/gi, '').replace(/<meta\b[^>]*>/gi, '')
  // Collapse the empty spacer blocks Apple Mail leaves where inline parts sat
  // (stacks of empty <div>s and <br>s that otherwise render as big gaps).
  for (let i = 0; i < 3; i++) {
    body = body.replace(/<div[^>]*>(?:\s|&nbsp;| |<br\b[^>]*\/?>)*<\/div>/gi, '')
  }
  body = body.replace(/(?:\s*<br\b[^>]*\/?>\s*){3,}/gi, '<br><br>')

  // Resolve cid: references → attachments. Prefer Content-ID; fall back to the
  // order cids appear vs. the order attachments arrive (handles emails whose
  // Content-ID headers were stripped on export).
  const cidRefs = [...new Set((body.match(/cid:[^"'\s)>]+/gi) || []).map((s) => s.slice(4)))]
  const idOf = (a: Attachment): string => (a.contentId || '').replace(/^<|>$/g, '')
  const byId = new Map<string, Attachment>()
  for (const a of atts) if (idOf(a)) byId.set(idOf(a), a)
  const unresolvedCids = cidRefs.filter((c) => !byId.has(c))
  const unusedAtts = atts.filter((a) => !idOf(a) || !cidRefs.includes(idOf(a)))
  const orderMap = new Map<string, Attachment>()
  unresolvedCids.forEach((c, i) => unusedAtts[i] && orderMap.set(c, unusedAtts[i]))

  const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const badge = (name: string): string =>
    `<span style="display:inline-block;padding:3px 9px;margin:3px 2px;border:1px solid #d2d2d7;border-radius:6px;background:#f5f5f7;color:#515154;font-size:12.5px;">📎 ${esc(name)}</span>`

  const embedded = new Set<Attachment>()
  for (const cid of cidRefs) {
    const a = byId.get(cid) || orderMap.get(cid)
    if (a && a.contentType?.startsWith('image/')) {
      embedded.add(a)
      if (excludeSignatures && isSignatureGraphic(a.content, a.filename)) {
        // Drop signature logos / social icons entirely (content photos are kept).
        body = body.replace(new RegExp('<img[^>]*cid:' + escRe(cid) + '[^>]*>', 'gi'), '')
        body = body.split('cid:' + cid).join(TRANSPARENT_PX)
      } else {
        // Inline image: embed as a data URI.
        body = body.split('cid:' + cid).join(`data:${a.contentType};base64,${a.content.toString('base64')}`)
      }
    } else {
      // Non-image (e.g. an inline PDF preview) or unmatched cid: the original
      // <img> would render as a big blank box, so swap the whole tag for a small
      // attachment badge; the file itself is extracted + listed below.
      body = body.replace(new RegExp('<img[^>]*cid:' + escRe(cid) + '[^>]*>', 'gi'), badge(a?.filename || 'attachment'))
      body = body.split('cid:' + cid).join(TRANSPARENT_PX) // any remaining bare refs
    }
  }

  if (excludeSignatures) {
    body = stripBoilerplate(body)
    // Tidy blocks the removals emptied out.
    for (let i = 0; i < 2; i++) body = body.replace(/<div[^>]*>(?:\s|&nbsp;| |<br\b[^>]*\/?>)*<\/div>/gi, '')
    body = body.replace(/(?:\s*<br\b[^>]*\/?>\s*){3,}/gi, '<br><br>')
  }

  // Attachments not embedded inline, split into kept vs. set-aside: excluded by
  // filename, or auto-detected as insignificant (a logo/icon, or a tiny file).
  const allAttachments = atts.filter((a) => !embedded.has(a))
  const isExcluded = (a: Attachment): boolean =>
    excludeNames.has((a.filename || '').trim().toLowerCase()) ||
    isInsignificantAttachment(a, { excludeSignatures, underBytes: excludeUnderBytes })
  const excludedAttachments = allAttachments.filter(isExcluded)
  const fileAttachments = allAttachments.filter((a) => !isExcluded(a))

  const addrText = (v: ParsedMail['to']): string =>
    (Array.isArray(v) ? v.map((t) => t.text).join(', ') : v?.text) || ''
  const dateText = (d?: Date): string =>
    d
      ? `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : ''

  const rows: string[] = []
  const row = (label: string, val: string): void => {
    if (val) rows.push(`<tr><td class="k">${label}</td><td class="v">${esc(val)}</td></tr>`)
  }
  row('From', mail.from?.text || '')
  row('Date', dateText(mail.date))
  row('To', addrText(mail.to))
  row('Cc', addrText(mail.cc))

  const attBox = fileAttachments.length
    ? `<div class="dsl-atts"><div class="t">📎 ${fileAttachments.length} attachment${fileAttachments.length === 1 ? '' : 's'} <span class="f">(saved alongside)</span></div>${fileAttachments
        .map((a) => `<div class="f">${esc(a.filename || 'attachment')} · ${Math.max(1, Math.round((a.content?.length || 0) / 1024))} KB</div>`)
        .join('')}</div>`
    : ''

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <div class="dsl-subject">${esc(mail.subject || '(no subject)')}</div>
    <table class="dsl-meta">${rows.join('')}</table>
    <hr class="dsl-sep">
    <div class="dsl-body">${body}</div>
    ${attBox}
  </body></html>`

  return { html, fileAttachments, excludedAttachments }
}
