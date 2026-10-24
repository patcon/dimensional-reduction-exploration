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
 * The particle geometry's simulation: positions and velocities, pushed by group forces and pulled by
 * the centre according to each particle's valence, and trails recorded as they move.
 *
 * Particle trails can't be read off the trace, so they're recorded, on the same grid of moments as
 * chord trails: a ring of `trailLength` samples (x, y, valence) per particle, and each sample's grid point.
 */
export class Particles {
  n = 0
  x = new Float32Array(0)
  y = new Float32Array(0)
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
    ;[this.x, this.y, this.vx, this.vy, this.ax, this.ay] = Array.from({ length: 6 }, () => new Float32Array(n))
    this.history = new Float32Array(n * this.trailLength * 3)
    this.clearTrails()
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
    this.clearTrails()
  }

  /** One step of the simulation, with each particle's group and valence now. */
  advance(groupOf: Int32Array, valence: Float32Array, ps: ParticleSettings) {
    const { n, x: px, y: py, vx, vy, ax, ay } = this
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
      const dx = -px[i], dy = -py[i]
      const r2 = dx * dx + dy * dy
      if (r2 < 0.01) continue
      const r = Math.sqrt(r2)
      if (r2 <= S_RR) {
        // The centre pulls in by valence (ink in, paper out, unless reversed), and pushes out up close.
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

  /** Records a trail sample when `moment` reaches the next grid point (every `step` moments); a jump back starts trails over. */
  record(moment: number, step: number, valence: Float32Array) {
    if (step !== this.step) { this.step = step; this.clearTrails() }
    if (step <= 0) return
    const grid = Math.floor(moment / step)
    if (grid < this.lastGrid) this.clearTrails()
    if (grid === this.lastGrid) return
    this.lastGrid = grid
    const L = this.trailLength
    for (let i = 0; i < this.n; i++) {
      const o = (i * L + this.head) * 3
      this.history[o] = this.x[i]; this.history[o + 1] = this.y[i]; this.history[o + 2] = valence[i]
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
