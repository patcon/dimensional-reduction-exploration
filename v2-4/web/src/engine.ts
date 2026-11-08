import type { Optimiser } from './optimisers.ts'
import { PAIR_TYPES, type Pairs, type PairType, type Weights } from './types.ts'

/**
 * Each pair type's kernel is PaCMAP's, with the sign pulled out into the multiplier:
 * for a pair (i, j) with dd = 1 + |yi - yj|², the force coefficient is
 *   c = multiplier · 2A / (A + dd)²
 * so grad_i += c·(yi - yj) and a positive multiplier attracts. A is the kernel's scale:
 * PaCMAP's neighbour (A = 10) and mid-near (A = 10000) losses, and its far-pair loss
 * 1/(1 + dd) is the same form with A = 1 once its sign moves into the multiplier.
 */
export const KERNEL_SCALE: Record<PairType, number> = { nb: 10, mn: 10000, fp: 1 }

/** How many random draws LocalMAP makes for one far pair before keeping the old one (pacmap.sample_FP_nearby). */
const MAX_TRIES = 100

/**
 * Around a point with at most this many points in the cells about it, the redraw lists the ones it may
 * pick and picks from the list, rather than drawing and rejecting (slow where most are its neighbours).
 */
const LIST_UP_TO = 256

/** The seed the far-pair draws start from, on every reset, so a run repeats. */
const SEED = 0

/** mulberry32: a small, fast, seedable PRNG, returning floats in [0, 1). */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cells per axis at most, so a cell's key fits a float exactly even in 3D. */
const MAX_CELLS_PER_AXIS = 2 ** 17

/**
 * The points bucketed into square (cubic, in 3D) cells at least `size` wide, to draw from the cells
 * around a point: they cover every point within `size` of it.
 */
class Grid {
  /** Point indices, sorted by cell. */
  private readonly order: Uint32Array
  /** Each occupied cell's key, ascending, and where its points start and end in `order`. */
  private readonly keys: Float64Array
  private readonly starts: Uint32Array
  private readonly ends: Uint32Array
  private readonly cellOf: Float64Array
  private readonly span: number[]
  private readonly offsets: number[] = []
  /** The cells around the last point asked about: where each starts in `order`, and the running count. */
  private readonly from: number[] = []
  private readonly upTo: number[] = []

  constructor(Y: Float32Array, n: number, dim: number, size: number) {
    const lo = Array<number>(dim).fill(Infinity)
    const hi = Array<number>(dim).fill(-Infinity)
    for (let i = 0; i < n; i++)
      for (let d = 0; d < dim; d++) {
        lo[d] = Math.min(lo[d], Y[i * dim + d])
        hi[d] = Math.max(hi[d], Y[i * dim + d])
      }
    // Wider cells, if need be, to keep the count per axis in range: they still cover `size` around a point.
    let cell = size
    for (let d = 0; d < dim; d++) cell = Math.max(cell, (hi[d] - lo[d]) / (MAX_CELLS_PER_AXIS - 3))
    // One empty cell of margin each side, so the cells around a point never wrap into another row.
    this.span = lo.map((l, d) => Math.floor((hi[d] - l) / cell) + 3)
    this.cellOf = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let key = 0
      for (let d = 0; d < dim; d++) key = key * this.span[d] + Math.floor((Y[i * dim + d] - lo[d]) / cell) + 1
      this.cellOf[i] = key
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.cellOf[a] - this.cellOf[b])
    this.order = Uint32Array.from(order)
    const keys: number[] = []
    const starts: number[] = []
    const ends: number[] = []
    for (let t = 0; t < n; t++) {
      const key = this.cellOf[order[t]]
      if (keys.length && keys[keys.length - 1] === key) ends[ends.length - 1] = t + 1
      else {
        keys.push(key)
        starts.push(t)
        ends.push(t + 1)
      }
    }
    this.keys = Float64Array.from(keys)
    this.starts = Uint32Array.from(starts)
    this.ends = Uint32Array.from(ends)
    // The key steps to each of the 3^dim cells around one.
    const steps = this.span.map((_, d) => this.span.slice(d + 1).reduce((a, b) => a * b, 1))
    const walk = (d: number, offset: number) => {
      if (d === dim) this.offsets.push(offset)
      else for (const o of [-1, 0, 1]) walk(d + 1, offset + o * steps[d])
    }
    walk(0, 0)
  }

  /** The occupied cell with this key, or -1. */
  private find(key: number) {
    let a = 0
    let b = this.keys.length - 1
    while (a <= b) {
      const m = (a + b) >> 1
      if (this.keys[m] < key) a = m + 1
      else if (this.keys[m] > key) b = m - 1
      else return m
    }
    return -1
  }

  /** Gathers the cells around point i, for pick(), and returns how many points they hold (i among them). */
  around(i: number) {
    this.from.length = 0
    this.upTo.length = 0
    let total = 0
    for (const offset of this.offsets) {
      const c = this.find(this.cellOf[i] + offset)
      if (c === -1) continue
      this.from.push(this.starts[c])
      total += this.ends[c] - this.starts[c]
      this.upTo.push(total)
    }
    return total
  }

  /** The r-th point (0-based) in the cells around() last gathered. */
  pick(r: number) {
    // The first cell whose running count passes r.
    let c = 0
    for (let b = this.upTo.length - 1; c < b; ) {
      const m = (c + b) >> 1
      if (r < this.upTo[m]) b = m
      else c = m + 1
    }
    return this.order[this.from[c] + r - (c ? this.upTo[c - 1] : 0)]
  }
}

/** What a far-pair redraw did: how many pairs it moved, how many it kept (no point near enough was found), and how long it took. */
export interface Resample {
  resampled: number
  kept: number
  ms: number
}

/**
 * PaCMAP's optimisation, one step at a time with live weights: the gradient is computed here, and a
 * swappable optimiser turns it into a step. Runs in 2D or 3D (`dim`). Float32 storage throughout,
 * like pacmap's numba kernels.
 *
 * With LocalMAP's two additions, each played separately: its far pairs can be redrawn from the points
 * near each one in the current layout (resampleFar) and put back (restoreFar), and its neighbours'
 * force can be boosted where they're close (boost).
 */
export class Engine {
  readonly n: number
  /** 2 or 3. */
  readonly dim: number
  /** The pairs stepped on: the neighbour and mid-near pairs as loaded, and the far pairs, global or redrawn. */
  readonly pairs: Pairs
  /** The far pairs as loaded (PaCMAP's, global), to put back. */
  readonly globalFp: Uint32Array
  /** Bumped whenever the far pairs change. */
  fpVersion = 0
  /** Whether the far pairs are the global ones. */
  fpGlobal = true
  /**
   * LocalMAP's neighbour boost, or null for PaCMAP's kernel: each neighbour pair's force is scaled by
   * boost / sqrt(1 + |yi - yj|²), so close neighbours pull harder. LocalMAP's boost is its threshold / 2.
   */
  boost: number | null = null
  readonly init: Float32Array
  /** Current layout, n x dim row-major. Mutated in place by step(). */
  readonly Y: Float32Array
  readonly grad: Float32Array
  optimiser: Optimiser
  /** Scales the optimiser's learning rate (the speed control); 1 is PaCMAP's. */
  speed = 1
  /** Steps taken since the last reset. */
  steps = 0
  private random = mulberry32(SEED)

  constructor(pairs: Pairs, init: Float32Array, optimiser: Optimiser, dim = 2) {
    this.dim = dim
    this.n = init.length / dim
    // Own far pairs, as they're redrawn in place; `pairs` is shared with other engines (the other dimension).
    this.pairs = { ...pairs, fp: new Uint32Array(pairs.fp) }
    this.globalFp = pairs.fp
    this.init = init
    this.optimiser = optimiser
    this.Y = new Float32Array(init)
    this.grad = new Float32Array(init.length)
  }

  /** Back to the start: the initial layout, the global far pairs, no boost, and the far-pair draws from their seed. */
  reset() {
    this.Y.set(this.init)
    this.optimiser.reset()
    this.steps = 0
    this.boost = null
    this.random = mulberry32(SEED)
    this.restoreFar()
  }

  /** Puts PaCMAP's global far pairs back. */
  restoreFar() {
    if (this.fpGlobal) return
    this.pairs.fp.set(this.globalFp)
    this.fpGlobal = true
    this.fpVersion++
  }

  /**
   * LocalMAP's far-pair redraw (pacmap.sample_FP_pair_nearby): each point's far pairs are drawn again,
   * uniformly from the points within `thres` of it in the current layout that aren't itself, one of its
   * neighbours, or a partner already drawn this time. A pair that finds none in MAX_TRIES draws keeps its
   * old partner. Assumes, as PaCMAP does, that the neighbour and far pairs are grouped by their first
   * point, a fixed number each.
   *
   * PaCMAP draws from all the points and rejects the far ones, without counting those against its 100
   * tries, so where few points are near it can draw thousands of times per pair (seconds at 10k digits,
   * minutes at 65k). Here draws come from the grid cells around the point (a cell is `thres` wide, so they
   * cover everything within it), and every draw counts. That picks from the same points, uniformly, and
   * stays fast however spread the layout is; it only gives up sooner where PaCMAP would grind on. Where the
   * cells hold few points (LIST_UP_TO), it lists those it may pick and picks from the list without
   * repeats, as the draws would, in one pass.
   * scripts/check-localmap.ts compares the two.
   */
  resampleFar(thres: number): Resample {
    const start = performance.now()
    const { n, dim, Y, random } = this
    const nb = this.pairs.nb
    const fp = this.pairs.fp
    const nbPer = nb.length / 2 / n
    const fpPer = fp.length / 2 / n
    const thres2 = thres * thres
    const grid = new Grid(Y, n, dim, thres)
    const list = new Int32Array(LIST_UP_TO)
    // Points point i may not pick: itself, its neighbours, and partners already drawn for it, marked with i.
    const barred = new Int32Array(n).fill(-1)
    const near = (i: number, c: number) => {
      let d2 = 0
      for (let d = 0; d < dim; d++) {
        const delta = Y[i * dim + d] - Y[c * dim + d]
        d2 += delta * delta
      }
      return d2 <= thres2
    }
    let resampled = 0
    let kept = 0
    for (let i = 0; i < n; i++) {
      const pool = grid.around(i)
      barred[i] = i
      for (let q = 0, from = i * nbPer * 2; q < nbPer; q++) barred[nb[from + q * 2 + 1]] = i
      // Few points about: list those it may pick, then pick without repeats (a partial shuffle).
      let listed = -1
      if (pool <= LIST_UP_TO) {
        listed = 0
        for (let r = 0; r < pool; r++) {
          const c = grid.pick(r)
          if (barred[c] !== i && near(i, c)) list[listed++] = c
        }
      }
      for (let k = 0; k < fpPer; k++) {
        let j = -1
        if (listed >= 0) {
          if (k < listed) {
            const r = k + Math.floor(random() * (listed - k))
            j = list[r]
            list[r] = list[k]
            list[k] = j
          }
        } else
          for (let tries = 0; tries < MAX_TRIES; tries++) {
            const c = grid.pick(Math.floor(random() * pool))
            if (barred[c] === i || !near(i, c)) continue
            j = c
            barred[c] = i
            break
          }
        const slot = (i * fpPer + k) * 2
        fp[slot] = i
        if (j === -1) kept++
        else {
          fp[slot + 1] = j
          resampled++
        }
      }
    }
    this.fpGlobal = false
    this.fpVersion++
    return { resampled, kept, ms: performance.now() - start }
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  /** LocalMAP's neighbour boost (its threshold / 2), or null for PaCMAP's kernel. */
  setBoost(boost: number | null) {
    this.boost = boost
  }

  /** Swap optimisers mid-run: the layout stays, the new optimiser starts fresh. */
  setOptimiser(optimiser: Optimiser) {
    optimiser.reset()
    this.optimiser = optimiser
  }

  /** Accumulate every pair's force into this.grad. Pair types with a zero multiplier are skipped. */
  gradient(w: Weights) {
    const { Y, grad } = this
    grad.fill(0)
    for (const type of PAIR_TYPES) {
      const mult = w[type]
      if (mult === 0) continue
      const A = KERNEL_SCALE[type]
      const k = mult * 2 * A
      const p = this.pairs[type]
      if (type === 'nb' && this.boost !== null) {
        this.boostedNeighbours(mult, this.boost)
        continue
      }
      // One loop per dimension, unrolled, as this is the hot path.
      if (this.dim === 2)
        for (let t = 0; t < p.length; t += 2) {
          const i = p[t] * 2
          const j = p[t + 1] * 2
          const dx = Y[i] - Y[j]
          const dy = Y[i + 1] - Y[j + 1]
          const r = A + 1 + dx * dx + dy * dy
          const c = k / (r * r)
          grad[i] += c * dx
          grad[i + 1] += c * dy
          grad[j] -= c * dx
          grad[j + 1] -= c * dy
        }
      else
        for (let t = 0; t < p.length; t += 2) {
          const i = p[t] * 3
          const j = p[t + 1] * 3
          const dx = Y[i] - Y[j]
          const dy = Y[i + 1] - Y[j + 1]
          const dz = Y[i + 2] - Y[j + 2]
          const r = A + 1 + dx * dx + dy * dy + dz * dz
          const c = k / (r * r)
          grad[i] += c * dx
          grad[i + 1] += c * dy
          grad[i + 2] += c * dz
          grad[j] -= c * dx
          grad[j + 1] -= c * dy
          grad[j + 2] -= c * dz
        }
    }
  }

  /**
   * The neighbour pairs' forces with LocalMAP's boost (pacmap_grad_nearby_recip_sqrt): PaCMAP's kernel
   * times boost / sqrt(dd), dd = 1 + |yi - yj|². Its own loop, so the unboosted path stays as it was.
   */
  private boostedNeighbours(mult: number, boost: number) {
    const { Y, grad, dim } = this
    const A = KERNEL_SCALE.nb
    const k = mult * 2 * A
    const p = this.pairs.nb
    for (let t = 0; t < p.length; t += 2) {
      const i = p[t] * dim
      const j = p[t + 1] * dim
      let dd = 1
      for (let d = 0; d < dim; d++) {
        const delta = Y[i + d] - Y[j + d]
        dd += delta * delta
      }
      const r = A + dd
      const c = ((k / (r * r)) * boost) / Math.sqrt(dd)
      for (let d = 0; d < dim; d++) {
        const delta = Y[i + d] - Y[j + d]
        grad[i + d] += c * delta
        grad[j + d] -= c * delta
      }
    }
  }

  step(w: Weights) {
    this.gradient(w)
    this.optimiser.step(this.Y, this.grad, this.speed)
    this.steps++
  }
}
