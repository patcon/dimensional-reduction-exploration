/**
 * The force-directed layout, as "Phone-flip crowd"'s: every pair pulls by its similarity (above a floor, squared, and
 * eased towards each new window, so window-to-window noise doesn't read as jitter), normalised by degree so big groups
 * don't become stiff springs; a softened repulsion keeps phones apart, and a gentle pull holds them to the middle.
 * Phones are kept by key, so they keep their places as others join and leave.
 */

import { hash } from './crowd'

export interface LayoutSettings {
  /** Similarity below this pulls not at all. */
  floor: number
  /** How strongly similar phones pull together. */
  pull: number
  /** How strongly every pair pushes apart. */
  push: number
  /** How far each step eases pull strengths towards the latest window's. */
  ease: number
}

export const DEFAULT_LAYOUT: LayoutSettings = { floor: 0.15, pull: 0.3, push: 1, ease: 0.05 }

export class ForceLayout {
  keys: string[] = []
  x = new Float64Array(0)
  y = new Float64Array(0)
  private vx = new Float64Array(0)
  private vy = new Float64Array(0)
  private W: Float32Array | null = null
  private S: Float32Array | null = null

  get n() {
    return this.keys.length
  }

  /** Takes these phones, keeping where those already here are; new ones start scattered round the middle, or near `near`. */
  sync(keys: string[], near?: (key: string) => [number, number] | null) {
    if (keys.length === this.keys.length && keys.every((k, i) => k === this.keys[i])) return false
    const old = new Map(this.keys.map((k, i) => [k, i]))
    const n = keys.length
    const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n)
    keys.forEach((key, i) => {
      const j = old.get(key)
      if (j !== undefined) {
        x[i] = this.x[j]; y[i] = this.y[j]; vx[i] = this.vx[j]; vy[i] = this.vy[j]
        return
      }
      const at = near?.(key)
      const seed = [...key].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)
      const a = 2 * Math.PI * hash(seed, 1, 30), rr = at ? 0.02 : 0.3 + 0.7 * hash(seed, 1, 31)
      x[i] = (at?.[0] ?? 0) + Math.cos(a) * rr
      y[i] = (at?.[1] ?? 0) + Math.sin(a) * rr
    })
    // Pull strengths are per pair: start them afresh from the next window.
    this.keys = keys
    Object.assign(this, { x, y, vx, vy, W: null, S: null })
    return true
  }

  /** The latest window's similarities, n × n, for the phones as they are now. */
  setSimilarity(S: Float32Array) {
    if (S.length === this.n * this.n) this.S = S
  }

  step(P: LayoutSettings) {
    const n = this.n, S = this.S
    if (!S || n === 0) return
    const { x, y, vx, vy } = this
    const target = (q: number) => Math.max(0, (S[q] - P.floor) / (1 - P.floor)) ** 2
    if (!this.W || this.W.length !== n * n) this.W = Float32Array.from({ length: n * n }, (_, q) => target(q))
    const W = this.W
    for (let q = 0; q < n * n; q++) W[q] += (target(q) - W[q]) * P.ease
    const D = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let sum = 1
      for (let j = 0; j < n; j++) if (j !== i) sum += W[i * n + j]
      D[i] = sum
    }
    const fx = new Float64Array(n), fy = new Float64Array(n)
    const KR = (0.01 * P.push) / Math.max(n, 1), SOFT = 0.002, KS = P.pull, KG = 0.01
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy + 1e-9, d = Math.sqrt(d2)
        let f = KR / (d2 + SOFT)
        const w = W[i * n + j]
        if (w > 1e-4) f -= (KS * w * d) / Math.sqrt(D[i] * D[j])
        fx[i] += (f * dx) / d; fy[i] += (f * dy) / d
        fx[j] -= (f * dx) / d; fy[j] -= (f * dy) / d
      }
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + fx[i] - KG * x[i]) * 0.6
      vy[i] = (vy[i] + fy[i] - KG * y[i]) * 0.6
      const sp = Math.hypot(vx[i], vy[i])
      if (sp > 0.01) { vx[i] *= 0.01 / sp; vy[i] *= 0.01 / sp }
      x[i] += vx[i]
      y[i] += vy[i]
    }
  }
}

/**
 * Where the layout is shown: its centre, and how far out it reaches (to the 95th percentile of phones, so one
 * straggler doesn't shrink the rest), eased so the view drifts rather than jumps.
 */
export class LayoutView {
  cx = 0
  cy = 0
  span = 1
  private started = false

  update(x: Float64Array, y: Float64Array, ease = 0.06) {
    const n = x.length
    if (!n) return
    let mx = 0, my = 0
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i] }
    mx /= n; my /= n
    const d = Array.from({ length: n }, (_, i) => Math.hypot(x[i] - mx, y[i] - my)).sort((a, b) => a - b)
    const span = Math.max(0.15, d[Math.min(n - 1, Math.floor(n * 0.95))])
    if (!this.started) {
      Object.assign(this, { cx: mx, cy: my, span, started: true })
      return
    }
    this.cx += (mx - this.cx) * ease
    this.cy += (my - this.cy) * ease
    this.span += (span - this.span) * ease
  }
}
