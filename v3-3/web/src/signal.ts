/**
 * Each digit read out as a trace over time: its pixels, in some reading order, become one
 * value per moment, smoothed, then mapped to valence (−1 disagree … +1 agree). With a speaker, a
 * digit's valence is how far it agrees with the speaker at each pixel, rather than its own ink.
 */

export const SIDE = 28
export const N_PIXELS = SIDE * SIDE

/** The order a digit's pixels are read in. */
export type ReadingKey = 'rows' | 'snake' | 'columns' | 'spiral' | 'hilbert'

export const READING_LABELS: Record<ReadingKey, string> = {
  rows: 'rows',
  snake: 'snake',
  columns: 'columns',
  spiral: 'spiral',
  hilbert: 'Hilbert',
}

function rowsOrder() {
  return Int32Array.from({ length: N_PIXELS }, (_, i) => i)
}

/** Rows, alternating direction, so consecutive pixels always touch. */
function snakeOrder() {
  const order = new Int32Array(N_PIXELS)
  for (let r = 0; r < SIDE; r++)
    for (let c = 0; c < SIDE; c++) order[r * SIDE + c] = r * SIDE + (r % 2 ? SIDE - 1 - c : c)
  return order
}

function columnsOrder() {
  const order = new Int32Array(N_PIXELS)
  for (let c = 0; c < SIDE; c++) for (let r = 0; r < SIDE; r++) order[c * SIDE + r] = r * SIDE + c
  return order
}

/** Clockwise from the top-left corner, inwards: the blank border first, the middle of the digit last. */
function spiralOrder() {
  const order: number[] = []
  let top = 0
  let bottom = SIDE - 1
  let left = 0
  let right = SIDE - 1
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) order.push(top * SIDE + c)
    for (let r = top + 1; r <= bottom; r++) order.push(r * SIDE + right)
    if (top < bottom) for (let c = right - 1; c >= left; c--) order.push(bottom * SIDE + c)
    if (left < right) for (let r = bottom - 1; r > top; r--) order.push(r * SIDE + left)
    top++
    bottom--
    left++
    right--
  }
  return Int32Array.from(order)
}

/** A Hilbert curve over 32×32 with the digit centred in it: nearby moments are nearby pixels, in both directions. */
function hilbertOrder() {
  const n = 32
  const pad = (n - SIDE) / 2
  const order: number[] = []
  for (let d = 0; d < n * n; d++) {
    let x = 0
    let y = 0
    let t = d
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t / 2)
      const ry = 1 & (t ^ rx)
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x
          y = s - 1 - y
        }
        ;[x, y] = [y, x]
      }
      x += s * rx
      y += s * ry
      t = Math.floor(t / 4)
    }
    const c = x - pad
    const r = y - pad
    if (c >= 0 && c < SIDE && r >= 0 && r < SIDE) order.push(r * SIDE + c)
  }
  return Int32Array.from(order)
}

export const READINGS: Record<ReadingKey, Int32Array> = {
  rows: rowsOrder(),
  snake: snakeOrder(),
  columns: columnsOrder(),
  spiral: spiralOrder(),
  hilbert: hilbertOrder(),
}

/** blur: a centred Gaussian. lag: an exponential moving average, which trails the input. */
export type SmoothingKind = 'blur' | 'lag'
/**
 * ink: ink agrees, paper disagrees (−1…+1). ink-only: ink agrees, paper is neutral (0…+1).
 * With a speaker, matching it agrees and differing disagrees instead: −1…+1 for ink, 0…+1 for ink-only.
 */
export type ValenceMapping = 'ink' | 'ink-only'

export interface SignalSettings {
  reading: ReadingKey
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
  /** n × length ink, 0–1, after smoothing. */
  ink: Float32Array
  /** n × length valence, −1–1. */
  valence: Float32Array
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
 * each agrees with it.
 */
export function buildTraces(pixels: Uint8Array, rows: number[], settings: SignalSettings, speaker: number | null = null): Traces {
  const reading = READINGS[settings.reading]
  let pixelAt = reading
  if (settings.skipBlank) {
    const heard = speaker === null ? rows : [...rows, speaker]
    const kept = Array.from(reading).filter((p) => heard.some((r) => pixels[r * N_PIXELS + p] > 0))
    // Keep at least something to play, even for an all-blank pick.
    if (kept.length > 1) pixelAt = Int32Array.from(kept)
  }
  const momentOf = new Int32Array(N_PIXELS).fill(-1)
  pixelAt.forEach((p, t) => (momentOf[p] = t))

  const n = rows.length
  const L = pixelAt.length
  const ink = new Float32Array(n * L)
  const valence = new Float32Array(n * L)
  const scratch = new Float32Array(L)
  const read = (r: number, row: Float32Array) => {
    for (let t = 0; t < L; t++) row[t] = pixels[r * N_PIXELS + pixelAt[t]] / 255
    smoothInPlace(row, settings.smoothing, settings.smoothingPixels, scratch)
  }
  let spoken: Float32Array | null = null
  if (speaker !== null) read(speaker, (spoken = new Float32Array(L)))
  rows.forEach((r, i) => {
    const row = ink.subarray(i * L, (i + 1) * L)
    read(r, row)
    for (let t = 0; t < L; t++) {
      // Against a speaker, agreement: 1 where the two match, falling to 0 where one is ink and the other paper.
      const v = spoken ? 1 - Math.abs(row[t] - spoken[t]) : row[t]
      valence[i * L + t] = settings.mapping === 'ink' ? v * 2 - 1 : v
    }
  })
  return { n, length: L, pixelAt, momentOf, ink, valence }
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
