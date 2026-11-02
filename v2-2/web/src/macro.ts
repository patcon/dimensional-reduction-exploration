/**
 * One slider for all three forces: a position s in [0, 1], top (0) to bottom (1), mapped to
 * weights along a path from the start of PaCMAP's schedule (mid-near dominant, global) to its
 * end (neighbours against far pairs, local). Each mode is a different path:
 *
 * A, B reproduce PaCMAP's weights exactly; C-F are smooth curves meant to land close by.
 * Far pairs stay at -1 in every mode but E, as they do in PaCMAP: with Adam, only the
 * ratios nb/|fp| and mn/|fp| matter much, so these are paths in that plane.
 *
 * pipeline/v2-2-macro.py mirrors these curves to score them (and to fit F's) against
 * PaCMAP's own run.
 */

import { pacmapWeights, scheduleLength } from './schedule.ts'
import type { Schedule, Weights } from './types.ts'

export type MacroMode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export const MACRO_MODES: MacroMode[] = ['A', 'B', 'C', 'D', 'E', 'F']

/** The forces tab's choice: the three sliders, or one of the single-slider modes. */
export type ForceMode = 'three' | MacroMode
export const FORCE_MODES: ForceMode[] = ['three', ...MACRO_MODES]

export const MACRO_INFO: Record<MacroMode, { name: string; description: string }> = {
  A: {
    name: 'scrub',
    description:
      "Exact: the slider is a position in PaCMAP's schedule, phase 1's ramp given most of the travel and phases 2 and 3 short stretches at the bottom. Jumps where PaCMAP's weights jump.",
  },
  B: {
    name: 'clock',
    description:
      "Exact, outcome too: the slider sets how far the run may go, and the playhead follows it at the play rate, holding when it catches up. Forces are PaCMAP's at the playhead; it can't go back (reset to rewind).",
  },
  C: {
    name: 'log curve',
    description:
      "Smooth: eases in log scale through PaCMAP's settings, (2, 1000) at the top, (3, 3) at the middle and (1, 0) near the bottom, settling at each.",
  },
  D: {
    name: 'global ↔ local',
    description:
      'Smooth: the ratio of mid-near to neighbours falls evenly in log scale, from 500 at the top through balanced to none at the bottom, as neighbours ease from 2 to 1.',
  },
  E: {
    name: 'arc',
    description:
      "Smooth: turns the forces' direction along great-circle arcs through PaCMAP's three settings (what Adam mostly sees), their strength easing in log scale.",
  },
  F: {
    name: 'fitted',
    description:
      "Smooth: a curve like C's whose knots were fitted so sliding it top to bottom at a steady pace ends where PaCMAP's own run ends (pipeline/v2-2-macro.py).",
  },
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** A's share of the travel for each of PaCMAP's three phases. */
export const SCRUB_TRAVEL: [number, number, number] = [0.6, 0.15, 0.25]

/** A's slider position as a (fractional) iteration of PaCMAP's schedule. */
export function scrubIteration(s: number, sched: Schedule) {
  const [p1, p2, p3] = sched.phases
  const [a, b] = SCRUB_TRAVEL
  s = clamp01(s)
  if (s < a) return (s / a) * p1
  if (s < a + b) return p1 + ((s - a) / b) * p2
  return p1 + p2 + Math.min(((s - a - b) / (1 - a - b)) * p3, p3 - 1)
}

/** The inverse of scrubIteration, to show an iteration (autopilot's) on A's slider. */
export function scrubPosition(iter: number, sched: Schedule) {
  const [p1, p2, p3] = sched.phases
  const [a, b] = SCRUB_TRAVEL
  if (iter < p1) return (iter / p1) * a
  if (iter < p1 + p2) return a + ((iter - p1) / p2) * b
  return a + b + ((iter - p1 - p2) / p3) * (1 - a - b)
}

/** B's slider position as how many iterations the run may take, 0 to the schedule's length. */
export const clockTarget = (s: number, sched: Schedule) => Math.round(clamp01(s) * scheduleLength(sched))

/**
 * Knots for a smooth path: at each s, a value of nb and of log mn. Between knots both ease
 * (smoothstep) in log scale, so the slider settles at each knot. Past the last knot, mn is 0.
 */
export interface Knots {
  s: number[]
  nb: number[]
  mn: number[]
}

function eased({ s: ks, nb, mn }: Knots, s: number): Weights {
  if (s >= ks[ks.length - 1]) return { nb: nb[nb.length - 1], mn: 0, fp: -1 }
  let k = 0
  while (k < ks.length - 2 && s > ks[k + 1]) k++
  const t = smoothstep(clamp01((s - ks[k]) / (ks[k + 1] - ks[k])))
  return {
    nb: Math.exp(lerp(Math.log(nb[k]), Math.log(nb[k + 1]), t)),
    mn: Math.exp(lerp(Math.log(mn[k]), Math.log(mn[k + 1]), t)),
    fp: -1,
  }
}

/** C's knots: PaCMAP's start, its phase 2, and its phase 3 (mn faded to 0.1, then off). */
export const C_KNOTS: Knots = { s: [0, 0.5, 0.9, 0.95], nb: [2, 3, 1, 1], mn: [1000, 3, 0.1, 0.1] }

/** F's knots, as pipeline/v2-2-macro.py fitted them (10k digits, 2D). */
export const F_KNOTS: Knots = { s: [0, 0.502, 0.761, 0.811], nb: [1.179, 2.552, 0.999, 0.999], mn: [786.311, 10.368, 0.1, 0.1] }

/** D's mid-near to neighbour ratio at the top, and where it switches off. */
const D_RATIO_TOP = 500
const D_RATIO_BOTTOM = 0.01
const D_OFF = 0.95

function globalLocal(s: number): Weights {
  const nb = lerp(2, 1, s)
  if (s >= D_OFF) return { nb, mn: 0, fp: -1 }
  const ratio = Math.exp(lerp(Math.log(D_RATIO_TOP), Math.log(D_RATIO_BOTTOM), s / D_OFF))
  return { nb, mn: nb * ratio, fp: -1 }
}

/** E's waypoints: PaCMAP's three settings, as directions and strengths. */
const E_WAYPOINTS: [number, number, number][] = [
  [2, 1000, -1],
  [3, 3, -1],
  [1, 0, -1],
]

const norm = (v: number[]) => Math.hypot(...v)

function slerp(a: number[], b: number[], t: number) {
  const ua = a.map((x) => x / norm(a))
  const ub = b.map((x) => x / norm(b))
  const omega = Math.acos(Math.max(-1, Math.min(1, ua.reduce((sum, x, k) => sum + x * ub[k], 0))))
  if (omega < 1e-6) return ua
  const sa = Math.sin((1 - t) * omega) / Math.sin(omega)
  const sb = Math.sin(t * omega) / Math.sin(omega)
  return ua.map((x, k) => sa * x + sb * ub[k])
}

function arc(s: number): Weights {
  const half = s < 0.5 ? 0 : 1
  const t = smoothstep(clamp01(half ? (s - 0.5) * 2 : s * 2))
  const a = E_WAYPOINTS[half]
  const b = E_WAYPOINTS[half + 1]
  const strength = Math.exp(lerp(Math.log(norm(a)), Math.log(norm(b)), t))
  const [nb, mn, fp] = slerp(a, b, t).map((x) => x * strength)
  // Tiny mid-near at the bottom is no force, as in PaCMAP's phase 3.
  return { nb, mn: mn < 1e-3 ? 0 : mn, fp }
}

/** The weights at slider position s. B's are PaCMAP's at the playhead, not the slider's. */
export function macroWeights(mode: MacroMode, s: number, sched: Schedule, playhead: number): Weights {
  s = clamp01(s)
  switch (mode) {
    case 'A':
      return pacmapWeights(scrubIteration(s, sched), sched)
    case 'B':
      return pacmapWeights(playhead, sched)
    case 'C':
      return eased(C_KNOTS, s)
    case 'D':
      return globalLocal(s)
    case 'E':
      return arc(s)
    case 'F':
      return eased(F_KNOTS, s)
  }
}

/** Positions worth marking on each mode's track: its knots, phase boundaries or balance point. */
export function macroMarks(mode: MacroMode): number[] {
  switch (mode) {
    case 'A':
      return [SCRUB_TRAVEL[0], SCRUB_TRAVEL[0] + SCRUB_TRAVEL[1]]
    case 'B':
      return []
    case 'C':
      return C_KNOTS.s.slice(1, -1)
    case 'D':
      // Where mid-near and neighbours balance.
      return [(Math.log(D_RATIO_TOP) / (Math.log(D_RATIO_TOP) - Math.log(D_RATIO_BOTTOM))) * D_OFF]
    case 'E':
      return [0.5]
    case 'F':
      return F_KNOTS.s.slice(1, -1)
  }
}
