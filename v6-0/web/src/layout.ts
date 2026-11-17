/**
 * The force-directed layout, as "Phone-flip crowd"'s: every pair pulls by its similarity (above a floor, squared, and
 * eased towards each new window, so window-to-window noise doesn't read as jitter), normalised by degree so big groups
 * don't become stiff springs; a softened repulsion keeps phones apart, and a gentle pull holds them to the middle.
 * Phones are kept by key, so they keep their places as others join and leave.
 *
 * Swarm, the other motion, keeps those forces and makes each phone alive: it swims along a heading of its own that
 * wanders, steers towards the way the phones it's alike are going (as boids align), and takes small kicks, under less
 * damping. A group so stays together, pulled as ever, but roams and churns as one, like a shoal.
 */

import { hash, mulberry32 } from './crowd'

export type LayoutMotion = 'settle' | 'swarm'
export const MOTION_LABELS: Record<LayoutMotion, string> = { settle: 'settle', swarm: 'swarm' }
/** As the button on the drawer's edge names them. */
export const MOTION_TITLES: Record<LayoutMotion, string> = { settle: 'settle into place', swarm: 'swarm' }

export interface LayoutSettings {
  /** Similarity below this pulls not at all. */
  floor: number
  /** How strongly similar phones pull together. */
  pull: number
  /** How strongly every pair pushes apart. */
  push: number
  /** How far each step eases pull strengths towards the latest window's. */
  ease: number
  /** Settle into place, or swarm: see the module's note. */
  motion: LayoutMotion
  /** How lively a swarm is: 1 as made, 0 barely moving, up to 3. */
  energy: number
  /**
   * Let the view zoom in past where unrelated phones settle, to fill the ring with whatever's there. Off, phones
   * coming together are seen to come together, however few: two alone would otherwise always fill the ring.
   */
  zoomIn: boolean
}

export const DEFAULT_LAYOUT: LayoutSettings = { floor: 0.15, pull: 0.3, push: 1, ease: 0.05, motion: 'settle', energy: 1, zoomIn: false }

/** Swarm: how hard a phone swims, how far its heading wanders and turns to its group's each step, and its kicks. */
const SWIM = 0.0015, WANDER = 0.3, ALIGN = 0.003, KICK = 0.0008
/** Swarm: velocity kept from step to step (settling keeps 0.6), and the top speed (settling's is 0.01). */
const SWARM_KEEP = 0.86, SWARM_TOP = 0.006
/** Swarm: how far apart alike phones may be before their pull takes hold (at energy 1). */
const SWARM_ROOM = 0.12


/**
 * How near the view may zoom in: as far out as unrelated phones settle from their middle. Repulsion over gravity puts
 * them at about ∛push from it (being shared among the phones, however many there are), and two alone at exactly
 * half that from their middle; a crowd's 95th percentile sits further out still, so only few phones, or all in one
 * group, are held to it.
 */
export function minViewSpan(P: LayoutSettings) {
  return P.zoomIn ? 0.15 : Math.max(0.15, 0.5 * Math.cbrt(P.push))
}

export class ForceLayout {
  keys: string[] = []
  x = new Float64Array(0)
  y = new Float64Array(0)
  private vx = new Float64Array(0)
  private vy = new Float64Array(0)
  /** Each phone's heading, as it swarms. */
  private th = new Float64Array(0)
  private rng = mulberry32(12345)
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
    const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n), th = new Float64Array(n)
    keys.forEach((key, i) => {
      const j = old.get(key)
      if (j !== undefined) {
        x[i] = this.x[j]; y[i] = this.y[j]; vx[i] = this.vx[j]; vy[i] = this.vy[j]; th[i] = this.th[j]
        return
      }
      const at = near?.(key)
      const seed = [...key].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)
      th[i] = 2 * Math.PI * hash(seed, 1, 32)
      const a = 2 * Math.PI * hash(seed, 1, 30), rr = at ? 0.02 : 0.3 + 0.7 * hash(seed, 1, 31)
      x[i] = (at?.[0] ?? 0) + Math.cos(a) * rr
      y[i] = (at?.[1] ?? 0) + Math.sin(a) * rr
    })
    // Pull strengths are per pair: start them afresh from the next window.
    this.keys = keys
    Object.assign(this, { x, y, vx, vy, th, W: null, S: null })
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
    const swarm = P.motion === 'swarm', E = Math.max(0, P.energy), room = SWARM_ROOM * Math.sqrt(E)
    const KR = (0.01 * P.push) / Math.max(n, 1), SOFT = 0.002, KS = P.pull, KG = 0.01
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy + 1e-9, d = Math.sqrt(d2)
        let f = KR / (d2 + SOFT)
        const w = W[i * n + j]
        // Swarming, the pull takes hold only past some room, so phones swim about freely within their group.
        if (w > 1e-4) f -= (KS * w * (swarm ? Math.max(0, d - room) : d)) / Math.sqrt(D[i] * D[j])
        fx[i] += (f * dx) / d; fy[i] += (f * dy) / d
        fx[j] -= (f * dx) / d; fy[j] -= (f * dy) / d
      }
    if (swarm) this.swim(fx, fy, W, E)
    const keep = swarm ? SWARM_KEEP : 0.6, top = swarm ? SWARM_TOP * Math.max(0.5, E) : 0.01
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + fx[i] - KG * x[i]) * keep
      vy[i] = (vy[i] + fy[i] - KG * y[i]) * keep
      const sp = Math.hypot(vx[i], vy[i])
      if (sp > top) { vx[i] *= top / sp; vy[i] *= top / sp }
      x[i] += vx[i]
      y[i] += vy[i]
    }
  }

  /**
   * Swarming, on top of the forces: each phone's heading wanders, and turns towards the way the phones it's alike (by
   * pull strength, W) are going; it swims along it, and takes a small kick. Energy scales the swimming and kicks, and
   * the wander by its square root, so a lively swarm turns more but not wildly.
   */
  private swim(fx: Float64Array, fy: Float64Array, W: Float32Array, E: number) {
    const n = this.n, { vx, vy, th, rng } = this
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0
      for (let j = 0; j < n; j++) if (j !== i) { const w = W[i * n + j]; ax += w * vx[j]; ay += w * vy[j] }
      let turn = (rng() - 0.5) * WANDER * Math.sqrt(E)
      if (ax * ax + ay * ay > 1e-14) {
        let d = Math.atan2(ay, ax) - th[i]
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
        turn += ALIGN * d
      }
      th[i] += turn
      fx[i] += SWIM * E * Math.cos(th[i]) + KICK * E * (rng() - 0.5)
      fy[i] += SWIM * E * Math.sin(th[i]) + KICK * E * (rng() - 0.5)
    }
  }
}

/**
 * Where the layout is shown: its centre, and how far out it reaches (to the 95th percentile of phones, so one
 * straggler doesn't shrink the rest, and no nearer than `minSpan`), eased so the view drifts rather than jumps.
 */
export class LayoutView {
  cx = 0
  cy = 0
  span = 1
  private started = false

  update(x: Float64Array, y: Float64Array, minSpan = 0.15, ease = 0.06) {
    const n = x.length
    if (!n) return
    let mx = 0, my = 0
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i] }
    mx /= n; my /= n
    const d = Array.from({ length: n }, (_, i) => Math.hypot(x[i] - mx, y[i] - my)).sort((a, b) => a - b)
    const span = Math.max(minSpan, d[Math.min(n - 1, Math.floor(n * 0.95))])
    if (!this.started) {
      Object.assign(this, { cx: mx, cy: my, span, started: true })
      return
    }
    this.cx += (mx - this.cx) * ease
    this.cy += (my - this.cy) * ease
    this.span += (span - this.span) * ease
  }
}
