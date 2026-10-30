/**
 * Each digit read out as a trace over time: its pixels, read row by row, become one
 * value per moment, smoothed, then mapped to valence (−1 disagree … +1 agree). With a speaker, a
 * digit's valence is how far it agrees with the speaker at each pixel, rather than its own ink.
 */

export const SIDE = 28
export const N_PIXELS = SIDE * SIDE

/** A digit's pixels, in the order they're read: row by row, each left to right, as a pen writes. */
const ROWS = Int32Array.from({ length: N_PIXELS }, (_, i) => i)

/** blur: a centred Gaussian. lag: an exponential moving average, which trails the input. */
export type SmoothingKind = 'blur' | 'lag'
/**
 * ink: ink agrees, paper disagrees (−1…+1). ink-only: ink agrees, paper is neutral (0…+1).
 * With a speaker, matching it agrees and differing disagrees instead: −1…+1 for ink, 0…+1 for ink-only.
 */
export type ValenceMapping = 'ink' | 'ink-only'

export interface SignalSettings {
  /** Leave out pixels that are blank in every digit taking part: the dead air at the edges. */
  skipBlank: boolean
  smoothing: SmoothingKind
  /** Gaussian sigma, or the moving average's time constant, in pixels; 0 is none. */
  smoothingPixels: number
  mapping: ValenceMapping
}

export interface Traces {
  /** Participants (digits taking part). */
  n: number
  /** Moments per trace. */
  length: number
  /** pixelAt[t] = the row-major pixel (0–783) read at moment t. */
  pixelAt: Int32Array
  /** momentOf[pixel] = the moment that pixel is read at, or −1 if skipped. */
  momentOf: Int32Array
  /** lineStart[t] = 1 where a new row starts at moment t (on its first pixel read, if blank ones are skipped). */
  lineStart: Uint8Array
  /** n × length ink, 0–1, after smoothing. */
  ink: Float32Array
  /** n × length valence, −1–1. */
  valence: Float32Array
  /** The speaker's ink over time, which valence is agreement with, or null for none. */
  spoken: Float32Array | null
}

function smoothInPlace(row: Float32Array, kind: SmoothingKind, amount: number, scratch: Float32Array) {
  if (amount <= 0) return
  const L = row.length
  if (kind === 'lag') {
    const alpha = 1 - Math.exp(-1 / amount)
    let v = row[0]
    for (let t = 0; t < L; t++) row[t] = v += (row[t] - v) * alpha
    return
  }
  const radius = Math.ceil(amount * 3)
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * amount * amount)))
  for (let t = 0; t < L; t++) {
    let s = 0
    let w = 0
    for (let d = -radius; d <= radius; d++) {
      const u = t + d
      if (u < 0 || u >= L) continue
      s += row[u] * kernel[d + radius]
      w += kernel[d + radius]
    }
    scratch[t] = s / w
  }
  row.set(scratch.subarray(0, L))
}

/**
 * Reads each of `rows` (row indices into `pixels`, N × 784) out as a trace; with `speaker` (a row too), as how far
 * each agrees with it. Rows from `liveFrom` on are participants' drawings, still being drawn: they don't count towards
 * which pixels are blank, and can be read again as they change (see `rereadTraces`).
 */
export function buildTraces(pixels: Uint8Array, rows: number[], settings: SignalSettings, speaker: number | null = null, liveFrom = rows.length): Traces {
  let pixelAt = ROWS
  if (settings.skipBlank) {
    const digits = rows.slice(0, liveFrom)
    const heard = speaker === null ? digits : [...digits, speaker]
    const kept = Array.from(ROWS).filter((p) => heard.some((r) => pixels[r * N_PIXELS + p] > 0))
    // Keep at least something to play, even for an all-blank pick.
    if (kept.length > 1) pixelAt = Int32Array.from(kept)
  }
  const momentOf = new Int32Array(N_PIXELS).fill(-1)
  pixelAt.forEach((p, t) => (momentOf[p] = t))

  const lineStart = Uint8Array.from(pixelAt, (p, t) => (t === 0 || Math.floor(p / SIDE) !== Math.floor(pixelAt[t - 1] / SIDE) ? 1 : 0))

  const n = rows.length
  const L = pixelAt.length
  const traces: Traces = { n, length: L, pixelAt, momentOf, lineStart, ink: new Float32Array(n * L), valence: new Float32Array(n * L), spoken: null }
  if (speaker !== null) readInk(pixels, speaker, traces, settings, (traces.spoken = new Float32Array(L)))
  rereadTraces(traces, pixels, rows, settings, 0)
  return traces
}

/** One row's ink over time, smoothed, into `out`. */
function readInk(pixels: Uint8Array, row: number, traces: Traces, settings: SignalSettings, out: Float32Array, scratch = new Float32Array(traces.length)) {
  for (let t = 0; t < traces.length; t++) out[t] = pixels[row * N_PIXELS + traces.pixelAt[t]] / 255
  smoothInPlace(out, settings.smoothing, settings.smoothingPixels, scratch)
}

/** Reads `rows` from `from` on into `traces` again, in place: participants' drawings, as they're drawn. */
export function rereadTraces(traces: Traces, pixels: Uint8Array, rows: number[], settings: SignalSettings, from: number) {
  const L = traces.length
  const { ink, valence, spoken } = traces
  const scratch = new Float32Array(L)
  for (let i = from; i < traces.n; i++) {
    const row = ink.subarray(i * L, (i + 1) * L)
    readInk(pixels, rows[i], traces, settings, row, scratch)
    for (let t = 0; t < L; t++) {
      // Against a speaker, agreement: 1 where the two match, falling to 0 where one is ink and the other paper.
      const v = spoken ? 1 - Math.abs(row[t] - spoken[t]) : row[t]
      valence[i * L + t] = settings.mapping === 'ink' ? v * 2 - 1 : v
    }
  }
}

/** Participant i's valence at a fractional moment, interpolated between pixels; with `wrap`, moments past either end loop round. */
export function valenceAt(traces: Traces, i: number, moment: number, wrap = false) {
  const L = traces.length
  // Wrapping, as when playback loops: before the start is the end, as the end loops back to the start.
  const t = wrap && L > 1 ? (((moment % (L - 1)) + L - 1) % (L - 1)) : Math.max(0, Math.min(L - 1, moment))
  const t0 = Math.floor(t)
  const t1 = Math.min(L - 1, t0 + 1)
  const f = t - t0
  const base = i * L
  return traces.valence[base + t0] * (1 - f) + traces.valence[base + t1] * f
}
