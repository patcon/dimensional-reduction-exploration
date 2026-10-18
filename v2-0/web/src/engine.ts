import { PAIR_TYPES, type AdamParams, type Pairs, type PairType, type Weights } from './types.ts'

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
 * PaCMAP's optimisation on fixed pairs, one step at a time with live weights.
 * Float32 storage throughout, like pacmap's numba kernels.
 */
export class Engine {
  readonly n: number
  readonly pairs: Pairs
  readonly init: Float32Array
  /** Current layout, n x 2 row-major. Mutated in place by step(). */
  readonly Y: Float32Array
  readonly grad: Float32Array
  readonly m: Float32Array
  readonly v: Float32Array
  adam: AdamParams
  /** Optimiser steps taken since the last reset (drives Adam's bias correction). */
  steps = 0

  constructor(pairs: Pairs, init: Float32Array, adam: AdamParams) {
    this.n = init.length / 2
    this.pairs = pairs
    this.init = init
    this.adam = adam
    this.Y = new Float32Array(init)
    this.grad = new Float32Array(init.length)
    this.m = new Float32Array(init.length)
    this.v = new Float32Array(init.length)
  }

  reset() {
    this.Y.set(this.init)
    this.m.fill(0)
    this.v.fill(0)
    this.steps = 0
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

  /** PaCMAP's Adam update (pacmap.update_embedding_adam), using this.grad. */
  adamStep() {
    const { Y, grad, m, v } = this
    const { lr, beta1, beta2, eps } = this.adam
    const t = this.steps + 1
    const lrT = (lr * Math.sqrt(1 - beta2 ** t)) / (1 - beta1 ** t)
    for (let k = 0; k < Y.length; k++) {
      const g = grad[k]
      m[k] += (1 - beta1) * (g - m[k])
      v[k] += (1 - beta2) * (g * g - v[k])
      Y[k] -= (lrT * m[k]) / (Math.sqrt(v[k]) + eps)
    }
    this.steps = t
  }

  step(w: Weights) {
    this.gradient(w)
    this.adamStep()
  }
}
