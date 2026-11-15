/**
 * Finding the beat in people's flips. Each live phone's flips are noted as they happen (when it turns over, by the
 * time it last passed edge on), and the base unit is the step they fit best: for each candidate step P, the flips'
 * times are wound round a circle of circumference P, and how tightly they bunch (the length of their mean resultant,
 * 1 for all at one point) says how well they fit a grid of P. A grid of P/2 fits flips on P too, but less tightly (it
 * doubles their jitter), and 2P doesn't fit flips on the steps between, so the best is the base unit. People flipping
 * only every other step (as Slow does) fit twice the step best, so it's folded, halving or doubling, into one range:
 * the song's steps.
 */

/** Steps are folded into [MIN_STEP, MAX_STEP), seconds: 86–171 steps a minute. */
export const MIN_STEP = 0.35
export const MAX_STEP = 0.7
/** Candidate grids, seconds. */
const SEARCH_MIN = 0.25
const SEARCH_MAX = 1.6
const SEARCH_STEP = 0.004
/**
 * Fewest flips to go on, and how tightly the best must bunch to count as a beat: at least MIN_FIT, and more with few
 * flips, as a few flips at random can bunch by chance on some grid (about 1/√n, at most a little over twice that).
 */
const MIN_ONSETS = 8
const MIN_FIT = 0.4
const CHANCE = 2.8

export interface Beat {
  /** The base step, in seconds, folded into [MIN_STEP, MAX_STEP). */
  step: number
  /** Where on it the flips fall: each flip is at this many seconds past a grid point (0 ≤ phase < step). */
  phase: number
  /** How tightly the flips fit the step, 0–1. */
  fit: number
  onsets: number
}

/** How tightly times `ts` bunch on a circle of circumference p: [resultant length, mean angle]. */
function resultant(ts: number[], p: number): [number, number] {
  let c = 0, s = 0
  for (const t of ts) {
    const a = (2 * Math.PI * t) / p
    c += Math.cos(a)
    s += Math.sin(a)
  }
  return [Math.hypot(c, s) / ts.length, Math.atan2(s, c)]
}

/** The beat in flips at times `onsets` (seconds), or null if there aren't enough or they fit no grid. */
export function detectBeat(onsets: number[]): Beat | null {
  if (onsets.length < MIN_ONSETS) return null
  // The step they fit best, folded into the song's range.
  let best = 0, bestP = 0
  for (let p = SEARCH_MIN; p <= SEARCH_MAX; p += SEARCH_STEP) {
    const [r] = resultant(onsets, p)
    if (r > best) { best = r; bestP = p }
  }
  if (best < Math.max(MIN_FIT, CHANCE / Math.sqrt(onsets.length))) return null
  let step = bestP
  while (step >= MAX_STEP) step /= 2
  while (step < MIN_STEP) step *= 2
  const [, angle] = resultant(onsets, step)
  const phase = ((((angle / (2 * Math.PI)) * step) % step) + step) % step
  return { step, phase, fit: best, onsets: onsets.length }
}

/** Facing past this either way counts as turned over; between, it's on its way. */
const HYSTERESIS = 0.3

/**
 * Notes each phone's flips as its readings come in (timed as they arrive, not as frames are drawn): a flip is when it passes HYSTERESIS the other way from where it
 * last was, timed by when it last passed edge on (0). Each flip's time is kept twice: on the wall clock (seconds), to
 * find the step from, and in song time, to see how the song's clock lines up with it.
 */
export class FlipListener {
  onsets: { wall: number; song: number }[] = []
  private state = new Map<number, { side: number; prev: number; prevWall: number; prevSong: number; zeroWall: number; zeroSong: number }>()

  /** A reading of `slot`'s facing, v, at wall time `wall` and song time `song`, as it arrives. */
  reading(slot: number, v: number, wall: number, song: number) {
    let st = this.state.get(slot)
    if (!st) {
      this.state.set(slot, { side: Math.abs(v) >= HYSTERESIS ? Math.sign(v) : 0, prev: v, prevWall: wall, prevSong: song, zeroWall: wall, zeroSong: song })
      return
    }
    if (Math.sign(v) !== Math.sign(st.prev) && v !== st.prev) {
      // Edge on between the last reading and this one: when, in proportion.
      const f = st.prev / (st.prev - v)
      st = { ...st, zeroWall: st.prevWall + (wall - st.prevWall) * f, zeroSong: st.prevSong + (song - st.prevSong) * f }
    }
    if (Math.abs(v) >= HYSTERESIS && Math.sign(v) !== st.side) {
      if (st.side !== 0) this.onsets.push({ wall: st.zeroWall, song: st.zeroSong })
      st = { ...st, side: Math.sign(v) }
    }
    this.state.set(slot, { ...st, prev: v, prevWall: wall, prevSong: song })
  }

  /** Forgets slots not among `slots`, and flips before wall time `before`. */
  forget(slots: readonly number[], before: number) {
    const here = new Set(slots)
    for (const slot of [...this.state.keys()]) if (!here.has(slot)) this.state.delete(slot)
    while (this.onsets.length && this.onsets[0].wall < before) this.onsets.shift()
  }

  /** Readings for every slot here at once (sampled, as by a check), keeping `keep` seconds of flips. */
  hear(slots: readonly number[], valence: Float32Array, wall: number, song: number, keep: number) {
    for (const slot of slots) this.reading(slot, valence[slot] ?? 0, wall, song)
    this.forget(slots, wall - keep)
  }

  clear() {
    this.onsets = []
    this.state.clear()
  }
}
