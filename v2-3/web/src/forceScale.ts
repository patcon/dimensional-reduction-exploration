/**
 * The bipolar scale each force's control is read on: a control value u in [-1, 1]
 * maps to a signed force multiplier, by default logarithmic in magnitude so one
 * fader reaches both PaCMAP's 1-3 and its 1000, with a deadzone around 0 so the
 * centre of a fader is easy to find.
 */
export interface ForceScale {
  /** Smallest non-zero magnitude, just outside the deadzone. */
  min: number
  /** Magnitude at either end. */
  max: number
  /** |u| at or below this is no force at all. */
  deadzone: number
  /** Logarithmic from min to max, or linear (even steps of force). */
  log: boolean
}

export const DEFAULT_SCALE: ForceScale = { min: 0.1, max: 2000, deadzone: 0.04, log: true }

/**
 * The narrowest scale covering all of these, to graph forces read on different scales together:
 * logarithmic if any of them is.
 */
export function spanning(scales: ForceScale[]): ForceScale {
  return {
    min: Math.min(...scales.map((s) => s.min)),
    max: Math.max(...scales.map((s) => s.max)),
    deadzone: scales[0].deadzone,
    log: scales.some((s) => s.log),
  }
}

export function toMultiplier(u: number, s: ForceScale) {
  const a = Math.min(1, Math.abs(u))
  if (a <= s.deadzone) return 0
  const t = (a - s.deadzone) / (1 - s.deadzone)
  return Math.sign(u) * (s.log ? s.min * (s.max / s.min) ** t : s.min + t * (s.max - s.min))
}

/** The inverse of toMultiplier. Magnitudes beyond the scale clamp to its ends. */
export function toU(m: number, s: ForceScale) {
  if (m === 0) return 0
  const a = Math.min(s.max, Math.max(s.min, Math.abs(m)))
  const t = s.log ? Math.log(a / s.min) / Math.log(s.max / s.min) : (a - s.min) / (s.max - s.min)
  return Math.sign(m) * (s.deadzone + t * (1 - s.deadzone))
}

/** A multiplier for display: signed, with about three significant figures. */
export function formatMultiplier(m: number) {
  if (m === 0) return '0'
  const a = Math.abs(m)
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2
  return `${m > 0 ? '+' : '−'}${a.toFixed(digits)}`
}
