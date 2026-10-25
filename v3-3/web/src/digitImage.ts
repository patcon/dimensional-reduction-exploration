import type { Playhead } from './playhead'
import { N_PIXELS, type Traces } from './signal'

/**
 * A digit as it's read, into `img`: pixels in the clustering window (which, once playback has looped,
 * reaches back round to the end) are tinted with `accent`, everything outside it is dimmed, and the pixel being
 * read is the accent. With no digit (`poolRow` null), the window shows on a blank square. With `against` (the
 * speaker's row), each pixel is the digit's agreement with it instead, as ink is shown: matching agrees (white),
 * ink against paper disagrees (black).
 */
export function shadeDigit(img: ImageData, pixels: Uint8Array, poolRow: number | null, traces: Traces, playhead: Playhead, windowPixels: number, accent: number[], against: number | null = null) {
  const head = Math.round(playhead.moment)
  const ranges = playhead.windowRanges(windowPixels)
  for (let p = 0; p < N_PIXELS; p++) {
    const v = poolRow === null ? 0 : pixels[poolRow * N_PIXELS + p]
    const m = traces.momentOf[p]
    const inWindow = m >= 0 && ranges.some(([from, to]) => m >= from && m <= to)
    // Agreement runs from black (−1) to white (+1), as ink does from paper to stroke.
    const g = poolRow !== null && against !== null ? 255 - Math.abs(v - pixels[against * N_PIXELS + p]) : v
    let rgb = [g, g, g]
    if (inWindow) rgb = rgb.map((c, i) => c * 0.7 + accent[i] * 0.3)
    else rgb = rgb.map((c) => c * 0.45 + 10)
    if (m === head) rgb = accent
    img.data.set([rgb[0], rgb[1], rgb[2], 255], p * 4)
  }
}

/** The accent a canvas is styled with (its CSS `color`), as [r, g, b]. */
export const accentOf = (canvas: HTMLCanvasElement) => getComputedStyle(canvas).color.match(/\d+/g)!.map(Number)
