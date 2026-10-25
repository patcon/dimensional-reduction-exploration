import type { ParticleSettings } from '../vizSettings'

// ── Particle physics, as the prototype's (its defaults), in the authoring space's units ──
/** Closer than this, particles push apart whatever their groups. */
const P_R_MIN = 12
const P_DT = 0.5
const P_G = 1.1
/** The centre's reach; beyond it, the boundary pushes particles back. */
const P_S_RMAX = 175
/** Closer to the centre than this, particles are pushed out. */
const P_S_RMIN = 35
const P_S_BWIDTH = 400
const P_S_BG = 20

/**
 * The particle geometry's simulation: positions and velocities, pushed by group forces and, with a speaker
 * there, pulled by the centre according to each particle's valence, and trails recorded as they move.
 *
 * The centre (where the speaker is, when there's one) needn't be the origin: the centre's pull and the boundary act
 * around it, and `recentre` slides the whole field, trails and all, to bring it back to the origin.
 *
 * Particle trails can't be read off the trace, so they're recorded, on the same grid of moments as
 * chord trails: a ring of `trailLength` samples (x, y, valence) per particle, and each sample's grid point.
 */
export class Particles {
  n = 0
  x = new Float32Array(0)
  y = new Float32Array(0)
  /** The centre the speaker's pull and the boundary act around. */
  cx = 0
  cy = 0
  /** Where each particle was before the last step, to draw it partway from there towards where it is now. */
  prevX = new Float32Array(0)
  prevY = new Float32Array(0)
  private vx = new Float32Array(0)
  private vy = new Float32Array(0)
  private ax = new Float32Array(0)
  private ay = new Float32Array(0)
  /** Recorded trail samples: (x, y, valence) for each particle and ring slot. */
  history = new Float32Array(0)
  /** Each ring slot's grid point. */
  readonly grid: Float64Array
  /** The ring slot the next sample goes in. */
  head = 0
  /** Samples recorded, oldest first ending just before `head`. */
  count = 0
  private lastGrid = -Infinity
  private step = 0
  private readonly trailLength: number

  constructor(trailLength: number) {
    this.trailLength = trailLength
    this.grid = new Float64Array(trailLength)
  }

  /** Starts over with n particles, all at the centre. */
  resize(n: number) {
    this.n = n
    ;[this.x, this.y, this.prevX, this.prevY, this.vx, this.vy, this.ax, this.ay] = Array.from({ length: 8 }, () => new Float32Array(n))
    this.history = new Float32Array(n * this.trailLength * 3)
    this.cx = this.cy = 0
    this.clearTrails()
  }

  /**
   * Keeps each particle that's still taking part where it was, moving as it was, trail and all: `from[i]` is new
   * particle i's old index, or −1 for one joining, which starts at the centre (a released speaker, say). With
   * `centreFrom`, the old index of a particle leaving to become the speaker, the centre moves to where it was.
   */
  carryOver(from: Int32Array, centreFrom = -1) {
    if (centreFrom >= 0) { this.cx = this.x[centreFrom]; this.cy = this.y[centreFrom] }
    const old = { x: this.x, y: this.y, prevX: this.prevX, prevY: this.prevY, vx: this.vx, vy: this.vy, history: this.history }
    const n = from.length
    const L = this.trailLength
    this.n = n
    ;[this.x, this.y, this.prevX, this.prevY, this.vx, this.vy, this.ax, this.ay] = Array.from({ length: 8 }, () => new Float32Array(n))
    this.history = new Float32Array(n * L * 3)
    for (let i = 0; i < n; i++) {
      const j = from[i]
      if (j >= 0) {
        this.x[i] = old.x[j]; this.y[i] = old.y[j]
        this.prevX[i] = old.prevX[j]; this.prevY[i] = old.prevY[j]
        this.vx[i] = old.vx[j]; this.vy[i] = old.vy[j]
        this.history.set(old.history.subarray(j * L * 3, (j + 1) * L * 3), i * L * 3)
      } else {
        // Just off the centre, as particles exactly on top of each other don't push apart.
        this.x[i] = this.prevX[i] = this.cx + (Math.random() - 0.5) * 2
        this.y[i] = this.prevY[i] = this.cy + (Math.random() - 0.5) * 2
        for (let k = 0; k < L; k++) this.history.set([this.x[i], this.y[i], 0], (i * L + k) * 3)
      }
    }
  }

  clearTrails() {
    this.count = 0
    this.lastGrid = -Infinity
  }

  /**
   * Scatters particles in a disc (`spread` scales it, as it does the centre's reach), or starts them
   * where the cursors are: `cursors` holds (x, y, z) per particle, and one at the origin is scattered.
   */
  seed(scatter: boolean, spread: number, cursors: Float32Array) {
    for (let i = 0; i < this.n; i++) {
      const cx = cursors[i * 3], cy = cursors[i * 3 + 1]
      if (!scatter && (cx !== 0 || cy !== 0)) { this.x[i] = cx; this.y[i] = cy } else {
        const a = Math.random() * Math.PI * 2, r = Math.random() * P_S_RMAX * spread * 0.55
        this.x[i] = Math.cos(a) * r; this.y[i] = Math.sin(a) * r
      }
      this.vx[i] = 0; this.vy[i] = 0
    }
    this.prevX.set(this.x); this.prevY.set(this.y)
    this.cx = this.cy = 0
    this.clearTrails()
  }

  /** One step of the simulation, with each particle's group and valence now; the centre only pulls with a speaker there. */
  advance(groupOf: Int32Array, valence: Float32Array, ps: ParticleSettings, speaker: boolean) {
    const { n, x: px, y: py, vx, vy, ax, ay } = this
    this.prevX.set(px); this.prevY.set(py)
    ax.fill(0); ay.fill(0)
    const rMax = ps.radius, RR = rMax * rMax
    // Spread scales the centre's reach, so the boundary closes in or opens out with it.
    const sRMax = P_S_RMAX * ps.spread, sRMin = P_S_RMIN * ps.spread
    const S_RR = sRMax * sRMax, S_BRR = (sRMax + P_S_BWIDTH) ** 2
    const sign = ps.reverseCentre ? -1 : 1
    // Pairs: the force is the same both ways, so each pair is visited once.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - px[i], dy = py[j] - py[i]
        const r2 = dx * dx + dy * dy
        if (r2 < 0.01 || r2 > RR) continue
        const r = Math.sqrt(r2)
        const k = groupOf[i] === groupOf[j] ? ps.cohesion : ps.separation
        const f = r < P_R_MIN ? r / P_R_MIN - 1 : k * (1 - r / rMax)
        const inv = (f * P_G) / r
        ax[i] += dx * inv; ay[i] += dy * inv
        ax[j] -= dx * inv; ay[j] -= dy * inv
      }
    }
    for (let i = 0; i < n; i++) {
      const dx = this.cx - px[i], dy = this.cy - py[i]
      const r2 = dx * dx + dy * dy
      if (r2 < 0.01) continue
      const r = Math.sqrt(r2)
      if (r2 <= S_RR) {
        // With no speaker, nothing's at the centre to pull, or to push away up close.
        if (!speaker) continue
        // The speaker pulls in by valence (agreement in, disagreement out, unless reversed), and pushes out up close.
        const f = r < sRMin ? r / sRMin - 1 : sign * valence[i] * (1 - r / sRMax)
        const inv = (f * ps.centreForce) / r
        ax[i] += dx * inv; ay[i] += dy * inv
      } else if (r2 <= S_BRR) {
        // Past the centre's reach, the boundary pushes back.
        const inv = ((r - sRMax) / P_S_BWIDTH) * P_S_BG / r
        ax[i] += dx * inv; ay[i] += dy * inv
      }
    }
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + ax[i] * P_DT) * ps.damping
      vy[i] = (vy[i] + ay[i] * P_DT) * ps.damping
      px[i] += vx[i] * P_DT
      py[i] += vy[i] * P_DT
    }
  }

  /**
   * Slides the whole field, particles, trails and centre together, `rate` of the way to bringing the centre to the
   * origin. Moving everything at once leaves every force as it was, so it's a change of view, not of the simulation.
   */
  recentre(rate: number) {
    if (this.cx === 0 && this.cy === 0) return
    let sx = -this.cx * rate, sy = -this.cy * rate
    if (Math.hypot(this.cx + sx, this.cy + sy) < 0.05) { sx = -this.cx; sy = -this.cy }
    this.cx += sx; this.cy += sy
    for (let i = 0; i < this.n; i++) {
      this.x[i] += sx; this.y[i] += sy
      this.prevX[i] += sx; this.prevY[i] += sy
    }
    for (let o = 0; o < this.history.length; o += 3) { this.history[o] += sx; this.history[o + 1] += sy }
  }

  /** Where particle i is drawn, `t` of the way from before the last step (0) to after it (1), into `out`. */
  shownAt(i: number, t: number, out: number[]) {
    out[0] = this.prevX[i] + (this.x[i] - this.prevX[i]) * t
    out[1] = this.prevY[i] + (this.y[i] - this.prevY[i]) * t
  }

  /**
   * Records a trail sample when `moment` reaches the next grid point (every `step` moments), of where particles are
   * drawn (`t` as for `shownAt`); a jump back starts trails over.
   */
  record(moment: number, step: number, valence: Float32Array, t: number) {
    if (step !== this.step) { this.step = step; this.clearTrails() }
    if (step <= 0) return
    const grid = Math.floor(moment / step)
    if (grid < this.lastGrid) this.clearTrails()
    if (grid === this.lastGrid) return
    this.lastGrid = grid
    const L = this.trailLength
    for (let i = 0; i < this.n; i++) {
      const o = (i * L + this.head) * 3
      this.history[o] = this.prevX[i] + (this.x[i] - this.prevX[i]) * t
      this.history[o + 1] = this.prevY[i] + (this.y[i] - this.prevY[i]) * t
      this.history[o + 2] = valence[i]
    }
    this.grid[this.head] = grid
    this.head = (this.head + 1) % L
    // One sample short of a full trail: the live position is its head.
    this.count = Math.min(this.count + 1, L - 1)
    // Drop samples that have aged off the end.
    while (this.count > 0 && moment / step - this.grid[this.slot(0)] > L - 1) this.count--
  }

  /** The ring slot of the k-th recorded sample, oldest first. */
  slot(k: number) {
    return (this.head - this.count + k + this.trailLength) % this.trailLength
  }
}
