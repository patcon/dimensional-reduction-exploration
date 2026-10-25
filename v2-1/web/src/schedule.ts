import type { PairType, Schedule, Weights } from './types.ts'

export function scheduleLength(s: Schedule) {
  return s.phases[0] + s.phases[1] + s.phases[2]
}

/** Which of PaCMAP's phases (1, 2 or 3) an iteration falls in. */
export function phaseOf(iter: number, s: Schedule): 1 | 2 | 3 {
  if (iter < s.phases[0]) return 1
  if (iter < s.phases[0] + s.phases[1]) return 2
  return 3
}

/**
 * PaCMAP's weights at an iteration (pacmap.find_weight), as signed multipliers:
 * its far-pair weight repels, so it comes out negative here.
 */
export function pacmapWeights(iter: number, s: Schedule): Weights {
  const [p1, p2] = s.phases
  if (iter < p1) {
    const t = iter / p1
    return { nb: 2, mn: (1 - t) * s.wMnInit + t * 3, fp: -1 }
  }
  if (iter < p1 + p2) return { nb: 3, mn: 3, fp: -1 }
  return { nb: 1, mn: 0, fp: -1 }
}

/** The forces applied at each playhead position this loop, for the schedule graph. */
export class Trail {
  /** NaN where not yet played this loop. */
  readonly values: Record<PairType, Float32Array>

  constructor(length: number) {
    const blank = () => new Float32Array(length).fill(NaN)
    this.values = { nb: blank(), mn: blank(), fp: blank() }
  }

  /** Record a step's forces; a step at playhead 0 starts a new loop, so it clears the last one. */
  record(playhead: number, w: Weights) {
    if (playhead === 0) this.clear()
    this.values.nb[playhead] = w.nb
    this.values.mn[playhead] = w.mn
    this.values.fp[playhead] = w.fp
  }

  clear() {
    this.values.nb.fill(NaN)
    this.values.mn.fill(NaN)
    this.values.fp.fill(NaN)
  }
}
