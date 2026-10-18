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

/**
 * PaCMAP's optimisation on fixed pairs, one step at a time with live weights: the gradient is
 * computed here, and a swappable optimiser turns it into a step.
 * Float32 storage throughout, like pacmap's numba kernels.
 */
export class Engine {
  readonly n: number
  readonly pairs: Pairs
  readonly init: Float32Array
  /** Current layout, n x 2 row-major. Mutated in place by step(). */
  readonly Y: Float32Array
  readonly grad: Float32Array
  optimiser: Optimiser
  /** Scales the optimiser's learning rate (the master speed control); 1 is PaCMAP's. */
  speed = 1
  /** Steps taken since the last reset. */
  steps = 0

  constructor(pairs: Pairs, init: Float32Array, optimiser: Optimiser) {
    this.n = init.length / 2
    this.pairs = pairs
    this.init = init
    this.optimiser = optimiser
    this.Y = new Float32Array(init)
    this.grad = new Float32Array(init.length)
  }

  reset() {
    this.Y.set(this.init)
    this.optimiser.reset()
    this.steps = 0
  }

  setSpeed(speed: number) {
    this.speed = speed
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
    }
  }

  step(w: Weights) {
    this.gradient(w)
    this.optimiser.step(this.Y, this.grad, this.speed)
    this.steps++
  }
}
