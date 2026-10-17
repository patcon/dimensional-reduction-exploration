import { useEffect, useState } from 'react'
import { N_PIXELS } from './sweep'

/** How each digit's 784 pixels are laid out along its matrix row (and folded back into 28×28). */
export type PixelOrderKey = 'rowMajor' | 'shuffled'

/** Seeded so the same shuffle is used on every load. */
function seededPermutation(n: number, seed: number) {
  let s = seed >>> 0
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const perm = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  return perm
}

/**
 * pixelOrder[column] = original row-major pixel shown at that column, or null for row-major.
 * One shuffle is applied to every row alike, so distances between digits (and every projection) are unchanged.
 */
export const PIXEL_ORDERS: Record<PixelOrderKey, number[] | null> = {
  rowMajor: null,
  shuffled: seededPermutation(N_PIXELS, 784),
}

const permutedUrls = new Map<string, Promise<string>>()

async function permuteColumns(url: string, pixelOrder: number[]) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  pixelOrder.forEach((src, col) => ctx.drawImage(img, src, 0, 1, img.height, col, 0, 1, img.height))
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)))
  return URL.createObjectURL(blob)
}

/** The matrix image at `url` with its columns rearranged into `pixelOrder` (cached per image). */
export function usePermutedImage(url: string, pixelOrder: number[] | null) {
  const [permuted, setPermuted] = useState<{ url: string; src: string } | null>(null)
  useEffect(() => {
    if (!pixelOrder) return
    let cancelled = false
    if (!permutedUrls.has(url)) permutedUrls.set(url, permuteColumns(url, pixelOrder))
    permutedUrls.get(url)!.then((src) => !cancelled && setPermuted({ url, src }))
    return () => {
      cancelled = true
    }
  }, [url, pixelOrder])
  if (!pixelOrder) return url
  // Keep showing the original until the permuted copy is ready.
  return permuted?.url === url ? permuted.src : url
}
