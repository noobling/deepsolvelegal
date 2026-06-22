import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { Jimp } from 'jimp'
import { writeExcludedFolder } from '../src/main/export/production'

// Build a 64x64 greyscale image from a pixel function, encoded as the given format so we
// can produce byte-distinct-but-visually-identical variants (re-encoding) on demand.
async function img(fn: (x: number, y: number) => number, fmt: 'png' | 'jpeg', quality = 80): Promise<Buffer> {
  const w = 64
  const h = 64
  const im = new Jimp({ width: w, height: h, color: 0x000000ff })
  im.scan(0, 0, w, h, (x, y, idx) => {
    const v = fn(x, y) & 0xff
    im.bitmap.data[idx] = v
    im.bitmap.data[idx + 1] = v
    im.bitmap.data[idx + 2] = v
    im.bitmap.data[idx + 3] = 255
  })
  return fmt === 'png'
    ? await im.getBuffer('image/png')
    : await im.getBuffer('image/jpeg', { quality })
}

const checker = (x: number, y: number): number => (((x >> 3) ^ (y >> 3)) & 1 ? 20 : 235)
const stripes = (x: number, y: number): number => ((x >> 3) & 1 ? 20 : 235)
const diag = (x: number, y: number): number => (((x + y) >> 3) & 1 ? 20 : 235)

const att = (name: string, content: Buffer, source: string) => ({ name, size: content.length, content, source })

async function main(): Promise<void> {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'dsl-grp-'))

  // Banner A — checkerboard, three byte-distinct encodings (re-encoded copies of one image).
  const a1 = await img(checker, 'png')
  const a2 = await img(checker, 'jpeg', 85)
  const a3 = await img(checker, 'jpeg', 60)
  // Banner B — vertical stripes, two byte-distinct encodings. Visually unlike A.
  const b1 = await img(stripes, 'png')
  const b2 = await img(stripes, 'jpeg', 70)
  // Banner C — diagonal, one copy. Its own group.
  const c1 = await img(diag, 'png')
  // Non-image file — its own singleton group.
  const txt = Buffer.from('This is not an image, just some bytes.\n'.repeat(4))
  // Two byte-IDENTICAL copies of a1 from different emails — must collapse to one file.
  const a1dupSrcA = a1
  const a1dupSrcB = Buffer.from(a1) // same bytes, different email source

  const excluded = [
    att('logo.png', a1, 'mail/one.eml'),
    att('header.jpg', a2, 'mail/two.eml'),
    att('banner.jpg', a3, 'mail/three.eml'),
    att('sig.png', b1, 'mail/four.eml'),
    att('sig2.jpg', b2, 'mail/five.eml'),
    att('diagonal.png', c1, 'mail/six.eml'),
    att('readme.txt', txt, 'mail/seven.eml'),
    att('logo.png', a1dupSrcA, 'mail/eight.eml'),
    att('logocopy.png', a1dupSrcB, 'mail/nine.eml')
  ]

  await writeExcludedFolder(out, excluded)

  const dir = path.join(out, 'Excluded')
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const tree: Record<string, string[]> = {}
  for (const f of folders) {
    tree[f] = (await fs.readdir(path.join(dir, f))).sort()
  }
  console.log('--- Excluded/ tree ---')
  console.log(JSON.stringify(tree, null, 2))
  const restoreMap = JSON.parse(await fs.readFile(path.join(dir, '.restore-map.json'), 'utf8'))

  // Assertions ----------------------------------------------------------------
  const fail: string[] = []
  const flat = Object.entries(tree)
  // 1) Banner A: a1/a2/a3 (3 distinct, the two a1 byte-dups collapsed) all in ONE group.
  const aGroup = flat.find(([, files]) => files.some((f) => f.startsWith('logo (')))
  if (!aGroup) fail.push('no group contains logo.png')
  else if (aGroup[1].length !== 3) fail.push(`Banner A group has ${aGroup[1].length} files, expected 3 (a1,a2,a3; byte-dup collapsed)`)
  else if (!(aGroup[1].some((f) => f.startsWith('header (')) && aGroup[1].some((f) => f.startsWith('banner ('))))
    fail.push('Banner A group is missing header.jpg / banner.jpg (re-encoded copies not clustered)')
  // 2) Banner B: b1 + b2 together, separate from A.
  const bGroup = flat.find(([, files]) => files.some((f) => f.startsWith('sig (')))
  if (!bGroup) fail.push('no group contains sig.png')
  else if (bGroup[1].length !== 2) fail.push(`Banner B group has ${bGroup[1].length} files, expected 2`)
  else if (bGroup === aGroup) fail.push('Banner B grouped with Banner A (should be distinct)')
  // 3) Banner C alone.
  const cGroup = flat.find(([, files]) => files.some((f) => f.startsWith('diagonal (')))
  if (!cGroup || cGroup[1].length !== 1) fail.push('Banner C should be a singleton group')
  // 4) Non-image alone.
  const txtGroup = flat.find(([, files]) => files.some((f) => f.startsWith('readme (')))
  if (!txtGroup || txtGroup[1].length !== 1) fail.push('non-image should be a singleton group')
  // 5) Byte-identical a1 copies collapsed: 'logocopy' should NOT appear as its own file.
  const all = Object.values(tree).flat()
  if (all.some((f) => f.startsWith('logocopy ('))) fail.push('byte-identical copy was not collapsed')
  // 6) restore map for the collapsed a1 lists BOTH its source folders.
  const a1Key = Object.keys(restoreMap).find((k) => k.startsWith('logo ('))
  if (!a1Key) fail.push('restore map missing logo entry')
  else if ((restoreMap[a1Key] as string[]).length !== 3)
    fail.push(`collapsed a1 should map to 3 source folders (one.eml, eight.eml, nine.eml), got ${(restoreMap[a1Key] as string[]).length}`)

  console.log('--- restore map (logo) ---', a1Key, restoreMap[a1Key as string])
  console.log('\n--- _grouping-debug.txt ---')
  console.log(await fs.readFile(path.join(dir, '_grouping-debug.txt'), 'utf8'))
  if (fail.length) {
    console.error('\nFAIL:\n' + fail.map((f) => '  ✗ ' + f).join('\n'))
    process.exit(1)
  }
  console.log('\nALL ASSERTIONS PASSED ✓')
  await fs.rm(out, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
