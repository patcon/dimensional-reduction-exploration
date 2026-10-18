import { useEffect, useState } from 'react'

/**
 * How to shuffle each digit's pixel grid before it's laid out along its matrix row: its rows and/or
 * columns (keeping the grid structure), or all pixels at once (`all` overrides the other two).
 */
export type PixelShuffle = { rows: boolean; columns: boolean; all: boolean }

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

const orders = new Map<string, number[]>()

/**
 * pixelOrder[column] = original row-major pixel shown at that column, or null for row-major.
 * Each resolution has its own fixed shuffles, applied after pooling and to every
 * digit alike, so distances between digits (and every projection) are unchanged.
 */
export function pixelOrderFor({ rows, columns, all }: PixelShuffle, side: number): number[] | null {
  if (all) {
    const key = `${side}:all`
    if (!orders.has(key)) orders.set(key, seededPermutation(side * side, side * side))
    return orders.get(key)!
  }
  if (!rows && !columns) return null
  const key = `${side}:${rows}:${columns}`
  if (!orders.has(key)) {
    const identity = Array.from({ length: side }, (_, i) => i)
    // Different seeds so the two axes don't get the same shuffle.
    const rowPerm = rows ? seededPermutation(side, side) : identity
    const colPerm = columns ? seededPermutation(side, side + 1000) : identity
    orders.set(
      key,
      Array.from({ length: side * side }, (_, i) => rowPerm[Math.floor(i / side)] * side + colPerm[i % side]),
    )
  }
  return orders.get(key)!
}

// Keyed by pixel order (each array is cached above, so identity is stable), then image url.
const permutedUrls = new WeakMap<number[], Map<string, Promise<string>>>()

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

/** The matrix image at `url` with its columns rearranged into `pixelOrder` (cached per image and order). */
export function usePermutedImage(url: string, pixelOrder: number[] | null) {
  const [permuted, setPermuted] = useState<{ url: string; order: number[]; src: string } | null>(null)
  useEffect(() => {
    if (!pixelOrder) return
    let cancelled = false
    if (!permutedUrls.has(pixelOrder)) permutedUrls.set(pixelOrder, new Map())
    const cache = permutedUrls.get(pixelOrder)!
    if (!cache.has(url)) cache.set(url, permuteColumns(url, pixelOrder))
    cache.get(url)!.then((src) => !cancelled && setPermuted({ url, order: pixelOrder, src }))
    return () => {
      cancelled = true
    }
  }, [url, pixelOrder])
  if (!pixelOrder) return url
  // Keep showing the original until the permuted copy is ready.
  return permuted?.url === url && permuted.order === pixelOrder ? permuted.src : url
}
