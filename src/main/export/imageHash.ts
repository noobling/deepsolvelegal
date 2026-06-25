import { createHash } from 'crypto'
import { Jimp } from 'jimp'

// Content-based identity for attachments. Two layers:
//   - sha256: exact byte identity (any file type). Cheap, used everywhere.
//   - dHash:  perceptual identity for images. Robust to re-encoding/resizing, so two
//             copies of the same logo that a mail client recompressed still match.
// Validated on a real 738-email set: sha256 catches ~640 logos that filename|size misses;
// the perceptual layer consolidates re-encoded variants on top of that.

/** Two dHashes within this many differing bits (of 64) are treated as the same image. */
export const DHASH_THRESHOLD = 8

/** Bump whenever the dHash computation changes (algorithm OR decode tolerance), so the
 *  prescan's cached perceptual hashes are recomputed instead of reused stale. v2 added the
 *  trailing-bytes-after-PNG-IEND recovery below. */
export const DHASH_VERSION = 2

/** A recurring image at or under this size is treated as a signature logo, not a photo. */
export const LOGO_MAX_BYTES = 150 * 1024

// A dHash with very few or very many set bits comes from a near-uniform image (a blank
// spacer, a thin divider rule) — every such image collapses to the same degenerate hash,
// so they would all falsely "match" each other. Refuse to perceptually match those: a
// distinctive image has a healthy mix of light/dark transitions. (Exact sha256 still
// applies to them.) Range chosen so blank/divider images are rejected but real logos,
// even simple monochrome ones, pass.
const MIN_DHASH_BITS = 10
const MAX_DHASH_BITS = 54

/** sha256 of a buffer as a hex string — exact byte identity for any attachment. */
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Popcount of a 64-bit value held in a BigInt. */
function popcount(x: bigint): number {
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

/** Hamming distance between two dHash hex strings (number of differing bits). */
export function hamming(a: string, b: string): number {
  return popcount(BigInt('0x' + a) ^ BigInt('0x' + b))
}

/**
 * 64-bit perceptual difference hash (dHash) of an image buffer, as a 16-char hex string,
 * or null if the image can't be decoded OR is too low-entropy to match reliably (see
 * MIN/MAX_DHASH_BITS). Decode → 9×8 greyscale → compare each pixel to its right neighbour.
 */
/** Some mail clients/editors append stray bytes after a PNG's IEND end-marker; the strict
 *  PNG decoder (pngjs, via Jimp) then refuses an otherwise-valid image ("unrecognised content
 *  at end of stream"). Trim anything past IEND so it decodes. No-op for non-PNG or clean PNGs. */
function trimTrailingAfterPngEnd(buf: Buffer): Buffer {
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return buf // not a PNG
  const i = buf.lastIndexOf('IEND')
  if (i < 0) return buf
  const end = i + 4 + 4 // 'IEND' chunk type (4) + CRC (4)
  return end < buf.length ? buf.subarray(0, end) : buf
}

export async function dHash(buf: Buffer): Promise<string | null> {
  let img: Awaited<ReturnType<typeof Jimp.read>>
  try {
    img = await Jimp.read(buf)
  } catch {
    // Recover the common "trailing bytes after PNG IEND" case before giving up.
    const trimmed = trimTrailingAfterPngEnd(buf)
    if (trimmed.length === buf.length) return null
    try {
      img = await Jimp.read(trimmed)
    } catch {
      return null
    }
  }
  img.resize({ w: 9, h: 8 }).greyscale()
  const { data, width } = img.bitmap // RGBA; greyscale => R==G==B
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[(y * width + x) * 4]
      const right = data[(y * width + x + 1) * 4]
      bits = (bits << 1n) | (left < right ? 1n : 0n)
    }
  }
  const set = popcount(bits)
  if (set < MIN_DHASH_BITS || set > MAX_DHASH_BITS) return null // degenerate / blank
  return bits.toString(16).padStart(16, '0')
}
