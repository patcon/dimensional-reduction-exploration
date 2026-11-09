import type { Optimiser } from './optimisers.ts'
import { oneWayPairs, scrambleOneWay } from './lean.ts'
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

/** mulberry32: a small, fast, seedable PRNG, returning floats in [0, 1). Its state is one number, to checkpoint. */
class Mulberry32 {
  state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
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
 * The engine at one step, to go back to (see Engine.checkpoint): the layout, the optimiser's state, the far pairs
 * and those added, and where the far-pair draws were up to. The far pairs are shared with the checkpoint before
 * when they haven't changed since, so a run of checkpoints between redraws holds one copy.
 */
export interface Checkpoint {
  steps: number
  Y: Float32Array
  optimiser: Optimiser
  optimiserState: unknown
  /** The engine's fpVersion when taken, to tell whether the far pairs have changed since. */
  fpVersion: number
  fpGlobal: boolean
  fp: Uint32Array
  extraOf: (number[] | undefined)[]
  extraCount: number
  rng: number
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
  /** Whether the far pairs are the global ones (none redrawn, none added). */
  fpGlobal = true
  /** The far partners upsampling added to each point (see upsampleFar), how many in all, and them flat, once asked for. */
  private extraOf: (number[] | undefined)[] = []
  extraCount = 0
  private extraFlat: Uint32Array | null = null
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
  /**
   * Each force's lean, from -1 to 1: how its pull or push on a pair (i, j) is shared between i, the point whose
   * sampling chose the pair, and j, the point chosen. i feels (1 + lean) of it and j (1 - lean), so a pair's force
   * keeps its sign and its total; 0 is PaCMAP's, equal and opposite. Where a pair is listed both ways round (a
   * mutual neighbour pair, say) the leans cancel, so only one-way relationships move differently.
   */
  lean: Weights = { nb: 0, mn: 0, fp: 0 }
  /**
   * Whether the forces act on the neighbour pairs with who chose whom scrambled (see scrambleOneWay), the null to
   * compare a lean against. Only the forces read them: the far-pair redraw still knows each point's own neighbours.
   */
  scrambled = false
  private scrambledNb: Uint32Array | null = null
  private oneWay: Uint8Array | null = null
  /** Scales the optimiser's learning rate (the speed control); 1 is PaCMAP's. */
  speed = 1
  /** Steps taken since the last reset. */
  steps = 0
  private rng = new Mulberry32(SEED)

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
    this.rng = new Mulberry32(SEED)
    this.restoreFar()
  }

  /**
   * The engine as it is now, to go back to with restoreCheckpoint(). Pass the last checkpoint taken, and if the far
   * pairs haven't changed since, this one shares its copy of them.
   */
  checkpoint(previous?: Checkpoint): Checkpoint {
    const same = previous && previous.fpVersion === this.fpVersion
    return {
      steps: this.steps,
      Y: new Float32Array(this.Y),
      optimiser: this.optimiser,
      optimiserState: this.optimiser.snapshot(),
      fpVersion: this.fpVersion,
      fpGlobal: this.fpGlobal,
      fp: same ? previous.fp : this.fpGlobal ? this.globalFp : new Uint32Array(this.pairs.fp),
      extraOf: same ? previous.extraOf : this.extraOf.map((partners) => partners && [...partners]),
      extraCount: this.extraCount,
      rng: this.rng.state,
    }
  }

  /**
   * Back to a checkpoint: its layout, step count, far pairs (and those added) and draws. The optimiser's state comes
   * back if it's still the one the checkpoint was taken with; another (switched to since) starts fresh, as on a
   * switch. The far pairs count as changed (fpVersion moves on), and the checkpoint takes on the new version, so it
   * can tell whether they've changed again since.
   */
  restoreCheckpoint(c: Checkpoint) {
    this.Y.set(c.Y)
    this.steps = c.steps
    if (this.optimiser === c.optimiser) this.optimiser.restore(c.optimiserState)
    else this.optimiser.reset()
    this.pairs.fp.set(c.fp)
    this.fpGlobal = c.fpGlobal
    this.extraOf = c.extraOf.map((partners) => partners && [...partners])
    this.extraCount = c.extraCount
    this.extraFlat = null
    this.rng.state = c.rng
    this.fpVersion++
    c.fpVersion = this.fpVersion
  }

  /** Puts PaCMAP's global far pairs back, and drops any added. */
  restoreFar() {
    if (this.fpGlobal) return
    this.pairs.fp.set(this.globalFp)
    this.extraOf = []
    this.extraCount = 0
    this.extraFlat = null
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
   *
   * With `only`, just those points' far pairs are redrawn (from anywhere within `thres` of each, as before); the
   * rest keep theirs.
   */
  resampleFar(thres: number, only?: ArrayLike<number>): Resample {
    const start = performance.now()
    const fp = this.pairs.fp
    const fpPer = fp.length / 2 / this.n
    let resampled = 0
    let kept = 0
    this.drawNear(thres, only, fpPer, false, (i, k, j) => {
      const slot = (i * fpPer + k) * 2
      fp[slot] = i
      if (j === -1) kept++
      else {
        fp[slot + 1] = j
        resampled++
      }
    })
    this.fpGlobal = false
    this.fpVersion++
    return { resampled, kept, ms: performance.now() - start }
  }

  /**
   * Upsampling, the brush's other mode: `per` more far pairs for each of `only`, on top of those it has, drawn as
   * resampleFar draws (uniformly from the points within `thres` of it, not itself or a neighbour), and not one of
   * its far partners already (as sampled, redrawn or added). They're kept apart from the sampled far pairs (see
   * extraFar), feel the far pairs' force and lean, and are cleared by restoreFar (and so reset). In the result,
   * `resampled` counts those added and `kept` those that found no partner.
   */
  upsampleFar(thres: number, only: ArrayLike<number>, per = 1): Resample {
    const start = performance.now()
    let added = 0
    let missed = 0
    this.drawNear(thres, only, per, true, (i, _k, j) => {
      if (j === -1) return missed++
      ;(this.extraOf[i] ??= []).push(j)
      added++
    })
    if (added) {
      this.extraCount += added
      this.extraFlat = null
      this.fpGlobal = false
      this.fpVersion++
    }
    return { resampled: added, kept: missed, ms: performance.now() - start }
  }

  /** The far pairs upsampling added, flat (i, j) like the others: i the point painted, which chose j. */
  extraFar(): Uint32Array {
    if (!this.extraFlat) {
      const flat = new Uint32Array(this.extraCount * 2)
      let t = 0
      this.extraOf.forEach((partners, i) => {
        for (const j of partners ?? []) {
          flat[t++] = i
          flat[t++] = j
        }
      })
      this.extraFlat = flat
    }
    return this.extraFlat
  }

  /**
   * Draws `per` partners near each of `points` (every point, if none are given), as LocalMAP's redraw does (see
   * resampleFar), calling `place(i, k, j)` with each draw, j -1 where none was found. A point may not draw itself,
   * one of its neighbours, or a partner already drawn this time; with `barFar`, nor one of its far partners now.
   */
  private drawNear(thres: number, points: ArrayLike<number> | undefined, per: number, barFar: boolean, place: (i: number, k: number, j: number) => void) {
    const { n, dim, Y, rng } = this
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
    const count = points ? points.length : n
    for (let o = 0; o < count; o++) {
      const i = points ? points[o] : o
      const pool = grid.around(i)
      barred[i] = i
      for (let q = 0, from = i * nbPer * 2; q < nbPer; q++) barred[nb[from + q * 2 + 1]] = i
      if (barFar) {
        for (let q = 0, from = i * fpPer * 2; q < fpPer; q++) barred[fp[from + q * 2 + 1]] = i
        for (const j of this.extraOf[i] ?? []) barred[j] = i
      }
      // Few points about: list those it may pick, then pick without repeats (a partial shuffle).
      let listed = -1
      if (pool <= LIST_UP_TO) {
        listed = 0
        for (let r = 0; r < pool; r++) {
          const c = grid.pick(r)
          if (barred[c] !== i && near(i, c)) list[listed++] = c
        }
      }
      for (let k = 0; k < per; k++) {
        let j = -1
        if (listed >= 0) {
          if (k < listed) {
            const r = k + Math.floor(rng.next() * (listed - k))
            j = list[r]
            list[r] = list[k]
            list[k] = j
          }
        } else
          for (let tries = 0; tries < MAX_TRIES; tries++) {
            const c = grid.pick(Math.floor(rng.next() * pool))
            if (barred[c] === i || !near(i, c)) continue
            j = c
            barred[c] = i
            break
          }
        place(i, k, j)
      }
    }
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  setLean(lean: Weights) {
    this.lean = { ...lean }
  }

  /** For each neighbour pair, 1 if it's one way (see oneWayPairs); worked out when first asked for. */
  oneWayNeighbours() {
    this.oneWay ??= oneWayPairs(this.pairs.nb, this.n)
    return this.oneWay
  }

  setScrambled(scrambled: boolean) {
    this.scrambled = scrambled
    if (scrambled) this.scrambledNb ??= scrambleOneWay(this.pairs.nb, this.oneWayNeighbours())
  }

  /** The pairs the forces act on: as sampled, but for the neighbours, scrambled while `scrambled` is on. */
  private forcePairs(type: PairType) {
    return type === 'nb' && this.scrambled && this.scrambledNb ? this.scrambledNb : this.pairs[type]
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

  /**
   * Accumulate every pair's force into this.grad. Pair types with a zero multiplier are skipped. With a lean,
   * forces are no longer equal and opposite, so they can add up to a net force on the whole layout, which would
   * carry it off as one; that net force is taken off every point equally, leaving how points move relative to
   * each other (with no lean it's zero already, and nothing is taken off).
   */
  gradient(w: Weights) {
    this.grad.fill(0)
    let leaning = false
    for (const type of PAIR_TYPES) {
      const mult = w[type]
      if (mult === 0) continue
      const lean = this.lean[type]
      if (lean !== 0) leaning = true
      if (type === 'nb' && this.boost !== null) {
        this.boostedNeighbours(mult, this.boost, lean)
        continue
      }
      const A = KERNEL_SCALE[type]
      // The force's share on each end of the pair: i, which chose it, and j, chosen.
      const ki = mult * 2 * A * (1 + lean)
      const kj = mult * 2 * A * (1 - lean)
      const p = this.forcePairs(type)
      this.accumulate(p, A, ki, kj)
      if (type === 'fp' && this.extraCount) this.accumulate(this.extraFar(), A, ki, kj)
    }
    if (leaning) this.removeNetForce()
  }

  /**
   * Adds the forces of pairs `p` to this.grad: for each (i, j), with r = A + 1 + |yi - yj|², i gets ki / r² and j
   * kj / r² of (yi - yj), each its own end's share (see lean).
   */
  private accumulate(p: Uint32Array, A: number, ki: number, kj: number) {
    const { Y, grad } = this
    // One loop per dimension, unrolled, as this is the hot path.
    if (this.dim === 2)
      for (let t = 0; t < p.length; t += 2) {
        const i = p[t] * 2
        const j = p[t + 1] * 2
        const dx = Y[i] - Y[j]
        const dy = Y[i + 1] - Y[j + 1]
        const r = A + 1 + dx * dx + dy * dy
        const r2 = r * r
        const ci = ki / r2
        const cj = kj / r2
        grad[i] += ci * dx
        grad[i + 1] += ci * dy
        grad[j] -= cj * dx
        grad[j + 1] -= cj * dy
      }
    else
      for (let t = 0; t < p.length; t += 2) {
        const i = p[t] * 3
        const j = p[t + 1] * 3
        const dx = Y[i] - Y[j]
        const dy = Y[i + 1] - Y[j + 1]
        const dz = Y[i + 2] - Y[j + 2]
        const r = A + 1 + dx * dx + dy * dy + dz * dz
        const r2 = r * r
        const ci = ki / r2
        const cj = kj / r2
        grad[i] += ci * dx
        grad[i + 1] += ci * dy
        grad[i + 2] += ci * dz
        grad[j] -= cj * dx
        grad[j + 1] -= cj * dy
        grad[j + 2] -= cj * dz
      }
  }

  /** Takes the mean force off every point, so the forces sum to zero, as equal and opposite ones do. */
  private removeNetForce() {
    const { grad, dim, n } = this
    for (let d = 0; d < dim; d++) {
      let sum = 0
      for (let k = d; k < grad.length; k += dim) sum += grad[k]
      const mean = sum / n
      for (let k = d; k < grad.length; k += dim) grad[k] -= mean
    }
  }

  /**
   * The neighbour pairs' forces with LocalMAP's boost (pacmap_grad_nearby_recip_sqrt): PaCMAP's kernel
   * times boost / sqrt(dd), dd = 1 + |yi - yj|², leaning as gradient() does. Its own loop, so the unboosted
   * path stays as it was.
   */
  private boostedNeighbours(mult: number, boost: number, lean: number) {
    const { Y, grad, dim } = this
    const A = KERNEL_SCALE.nb
    const k = mult * 2 * A
    const p = this.forcePairs('nb')
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
      const ci = c * (1 + lean)
      const cj = c * (1 - lean)
      for (let d = 0; d < dim; d++) {
        const delta = Y[i + d] - Y[j + d]
        grad[i + d] += ci * delta
        grad[j + d] -= cj * delta
      }
    }
  }

  step(w: Weights) {
    this.gradient(w)
    this.optimiser.step(this.Y, this.grad, this.speed)
    this.steps++
  }
}
