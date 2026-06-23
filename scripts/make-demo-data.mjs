// Generate a small, SHAREABLE synthetic email set that exercises every production feature:
//   - email families with attachments (per-attachment Bates)
//   - a recurring signature logo across 5 conversations (auto-excluded)
//   - a tiny <3 KB icon (auto-excluded)
//   - a spreadsheet (produced native + Bates slip-sheet)
//   - images (imaged to PDF + native kept)
//   - a real PDF attachment (passthrough)
//   - a content doc that recurs in only 2 emails (kept, NOT mistaken for a logo)
// No real client data — safe to record/share. Output: ~/Documents/DeepSolve Demo/inbox
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { Jimp } from 'jimp'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import ExcelJS from 'exceljs'

const OUT = path.join(os.homedir(), 'Documents', 'DeepSolve Demo', 'inbox')

// A small banded image — enough entropy for a real perceptual hash, looks logo/photo-ish.
async function banded(w, h, seed) {
  const img = new Jimp({ width: w, height: h, color: 0xffffffff })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = (Math.sin((x + seed) / 7) * 90 + 140) & 0xff
      const g = (Math.cos((y + seed) / 5) * 80 + 130) & 0xff
      const b = ((x ^ y) + seed * 13) & 0xff
      img.setPixelColor(((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0, x, y)
    }
  }
  return await img.getBuffer('image/png')
}

// A multi-page document (well over the 3 KB small-file threshold), so it's produced as a real
// content PDF — and its multi-page Bates span shows the per-page numbering in the demo.
async function makePdf(title, intro) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const sections = [
    ['1. Scope of Works', 'The contractor shall design, supply, and install the mechanical and hydraulic services for the Northbridge fit-out as described in the tender documents. All works to comply with the relevant Australian Standards and the project specification.'],
    ['2. Programme', 'Works commence on site Monday and proceed in three stages: rough-in, fit-off, and commissioning. The contractor shall submit a detailed programme within five business days of award and update it weekly thereafter.'],
    ['3. Pricing & Payments', 'The lump sum price is fixed for the duration of the works. Progress claims are to be submitted monthly, assessed against the agreed schedule of values, and paid within the statutory period.'],
    ['4. Variations', 'No variation shall be carried out without prior written instruction. Each variation is to be priced using the agreed rates, and where no rate applies, on a reasonable cost-plus basis with supporting records.'],
    ['5. Warranties', 'The contractor warrants all materials and workmanship for the defects liability period. Manufacturer warranties for installed equipment are to be assigned to the principal at practical completion.']
  ]
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([595, 842])
    page.drawText(p === 0 ? title : `${title} (cont.)`, { x: 56, y: 786, size: 18, font: bold, color: rgb(0.1, 0.12, 0.16) })
    if (p === 0) page.drawText(intro, { x: 56, y: 756, size: 12, font, color: rgb(0.2, 0.22, 0.26) })
    let y = 716
    for (const [h, body] of sections) {
      page.drawText(h, { x: 56, y, size: 13, font: bold, color: rgb(0.12, 0.14, 0.18) })
      y -= 20
      // wrap the body at ~78 chars
      for (const line of body.match(/.{1,78}(\s|$)/g) || []) {
        page.drawText(line.trim(), { x: 56, y, size: 11, font, color: rgb(0.25, 0.27, 0.31) })
        y -= 16
      }
      y -= 10
    }
  }
  return Buffer.from(await doc.save())
}

async function makeXlsx() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Q3 Budget')
  ws.addRow(['Item', 'Q1', 'Q2', 'Q3'])
  ws.addRow(['Hosting', 1200, 1250, 1300])
  ws.addRow(['Licences', 800, 800, 950])
  ws.addRow(['Contractors', 5400, 6100, 7200])
  ws.addRow(['Total', 7400, 8150, 9450])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const b64 = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n')

function eml({ from, to, subject, date, bodyHtml, atts }) {
  const B = 'DSLDEMO_BOUNDARY_8x1'
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${B}"`,
    '',
    `--${B}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    bodyHtml,
    ''
  ]
  for (const a of atts) {
    parts.push(
      `--${B}`,
      `Content-Type: ${a.type}; name="${a.name}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${a.name}"`,
      '',
      b64(a.buf),
      ''
    )
  }
  parts.push(`--${B}--`, '')
  return parts.join('\r\n')
}

async function main() {
  await fs.rm(path.join(os.homedir(), 'Documents', 'DeepSolve Demo'), { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(OUT, { recursive: true })

  // Shared assets
  const sig = await banded(260, 64, 3) // the recurring signature banner (~small)
  const proposal = await makePdf('Project Proposal — Northbridge Fit-out', 'Prepared for Bob Tan, Client Pty Ltd. Revision A, June 2026.')
  const diagram = await banded(420, 300, 41)
  const photo = await banded(640, 420, 90)
  const budget = await makeXlsx()
  // A genuinely tiny attachment (< 3 KB) — a tracking-pixel-ish icon.
  const tinyIcon = await banded(8, 8, 1)

  const sigHtml = '<p style="margin-top:18px;color:#888;font-size:12px;border-top:1px solid #ddd;padding-top:8px">Jane Doe · Northbridge Projects · jane@northbridge.example</p>'
  const wrap = (p) => `<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1d1d1f">${p}${sigHtml}</body></html>`

  const emails = [
    {
      from: 'Jane Doe <jane@northbridge.example>', to: 'Bob Tan <bob@client.example>',
      subject: 'Project kickoff — Northbridge fit-out', date: 'Mon, 02 Jun 2026 09:05:00 +0000',
      bodyHtml: wrap('<p>Hi Bob,</p><p>Attached is the proposal and the layout diagram to get us started. Let me know your thoughts.</p>'),
      atts: [{ name: 'Proposal.pdf', type: 'application/pdf', buf: proposal }, { name: 'Layout diagram.png', type: 'image/png', buf: diagram }, { name: 'signature.png', type: 'image/png', buf: sig }]
    },
    {
      from: 'Jane Doe <jane@northbridge.example>', to: 'Bob Tan <bob@client.example>',
      subject: 'Q3 budget for review', date: 'Tue, 03 Jun 2026 14:20:00 +0000',
      bodyHtml: wrap('<p>Bob,</p><p>Here is the Q3 budget spreadsheet. The contractor line moved up — see the totals row.</p>'),
      atts: [{ name: 'Q3 Budget.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: budget }, { name: 'signature.png', type: 'image/png', buf: sig }]
    },
    {
      from: 'Bob Tan <bob@client.example>', to: 'Jane Doe <jane@northbridge.example>',
      subject: 'Site photos from the walkthrough', date: 'Wed, 04 Jun 2026 08:00:00 +0000',
      bodyHtml: wrap('<p>Jane,</p><p>Photos from this morning attached. Ignore the little tracker icon our mail system adds.</p>'),
      atts: [{ name: 'Site photo.png', type: 'image/png', buf: photo }, { name: 'tracker.png', type: 'image/png', buf: tinyIcon }, { name: 'signature.png', type: 'image/png', buf: sig }]
    },
    {
      from: 'Jane Doe <jane@northbridge.example>', to: 'Bob Tan <bob@client.example>',
      subject: 'Meeting notes — 5 June', date: 'Thu, 05 Jun 2026 17:30:00 +0000',
      bodyHtml: wrap('<p>Summary of today: scope locked, budget approved pending the contractor quote, photos received.</p><p>No attachments on this one.</p>'),
      atts: [{ name: 'signature.png', type: 'image/png', buf: sig }]
    },
    {
      from: 'Jane Doe <jane@northbridge.example>', to: 'Bob Tan <bob@client.example>',
      subject: 'Contract draft for signature', date: 'Fri, 06 Jun 2026 11:15:00 +0000',
      bodyHtml: wrap('<p>Bob,</p><p>Re-sending the proposal as the contract basis. Same document as before.</p>'),
      atts: [{ name: 'Proposal.pdf', type: 'application/pdf', buf: proposal }, { name: 'signature.png', type: 'image/png', buf: sig }]
    }
  ]

  let n = 0
  for (const e of emails) {
    const fname = String(++n).padStart(2, '0') + ' - ' + e.subject.replace(/[<>:"/\\|?*]/g, '').slice(0, 50) + '.eml'
    await fs.writeFile(path.join(OUT, fname), eml(e), 'utf8')
  }
  console.log(`Wrote ${emails.length} demo emails to ${OUT}`)
  console.log('Features triggered: per-attachment Bates families, recurring signature logo (5 convs → auto-excluded),')
  console.log('tiny <3KB icon (auto-excluded), xlsx (native+slip), images (imaged+native), PDF passthrough, repeated content doc (kept).')
}
main().catch((e) => { console.error(e); process.exit(1) })
