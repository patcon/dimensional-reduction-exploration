import type { Playhead } from './playhead'
import { N_PIXELS, type Traces } from './signal'

/**
 * A digit as it's read, into `img`: pixels in the trail's window (which, looping, reaches back
 * round to the end) are tinted with `accent`, everything outside it is dimmed, and the pixel being
 * read is the accent.
 */
export function shadeDigit(img: ImageData, pixels: Uint8Array, poolRow: number, traces: Traces, playhead: Playhead, trailPixels: number, accent: number[]) {
  const now = playhead.moment
  const head = Math.round(now)
  for (let p = 0; p < N_PIXELS; p++) {
    const v = pixels[poolRow * N_PIXELS + p]
    const m = traces.momentOf[p]
    const inTrail = m >= 0 && ((m <= now && m >= now - trailPixels) || (playhead.loop && m > now && m >= now - trailPixels + traces.length - 1))
    let rgb = [v, v, v]
    if (inTrail) rgb = rgb.map((c, i) => c * 0.7 + accent[i] * 0.3)
    else rgb = rgb.map((c) => c * 0.45 + 10)
    if (m === head) rgb = accent
    img.data.set([rgb[0], rgb[1], rgb[2], 255], p * 4)
  }
}

/** The accent a canvas is styled with (its CSS `color`), as [r, g, b]. */
export const accentOf = (canvas: HTMLCanvasElement) => getComputedStyle(canvas).color.match(/\d+/g)!.map(Number)
