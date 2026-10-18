import { useEffect, useState } from 'react'
import { GREYSCALE, type PixelTheme } from './pixelTheme'

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

// Stands in for "columns in row-major order" as a cache key.
const ROW_MAJOR: number[] = []
// Keyed by pixel order (each array is cached above, so identity is stable), then theme, then image url.
const matrixUrls = new WeakMap<number[], WeakMap<PixelTheme, Map<string, Promise<string>>>>()

async function renderMatrix(url: string, pixelOrder: number[] | null, theme: PixelTheme) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  if (pixelOrder) pixelOrder.forEach((src, col) => ctx.drawImage(img, src, 0, 1, img.height, col, 0, 1, img.height))
  else ctx.drawImage(img, 0, 0)
  if (theme !== GREYSCALE) {
    const pixels = ctx.getImageData(0, 0, img.width, img.height)
    const d = pixels.data
    for (let i = 0; i < d.length; i += 4) d.set(theme.shade(d[i]), i)
    ctx.putImageData(pixels, 0, 0)
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)))
  return URL.createObjectURL(blob)
}

/** The matrix image at `url` with its columns rearranged into `pixelOrder` and shaded by `theme` (cached). */
export function useMatrixImage(url: string, pixelOrder: number[] | null, theme: PixelTheme) {
  const [rendered, setRendered] = useState<{ url: string; order: number[] | null; theme: PixelTheme; src: string } | null>(null)
  const unchanged = !pixelOrder && theme === GREYSCALE
  useEffect(() => {
    if (unchanged) return
    let cancelled = false
    const key = pixelOrder ?? ROW_MAJOR
    if (!matrixUrls.has(key)) matrixUrls.set(key, new WeakMap())
    const byTheme = matrixUrls.get(key)!
    if (!byTheme.has(theme)) byTheme.set(theme, new Map())
    const cache = byTheme.get(theme)!
    if (!cache.has(url)) cache.set(url, renderMatrix(url, pixelOrder, theme))
    cache.get(url)!.then((src) => !cancelled && setRendered({ url, order: pixelOrder, theme, src }))
    return () => {
      cancelled = true
    }
  }, [url, pixelOrder, theme, unchanged])
  if (unchanged) return url
  // Keep showing the original until the rendered copy is ready.
  return rendered?.url === url && rendered.order === pixelOrder && rendered.theme === theme ? rendered.src : url
}
