import type { Schedule, Weights } from './types.ts'

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
