import type { Playhead } from './playhead'
import { N_PIXELS, type Traces } from './signal'

/**
 * A digit as it's read, into `img`: pixels in the clustering window (which, once playback has looped,
 * reaches back round to the end) are tinted with `accent`, everything outside it is dimmed, and the pixel being
 * read is the accent. With no digit (`poolRow` null), the window shows on a blank square.
 */
export function shadeDigit(img: ImageData, pixels: Uint8Array, poolRow: number | null, traces: Traces, playhead: Playhead, windowPixels: number, accent: number[]) {
  const head = Math.round(playhead.moment)
  const ranges = playhead.windowRanges(windowPixels)
  for (let p = 0; p < N_PIXELS; p++) {
    const v = poolRow === null ? 0 : pixels[poolRow * N_PIXELS + p]
    const m = traces.momentOf[p]
    const inWindow = m >= 0 && ranges.some(([from, to]) => m >= from && m <= to)
    let rgb = [v, v, v]
    if (inWindow) rgb = rgb.map((c, i) => c * 0.7 + accent[i] * 0.3)
    else rgb = rgb.map((c) => c * 0.45 + 10)
    if (m === head) rgb = accent
    img.data.set([rgb[0], rgb[1], rgb[2], 255], p * 4)
  }
}

/** The accent a canvas is styled with (its CSS `color`), as [r, g, b]. */
export const accentOf = (canvas: HTMLCanvasElement) => getComputedStyle(canvas).color.match(/\d+/g)!.map(Number)
