// Headless test of the excluded-attachment restore map (real Electron main process,
// but no PDF render): drives the REAL writeExcludedFolder with synthetic excluded
// records and asserts that Excluded/.restore-map.json points each excluded file at the
// produced folder(s) a restore would land in. Also unit-checks intendedDirOf.
import { app } from 'electron'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { writeExcludedFolder, intendedDirOf, sweepStaleOutputs, pdfFileName, dedupePdfExt, buildProduction } from '../src/main/export/production'
import { buildEmailHtml, attSha } from '../src/main/export/emailHtml'
import type { Collection, IndexedDoc, IndexEvent } from '@shared/types'
import { simpleParser } from 'mailparser'
import { createHash } from 'crypto'
import { Jimp } from 'jimp'

const log = (...a: unknown[]): void => process.stdout.write(a.join(' ') + '\n')

type Excluded = { name: string; size: number; content: Buffer; source: string }

async function main(): Promise<void> {
  const tmp = path.join(os.tmpdir(), 'dsl-prod-e2e-' + process.pid)
  app.setPath('userData', path.join(tmp, 'userData'))
  // buildProduction opens + destroys hidden render windows; the default window-all-closed
  // handler would quit the app mid-test before we print the result. Keep it alive — we
  // exit explicitly via app.exit() at the end.
  app.on('window-all-closed', () => {})
  await app.whenReady()

  const outDir = path.join(tmp, 'Output')
  await fs.mkdir(outDir, { recursive: true })

  const checks: Array<[string, boolean]> = []
  const check = (name: string, cond: boolean): void => {
    checks.push([name, cond])
    log((cond ? '  ✓ ' : '  ✗ ') + name)
  }

  // intendedDirOf — the produced family folder for an email's restored attachment.
  log('intendedDirOf:')
  check('nested email -> Documents/<dir>/<email>', intendedDirOf('Mailbox/2026/message.eml') === 'Documents/Mailbox/2026/message')
  check('root-level email -> Documents/<email>', intendedDirOf('message.eml') === 'Documents/message')
  check('windows separators normalised', intendedDirOf('Mailbox\\Inbox\\msg.eml') === 'Documents/Mailbox/Inbox/msg')

  // The same logo excluded from two different emails: one Excluded/ file, two destinations.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  // Same filename, GENUINELY DIFFERENT bytes — must NOT collapse; both kept for review.
  const bannerA = Buffer.alloc(100, 1)
  const bannerB = Buffer.alloc(200, 2)
  const excluded: Excluded[] = [
    { name: 'logo.png', size: png.length, content: png, source: 'Mailbox/message.eml' },
    { name: 'logo.png', size: png.length, content: png, source: 'Mailbox/2026/quarterly.eml' },
    { name: 'contract.pdf', size: 2048, content: Buffer.alloc(2048), source: 'Mailbox/deal.eml' },
    { name: 'banner.png', size: bannerA.length, content: bannerA, source: 'Mailbox/a.eml' },
    { name: 'banner.png', size: bannerB.length, content: bannerB, source: 'Mailbox/b.eml' }
  ]

  log('running writeExcludedFolder…')
  await writeExcludedFolder(outDir, excluded as Parameters<typeof writeExcludedFolder>[1])

  const excludedDir = path.join(outDir, 'Excluded')
  const files = await fs.readdir(excludedDir).catch(() => [] as string[])
  log('Excluded/ contains:', JSON.stringify(files))
  check('logo.png written', files.includes('logo.png'))
  check('contract.pdf written', files.includes('contract.pdf'))
  check('listing spreadsheet written', files.includes('Excluded Attachments.xlsx'))

  let map: Record<string, string[]> = {}
  try {
    map = JSON.parse(await fs.readFile(path.join(excludedDir, '.restore-map.json'), 'utf8'))
  } catch (e) {
    log('FAILED to read .restore-map.json:', (e as Error).message)
  }
  log('.restore-map.json =', JSON.stringify(map))
  check('map has logo.png entry', Array.isArray(map['logo.png']))
  check(
    'logo.png -> both source emails’ produced folders',
    JSON.stringify(map['logo.png']) === JSON.stringify(['Documents/Mailbox/2026/quarterly', 'Documents/Mailbox/message'])
  )
  check('contract.pdf -> its email folder', JSON.stringify(map['contract.pdf']) === JSON.stringify(['Documents/Mailbox/deal']))

  // banner.png had two distinct versions → a folder, both versions inside, tagged by size.
  const bannerDir = path.join(excludedDir, 'banner.png')
  const bannerStat = await fs.stat(bannerDir).catch(() => null)
  check('banner.png is a folder (distinct versions grouped)', !!bannerStat && bannerStat.isDirectory())
  const bannerInner = await fs.readdir(bannerDir).catch(() => [] as string[])
  log('banner.png/ contains:', JSON.stringify(bannerInner))
  check('both distinct versions kept', bannerInner.length === 2)
  check(
    'each version tagged with its byte size',
    bannerInner.some((f) => f.includes('(100 bytes)')) && bannerInner.some((f) => f.includes('(200 bytes)'))
  )
  check('a-version maps to its email folder', JSON.stringify(map['banner (100 bytes).png']) === JSON.stringify(['Documents/Mailbox/a']))
  check('b-version maps to its email folder', JSON.stringify(map['banner (200 bytes).png']) === JSON.stringify(['Documents/Mailbox/b']))

  // sweepStaleOutputs — clears both kinds of cruft an earlier run can leave behind,
  // without touching legitimate output. Layout (all under <out>/Documents):
  //   Mailbox/kept/            ← an email WITH a kept attachment (its own folder)
  //     kept.pdf               (email PDF — keep)
  //     report.pdf  4096       (kept attachment — keep, shares a name with an excluded one)
  //     TPL4AL.pdf  169773     (now-excluded attachment a prior run left here — REMOVE)
  //     _report.pdf 8192       (excluded, collision-prefixed copy — REMOVE)
  //   Mailbox/                 ← shared folder: the email's PDF moved up here after its
  //     gone.pdf               last attachment was excluded (current output — keep)
  //     gone/                  ← the abandoned old folder (orphaned — REMOVE entirely)
  //       gone.pdf  500
  //       TPL4AL.pdf 169773
  const sweepOut = path.join(tmp, 'sweep')
  const keptDir = path.join(sweepOut, 'Documents', 'Mailbox', 'kept')
  const sharedDir = path.join(sweepOut, 'Documents', 'Mailbox')
  const goneDir = path.join(sharedDir, 'gone')
  await fs.mkdir(keptDir, { recursive: true })
  await fs.mkdir(goneDir, { recursive: true })
  await fs.writeFile(path.join(keptDir, 'kept.pdf'), Buffer.alloc(500))
  await fs.writeFile(path.join(keptDir, 'report.pdf'), Buffer.alloc(4096))
  await fs.writeFile(path.join(keptDir, 'TPL4AL.pdf'), Buffer.alloc(169773))
  await fs.writeFile(path.join(keptDir, '_report.pdf'), Buffer.alloc(8192))
  await fs.writeFile(path.join(sharedDir, 'gone.pdf'), Buffer.alloc(300))
  await fs.writeFile(path.join(goneDir, 'gone.pdf'), Buffer.alloc(500))
  await fs.writeFile(path.join(goneDir, 'TPL4AL.pdf'), Buffer.alloc(169773))
  // The current items, each listing exactly the files it wrote into its folder (`files`).
  // Sweep keeps those and removes everything else: the kept email's folder keeps its PDF +
  // the 4096 report attachment (TPL4AL + the collision-prefixed _report go); the relocated
  // email keeps only its PDF in the shared folder, orphaning the old gone/ folder entirely.
  // The family head's fileRel determines the folder swept; `records: [head]` matches the
  // ProdItem shape (head + attachment children) the production now produces.
  const items = [
    { records: [{ fileRel: 'Documents/Mailbox/kept/kept.pdf' }], files: ['kept.pdf', 'report.pdf'] },
    { records: [{ fileRel: 'Documents/Mailbox/gone.pdf' }], files: ['gone.pdf'] }
  ]
  log('running sweepStaleOutputs…')
  await sweepStaleOutputs(sweepOut, items as Parameters<typeof sweepStaleOutputs>[1])
  const keptAfter = (await fs.readdir(keptDir).catch(() => [])).sort()
  const sharedAfter = (await fs.readdir(sharedDir).catch(() => [])).sort()
  log('kept folder after sweep:', JSON.stringify(keptAfter))
  log('shared folder after sweep:', JSON.stringify(sharedAfter))
  check('email PDF kept', keptAfter.includes('kept.pdf'))
  check('kept attachment (same name, different size) survives', keptAfter.includes('report.pdf'))
  check('lingering excluded attachment removed', !keptAfter.includes('TPL4AL.pdf'))
  check('collision-prefixed excluded copy removed', !keptAfter.includes('_report.pdf'))
  check('relocated email PDF in shared folder kept', sharedAfter.includes('gone.pdf'))
  check('abandoned family folder removed entirely', !sharedAfter.includes('gone'))

  // pdfFileName / dedupePdfExt — a source whose name already ends in .pdf must not
  // yield a doubled extension.
  log('pdf naming:')
  check('email named "drawing.pdf" → drawing.pdf (no double)', pdfFileName('drawing.pdf') === 'drawing.pdf')
  check('uppercase .PDF not doubled', pdfFileName('drawing.PDF') === 'drawing.PDF')
  check('normal base gets .pdf', pdfFileName('report') === 'report.pdf')
  check('base ending in other ext keeps it', pdfFileName('data.xls') === 'data.xls.pdf')
  check('dedupe collapses .pdf.pdf', dedupePdfExt('Documents/x/drawing.pdf.pdf') === 'Documents/x/drawing.pdf')
  check('dedupe leaves single .pdf', dedupePdfExt('Documents/x/report.pdf') === 'Documents/x/report.pdf')

  // Inline (cid-referenced) image the user excluded by name must be stripped from the
  // email body — not embedded as a data URI — and set aside in Excluded/. A non-excluded
  // inline image is still embedded normally.
  log('inline excluded image:')
  const exclImg = Buffer.from('EXCLUDED-INLINE-IMAGE-UNIQUE-MARKER-0123456789')
  const keepImg = Buffer.from('KEPT-INLINE-IMAGE-UNIQUE-MARKER-9876543210')
  const inlineMail = {
    html: '<p>before <img src="cid:excl1"> middle <img src="cid:keep1"> after</p>',
    attachments: [
      { filename: 'Screen Shot 2018-05-07 at 9.38.28 AM.png', contentType: 'image/png', content: exclImg, contentId: '<excl1>', contentDisposition: 'inline' },
      { filename: 'photo.png', contentType: 'image/png', content: keepImg, contentId: '<keep1>', contentDisposition: 'inline' }
    ],
    subject: 'demo',
    from: { text: 'a@b.com' },
    to: { text: 'c@d.com' }
  }
  const built = buildEmailHtml(inlineMail as Parameters<typeof buildEmailHtml>[0], {
    excludeShas: new Set([attSha(exclImg)])
  })
  const exclB64 = exclImg.toString('base64')
  const keepB64 = keepImg.toString('base64')
  check('excluded inline image NOT embedded in email body', !built.html.includes(exclB64))
  check('non-excluded inline image still embedded', built.html.includes(keepB64))
  check('excluded inline image set aside for review', built.excludedAttachments.some((a) => /screen shot/i.test(a.filename || '')))
  check('kept inline image not set aside', !built.excludedAttachments.some((a) => a.filename === 'photo.png'))

  // Apple Mail variant: the image is inlined DIRECTLY as a data: URI in the HTML (no cid
  // reference at all). The cid strip can't see it; the data-URI strip must remove it so
  // the excluded image doesn't survive into the combined PDF.
  const dataUriMail = {
    html: `<p>before <img src="data:image/png;base64,${exclB64}"> middle <img src="data:image/png;base64,${keepB64}"> after</p>`,
    attachments: [
      { filename: 'Screen Shot 2018-05-07 at 9.38.28 AM.png', contentType: 'image/png', content: exclImg, contentDisposition: 'inline' },
      { filename: 'photo.png', contentType: 'image/png', content: keepImg, contentDisposition: 'inline' }
    ],
    subject: 'demo2',
    from: { text: 'a@b.com' },
    to: { text: 'c@d.com' }
  }
  const built2 = buildEmailHtml(dataUriMail as Parameters<typeof buildEmailHtml>[0], {
    excludeShas: new Set([attSha(exclImg)])
  })
  check('data-URI-embedded excluded image stripped from body', !built2.html.includes(exclB64))
  check('data-URI-embedded kept image preserved', built2.html.includes(keepB64))

  // ── Full buildProduction over REAL emails (content-based exclusion end-to-end) ──
  // Renders actual PDFs in this Electron process and exercises the new prescan → resolver
  // → render → writeExcludedFolder path. Point DSL_E2E_EML_DIR at a local folder of .eml
  // files to run it; skipped gracefully if unset/missing so the rest of the suite still runs.
  const emlDir = process.env.DSL_E2E_EML_DIR || ''
  const listEml = async (d: string): Promise<string[]> => {
    const out: string[] = []
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) out.push(...(await listEml(p)))
      else if (e.isFile() && e.name.toLowerCase().endsWith('.eml')) out.push(p)
    }
    return out
  }
  const allEml = await listEml(emlDir)
  if (!allEml.length) {
    log(`\nbuildProduction (real emails): SKIPPED — no .eml under ${emlDir} (set DSL_E2E_EML_DIR)`)
  } else {
    log(`\nbuildProduction (real emails): using ${emlDir}`)
    const picked = allEml.slice(0, 30)
    const docs: IndexedDoc[] = []
    for (const p of picked) {
      const st = await fs.stat(p)
      docs.push({
        id: createHash('sha1').update(p).digest('hex').slice(0, 16),
        path: p,
        name: path.basename(p),
        ext: '.eml',
        size: st.size,
        modifiedAt: Math.floor(st.mtimeMs),
        kind: 'email',
        textChars: 0
      })
    }

    // Find a recurring image attachment to drive the manual "exclude similar" test: the
    // image sha that appears in the most of our picked emails, and its name|size pointer.
    const seen = new Map<string, { count: number; name: string; size: number }>()
    for (const p of picked) {
      const mail = await simpleParser(await fs.readFile(p)).catch(() => null)
      if (!mail) continue
      const perEmail = new Set<string>()
      for (const a of mail.attachments || []) {
        if (!(a.contentType || '').startsWith('image/') || !a.content?.length) continue
        const sha = createHash('sha256').update(a.content).digest('hex')
        if (perEmail.has(sha)) continue
        perEmail.add(sha)
        const e = seen.get(sha) || { count: 0, name: (a.filename || '').trim().toLowerCase(), size: a.content.length }
        e.count++
        seen.set(sha, e)
      }
    }
    const top = [...seen.values()].sort((a, b) => b.count - a.count)[0]
    const pointer = top ? `${top.name}|${top.size}` : ''

    const outDir2 = path.join(tmp, 'RealOutput')
    const emit = (_e: IndexEvent): void => {}
    const mkCollection = (over: Partial<Collection>): Collection =>
      ({
        id: 'e2e-real',
        name: 'E2E Real',
        folders: [emlDir],
        output: outDir2,
        createdAt: 0,
        updatedAt: 0,
        fileCount: docs.length,
        status: 'ready',
        aiEnrich: false,
        combineAttachments: false, // each attachment kept as a native file so it's scannable
        features: { emailToPdf: true, reviewIndex: false, loadFile: false, highlights: false, aiEnrich: false },
        ...over
      }) as Collection

    // Run A — auto-logo (excludeSignatures on, exact 3+ small). Renders real PDFs.
    log('  run A: excludeSignatures on…')
    const rA = await buildProduction(mkCollection({ excludeSignatures: true }), docs, emit, () => false)
    log(`  run A → pdfCount=${rA.pdfCount} excludedAttachments=${rA.excludedAttachments} errors=${rA.errors.length}`)
    check('run A produced PDFs for every email', rA.pdfCount === docs.length)
    check('run A rendered without errors', rA.errors.length === 0)
    check('run A set aside auto-detected logos', rA.excludedAttachments > 0)
    const exclA = await fs.readdir(path.join(outDir2, 'Excluded')).catch(() => [] as string[])
    check('run A wrote an Excluded/ folder', exclA.length > 0)
    const docsA = await fs.readdir(path.join(outDir2, 'Documents')).catch(() => [] as string[])
    check('run A wrote a Documents/ folder', docsA.length > 0)

    // Run A′ — re-run unchanged: everything reused, nothing re-rendered (incremental cache).
    log('  run A′: re-run unchanged…')
    const rA2 = await buildProduction(mkCollection({ excludeSignatures: true }), docs, emit, () => false)
    log(`  run A′ → processed=${rA2.processed} skipped=${rA2.skipped}`)
    check('re-run reuses every doc (no re-render)', rA2.processed === 0 && rA2.skipped === docs.length)

    // Run B — manual "exclude similar" (signatures OFF, so the only reason to exclude is the
    // content rule). Proves the perceptual+exact resolver path through a real production.
    if (pointer) {
      log(`  run B: exclude similar to "${top.name}" (recurs in ${top.count} emails)…`)
      const rB = await buildProduction(mkCollection({ excludeSignatures: false, excludeFingerprints: [pointer] }), docs, emit, () => false)
      log(`  run B → excludedAttachments=${rB.excludedAttachments} errors=${rB.errors.length}`)
      check('run B (manual exclude, signatures off) set aside the matched content', rB.excludedAttachments > 0)
      check('run B rendered without errors', rB.errors.length === 0)
      // The excluded image must no longer sit beside any produced email; it's in Excluded/.
      const exclB = await fs.readdir(path.join(outDir2, 'Excluded')).catch(() => [] as string[])
      check('run B Excluded/ folder present', exclB.length > 0)
    } else {
      log('  run B: SKIPPED — no recurring image attachment found in the sample')
    }
  }

  // ── Same filename, DIFFERENT image → only the matching content is excluded ──
  // The whole point of content-based matching: "exclude similar" must key on the image,
  // not the filename. Craft four emails, all using the name "image001.png" or a different
  // name but identical bytes, then exclude ONE image and assert the resolver excludes every
  // copy of THAT image (even under a different name) while leaving a genuinely different
  // image that happens to share the filename untouched.
  log('\nsame-name / different-image exclusion (content-based):')
  const genPng = async (w: number, h: number, fn: (x: number, y: number) => number): Promise<Buffer> => {
    const img = new Jimp({ width: w, height: h, color: 0xffffffff })
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.setPixelColor(fn(x, y) >>> 0, x, y)
    return img.getBuffer('image/png')
  }
  // Use non-monotonic, low-frequency patterns: enough light/dark transitions for a
  // distinctive (non-degenerate) dHash, and smooth enough to survive JPEG re-encoding.
  // logoA and logoB are clearly different patterns AND different dimensions (so their
  // name|size differ too — the realistic case). logoAvariant = logoA re-encoded to JPEG.
  const grey = (v: number): number => {
    const c = Math.max(0, Math.min(255, Math.round(v)))
    return ((c << 24) | (c << 16) | (c << 8) | 0xff) >>> 0
  }
  const logoA = await genPng(64, 64, (x, y) => grey(128 + 100 * Math.sin(x / 5) * Math.cos(y / 7)))
  const logoB = await genPng(96, 40, (x, y) => grey(128 + 110 * Math.sin(x / 3 + 1) * Math.sin(y / 4)))
  const logoAvariant = await (await Jimp.read(logoA)).getBuffer('image/jpeg') // re-encode → similar, different bytes
  const shaA = createHash('sha256').update(logoA).digest('hex')
  const shaB = createHash('sha256').update(logoB).digest('hex')
  log(`  logoA ${logoA.length}B (sha ${shaA.slice(0, 8)}), logoB ${logoB.length}B (sha ${shaB.slice(0, 8)}), logoAvariant ${logoAvariant.length}B`)
  check('crafted images are genuinely different content', shaA !== shaB)

  const makeEml = (subject: string, atts: Array<{ name: string; type: string; buf: Buffer }>): string => {
    const b = 'BOUND' + subject.replace(/\W/g, '')
    let s = `From: a@b.com\r\nTo: c@d.com\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n`
    s += `--${b}\r\nContent-Type: text/html\r\n\r\n<p>body ${subject}</p>\r\n`
    for (const a of atts)
      s += `--${b}\r\nContent-Type: ${a.type}; name="${a.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.name}"\r\n\r\n${a.buf.toString('base64').replace(/(.{76})/g, '$1\r\n')}\r\n`
    s += `--${b}--\r\n`
    return s
  }

  const srcDir = path.join(tmp, 'samename-src')
  await fs.mkdir(srcDir, { recursive: true })
  // msg1: image001.png = logoA (the one we'll target)
  // msg2: image001.png = logoB  (SAME NAME, different image — must be KEPT)
  // msg3: company-logo.png = logoA (DIFFERENT name, same image — must be EXCLUDED)
  // msg4: image001.png = logoAvariant (SAME NAME, re-encoded logoA — perceptual match, EXCLUDED)
  const emls: Array<[string, Array<{ name: string; type: string; buf: Buffer }>]> = [
    ['msg1', [{ name: 'image001.png', type: 'image/png', buf: logoA }]],
    ['msg2', [{ name: 'image001.png', type: 'image/png', buf: logoB }]],
    ['msg3', [{ name: 'company-logo.png', type: 'image/png', buf: logoA }]],
    ['msg4', [{ name: 'image001.png', type: 'image/jpeg', buf: logoAvariant }]]
  ]
  const snDocs: IndexedDoc[] = []
  for (const [name, atts] of emls) {
    const p = path.join(srcDir, name + '.eml')
    await fs.writeFile(p, makeEml(name, atts))
    const st = await fs.stat(p)
    snDocs.push({ id: name, path: p, name: name + '.eml', ext: '.eml', size: st.size, modifiedAt: Math.floor(st.mtimeMs), kind: 'email', textChars: 0 })
  }

  const snOut = path.join(tmp, 'samename-out')
  const emit2 = (_e: IndexEvent): void => {}
  const snCollection = {
    id: 'e2e-samename',
    name: 'samename',
    folders: [srcDir],
    output: snOut,
    createdAt: 0,
    updatedAt: 0,
    fileCount: snDocs.length,
    status: 'ready',
    aiEnrich: false,
    combineAttachments: false, // each attachment kept as a native file so it's scannable
    excludeSignatures: false, // only the manual rule acts
    excludeFingerprints: [`image001.png|${logoA.length}`], // pointer to logoA (msg1)
    features: { emailToPdf: true, reviewIndex: false, loadFile: false, highlights: false, aiEnrich: false }
  } as Collection

  log(`  excluding pointer image001.png|${logoA.length} (= logoA)…`)
  const rSN = await buildProduction(snCollection, snDocs, emit2, () => false)
  log(`  → excludedAttachments=${rSN.excludedAttachments} errors=${rSN.errors.length}`)

  // Collect byte-lengths of every produced attachment (under Documents/) and every excluded
  // one (under Excluded/), so we can assert by CONTENT (size is a proxy here since the three
  // distinct images have distinct sizes).
  const sizesUnder = async (dir: string): Promise<number[]> => {
    const out: number[] = []
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...(await sizesUnder(p)))
      else if (/\.(png|jpe?g)$/i.test(e.name)) out.push((await fs.stat(p)).size)
    }
    return out
  }
  const producedImgSizes = await sizesUnder(path.join(snOut, 'Documents'))
  const excludedImgSizes = await sizesUnder(path.join(snOut, 'Excluded'))
  log(`  produced image sizes: ${JSON.stringify(producedImgSizes)}`)
  log(`  excluded image sizes: ${JSON.stringify(excludedImgSizes)}`)

  check('logoA (targeted) is excluded', excludedImgSizes.includes(logoA.length))
  check('logoA NOT left in the produced output', !producedImgSizes.includes(logoA.length))
  check('logoB (same name "image001.png", DIFFERENT image) is KEPT in produced output', producedImgSizes.includes(logoB.length))
  check('logoB (different image) is NOT excluded', !excludedImgSizes.includes(logoB.length))
  check('logoA under a DIFFERENT name (company-logo.png) is also excluded (content match)', excludedImgSizes.includes(logoA.length))
  check('logoAvariant (same name, re-encoded logoA) is excluded (perceptual match)', excludedImgSizes.includes(logoAvariant.length))
  check('same-name run completed without errors', rSN.errors.length === 0)

  // ── Auto-signature detection by PERCEPTUAL recurrence (re-encoded banner) ──
  // The real-world failure: a covid/email banner recurs across many emails, but the mail
  // client re-encodes it on every send, so no 3 copies are byte-identical. The old sha-only
  // signature rule missed it entirely. Craft one banner, embed a SEPARATELY re-encoded JPEG
  // copy (distinct bytes → distinct sha) in 4 emails, turn signatures ON (no manual rule),
  // and assert every copy is set aside even though none share a sha.
  log('\nauto-signature by perceptual recurrence (re-encoded banner, no byte-identical copies):')
  const banner = await genPng(120, 40, (x, y) => grey(128 + 110 * Math.sin(x / 6) * Math.cos(y / 5)))
  const variants: Buffer[] = []
  for (let i = 0; i < 4; i++) {
    const j = await Jimp.read(banner)
    variants.push(await j.getBuffer('image/jpeg', { quality: 70 + i * 5 })) // each a different encode
  }
  const vShas = new Set(variants.map((b) => createHash('sha256').update(b).digest('hex')))
  check('the 4 banner copies are byte-DISTINCT (old sha rule would miss them)', vShas.size === 4)
  const sigSrc = path.join(tmp, 'sig-src')
  await fs.mkdir(sigSrc, { recursive: true })
  const sigDocs: IndexedDoc[] = []
  for (let i = 0; i < 4; i++) {
    const p = path.join(sigSrc, `sig${i}.eml`)
    await fs.writeFile(p, makeEml(`sig${i}`, [{ name: `banner${i}.jpg`, type: 'image/jpeg', buf: variants[i] }]))
    const st = await fs.stat(p)
    sigDocs.push({ id: 'sig' + i, path: p, name: `sig${i}.eml`, ext: '.eml', size: st.size, modifiedAt: Math.floor(st.mtimeMs), kind: 'email', textChars: 0 })
  }
  const sigOut = path.join(tmp, 'sig-out')
  const sigCollection = {
    id: 'e2e-sig', name: 'sig', folders: [sigSrc], output: sigOut, createdAt: 0, updatedAt: 0,
    fileCount: sigDocs.length, status: 'ready', aiEnrich: false, combineAttachments: false,
    excludeSignatures: true, // signatures ON, NO manual exclude rule
    features: { emailToPdf: true, reviewIndex: false, loadFile: false, highlights: false, aiEnrich: false }
  } as Collection
  const rSig = await buildProduction(sigCollection, sigDocs, (_e: IndexEvent) => {}, () => false)
  log(`  → excludedAttachments=${rSig.excludedAttachments} errors=${rSig.errors.length}`)
  const sigExcluded = await sizesUnder(path.join(sigOut, 'Excluded'))
  const sigProduced = await sizesUnder(path.join(sigOut, 'Documents'))
  log(`  excluded sizes: ${JSON.stringify(sigExcluded)}  produced image sizes: ${JSON.stringify(sigProduced)}`)
  check('all 4 re-encoded banner copies set aside as a signature', rSig.excludedAttachments === 4)
  check('no banner copy left in produced output', sigProduced.length === 0)
  check('signature run completed without errors', rSig.errors.length === 0)

  const ok = checks.every(([, c]) => c)
  log('\n==== RESULT: ' + (ok ? 'PASS' : 'FAIL') + ' ====')
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  app.exit(ok ? 0 : 1)
}

process.on('unhandledRejection', (r) => {
  log('UNHANDLED REJECTION:', String((r as Error)?.stack || r))
  app.exit(1)
})
main().catch((e) => {
  log('main THREW:', (e as Error).stack || String(e))
  app.exit(1)
})
