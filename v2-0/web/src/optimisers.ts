import type { AdamParams } from './types.ts'

/** Turns the engine's gradient into a step. Each keeps its own state and step count. */
export interface Optimiser {
  /** Move Y against grad. `speed` scales the learning rate (the master speed control). */
  step(Y: Float32Array, grad: Float32Array, speed: number): void
  /** Forget all internal state. */
  reset(): void
  /** Called when an input moves; only the kicking Adam cares. */
  onControlChange?(): void
}

/**
 * Adam as PaCMAP runs it (pacmap.update_embedding_adam), with two optional twists:
 * `kick` forgets m, v and the bias-correction count whenever a control moves, and a
 * smaller beta2 shortens how long it remembers past gradient magnitudes.
 */
export class Adam implements Optimiser {
  params: AdamParams
  kick: boolean
  private m: Float32Array
  private v: Float32Array
  private t = 0

  constructor(size: number, params: AdamParams, kick = false) {
    this.params = params
    this.kick = kick
    this.m = new Float32Array(size)
    this.v = new Float32Array(size)
  }

  step(Y: Float32Array, grad: Float32Array, speed: number) {
    const { m, v } = this
    const { lr, beta1, beta2, eps } = this.params
    const t = ++this.t
    const lrT = (speed * lr * Math.sqrt(1 - beta2 ** t)) / (1 - beta1 ** t)
    for (let k = 0; k < Y.length; k++) {
      const g = grad[k]
      m[k] += (1 - beta1) * (g - m[k])
      v[k] += (1 - beta2) * (g * g - v[k])
      Y[k] -= (lrT * m[k]) / (Math.sqrt(v[k]) + eps)
    }
  }

  reset() {
    this.m.fill(0)
    this.v.fill(0)
    this.t = 0
  }

  onControlChange() {
    if (this.kick) this.reset()
  }
}

export interface MomentumParams {
  lr: number
  /** Fraction of last step's velocity kept: 0 is plain gradient descent, near 1 coasts. */
  momentum: number
  /** Longest a single point may move in one step, so huge forces can't fling points away. */
  maxStep: number
}

/**
 * Gradient descent with momentum: each point moves in proportion to the force on it, so
 * (unlike Adam) doubling a force doubles the speed. vel = momentum·vel − lr·grad, then each
 * point's velocity is capped at maxStep.
 */
export class Momentum implements Optimiser {
  params: MomentumParams
  private vel: Float32Array

  constructor(size: number, params: MomentumParams) {
    this.params = params
    this.vel = new Float32Array(size)
  }

  step(Y: Float32Array, grad: Float32Array, speed: number) {
    const { vel } = this
    const { momentum, maxStep } = this.params
    const lr = speed * this.params.lr
    for (let i = 0; i < Y.length; i += 2) {
      let vx = momentum * vel[i] - lr * grad[i]
      let vy = momentum * vel[i + 1] - lr * grad[i + 1]
      const len = Math.hypot(vx, vy)
      if (len > maxStep) {
        vx *= maxStep / len
        vy *= maxStep / len
      }
      vel[i] = vx
      vel[i + 1] = vy
      Y[i] += vx
      Y[i + 1] += vy
    }
  }

  reset() {
    this.vel.fill(0)
  }
}

export type OptimiserKind = 'adam' | 'adam-kick' | 'adam-short' | 'momentum'

export interface OptimiserSettings {
  kind: OptimiserKind
  /** beta2 for the short-memory Adam. */
  shortBeta2: number
  momentum: MomentumParams
  /** Master speed: multiplies every optimiser's learning rate. */
  speed: number
}

/** Momentum's defaults come close to PaCMAP's own result when run on its schedule. */
export const DEFAULT_OPTIMISER: OptimiserSettings = {
  kind: 'adam',
  shortBeta2: 0.9,
  momentum: { lr: 1, momentum: 0.9, maxStep: 1 },
  speed: 1,
}

/** One instance of each optimiser, so switching back and forth is cheap. */
export class OptimiserBank {
  private adam: AdamParams
  private all: { adam: Adam; 'adam-kick': Adam; 'adam-short': Adam; momentum: Momentum }

  constructor(size: number, adam: AdamParams) {
    this.adam = adam
    this.all = {
      adam: new Adam(size, adam),
      'adam-kick': new Adam(size, adam, true),
      'adam-short': new Adam(size, { ...adam, beta2: DEFAULT_OPTIMISER.shortBeta2 }),
      momentum: new Momentum(size, { ...DEFAULT_OPTIMISER.momentum }),
    }
  }

  /** Apply the settings' knobs and return the optimiser they select. */
  configure(s: OptimiserSettings): Optimiser {
    this.all['adam-short'].params = { ...this.adam, beta2: s.shortBeta2 }
    this.all.momentum.params = { ...s.momentum }
    return this.all[s.kind]
  }
}
