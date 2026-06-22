// Validates the NEW content-based resolver (production.ts resolveExclusions) against the
// real APE set, mirroring its exact logic so we can confirm the rules behave on real data
// before trusting the Electron integration:
//   - auto-logo:  sha256 that recurs in >=3 distinct emails AND is an image AND <=150 KB
//   - exclude similar (manual): pick an attachment -> exclude every byte-identical copy
//     (sha) + every perceptually-similar image (dHash, Hamming <= 8)
//
// Usage: node scripts/image-similarity-resolver-check.mjs "/path/to/eml/folder"

import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { simpleParser } from 'mailparser'
import { Jimp } from 'jimp'

const ROOT = process.argv[2] || '/Users/davidyu/Downloads/sample-emails'
const MIN_RECURRENCE = 3
const LOGO_MAX_BYTES = 150 * 1024
const DHASH_THRESHOLD = 8
const MIN_DHASH_BITS = 10
const MAX_DHASH_BITS = 54

async function walk(dir) {
  const out = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (e.isFile() && e.name.toLowerCase().endsWith('.eml')) out.push(p)
  }
  return out
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const popcount = (x) => {
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}
const hamming = (a, b) => popcount(BigInt('0x' + a) ^ BigInt('0x' + b))
async function dHash(buf) {
  let img
  try {
    img = await Jimp.read(buf)
  } catch {
    return null
  }
  img.resize({ w: 9, h: 8 }).greyscale()
  const { data, width } = img.bitmap
  let bits = 0n
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const l = data[(y * width + x) * 4]
      const r = data[(y * width + x + 1) * 4]
      bits = (bits << 1n) | (l < r ? 1n : 0n)
    }
  const set = popcount(bits)
  if (set < MIN_DHASH_BITS || set > MAX_DHASH_BITS) return null
  return bits.toString(16).padStart(16, '0')
}

const files = await walk(ROOT)
console.log(`Resolver check over ${files.length} emails\n`)

// Hash every attachment (sha always; dhash for images — this run computes it since we
// simulate a manual image exclude below).
const atts = [] // { docId, name, size, sha, dhash, img }
let next = 0
const worker = async () => {
  for (;;) {
    const i = next++
    if (i >= files.length) return
    try {
      const mail = await simpleParser(await fs.readFile(files[i]))
      for (const a of mail.attachments || []) {
        const buf = a.content
        if (!buf?.length) continue
        const img = (a.contentType || '').startsWith('image/')
        atts.push({ docId: i, name: (a.filename || '').trim().toLowerCase(), size: buf.length, sha: sha256(buf), dhash: img ? await dHash(buf) : null, img })
      }
    } catch {
      /* skip */
    }
  }
}
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length || 4) }, () => worker()))

// emailsOf: distinct emails per sha
const emailsOf = new Map()
for (const a of atts) {
  if (!emailsOf.has(a.sha)) emailsOf.set(a.sha, new Set())
  emailsOf.get(a.sha).add(a.docId)
}

// ---- auto-logo rule ----
const autoLogo = new Set()
for (const [sha, set] of emailsOf) {
  if (set.size < MIN_RECURRENCE) continue
  const rep = atts.find((a) => a.sha === sha)
  if (rep && rep.img && rep.size <= LOGO_MAX_BYTES) autoLogo.add(sha)
}
const autoFlaggedInstances = atts.filter((a) => autoLogo.has(a.sha)).length
console.log('== Auto-logo (sha recurs >=3 AND image AND <=150KB) ==')
console.log(`  logo identities: ${autoLogo.size}`)
console.log(`  attachment instances excluded: ${autoFlaggedInstances}`)
const topLogos = [...autoLogo].map((sha) => ({ sha, emails: emailsOf.get(sha).size, rep: atts.find((a) => a.sha === sha) })).sort((a, b) => b.emails - a.emails)
for (const t of topLogos.slice(0, 8)) console.log(`    ${String(t.emails).padStart(3)} emails  ${(t.rep.name || '(no name)').padEnd(28)} ${(t.rep.size / 1024).toFixed(1)}KB`)

// what recurring content does the size cap EXCLUDE from logo treatment? (sanity: big recurring images kept)
const recurringImgsOverCap = [...emailsOf.entries()].filter(([sha, s]) => s.size >= MIN_RECURRENCE).map(([sha]) => atts.find((a) => a.sha === sha)).filter((r) => r && r.img && r.size > LOGO_MAX_BYTES)
console.log(`  recurring images OVER 150KB (kept, not treated as logos): ${recurringImgsOverCap.length}`)

// ---- manual "exclude similar" simulation ----
// Pick the most-recurring decodable image as the reference (a realistic "user excludes a logo").
const refSha = topLogos.find((t) => t.rep.dhash)?.sha
if (refSha) {
  const refs = atts.filter((a) => a.sha === refSha)
  const refDhashes = [...new Set(refs.map((a) => a.dhash).filter(Boolean))]
  const exclude = new Set()
  for (const a of refs) exclude.add(a.sha) // exact
  let perceptualAdds = 0
  for (const a of atts) {
    if (exclude.has(a.sha)) continue
    if (a.dhash && refDhashes.some((r) => hamming(a.dhash, r) <= DHASH_THRESHOLD)) {
      exclude.add(a.sha)
      perceptualAdds++
    }
  }
  const instances = atts.filter((a) => exclude.has(a.sha))
  const names = new Set(instances.map((a) => a.name))
  const sizes = new Set(instances.map((a) => a.size))
  const ref = refs[0]
  console.log(`\n== Manual "exclude similar" on: ${ref.name} (${(ref.size / 1024).toFixed(1)}KB) ==`)
  console.log(`  distinct sha matched: ${exclude.size}  (1 exact + ${perceptualAdds} perceptual neighbours)`)
  console.log(`  attachment instances excluded: ${instances.length}`)
  console.log(`  spanning ${names.size} distinct filenames and ${sizes.size} distinct byte-sizes`)
  console.log(`  -> one click removes ${names.size} filename variants the old name|size rule would have treated as separate`)
}
