/** Every setting: which digits are on the map, how they're grouped, and the music. */

import type { HdbscanOptions } from './hdbscan.ts'

export type Method = 'hdbscan' | 'leiden'

export const METHOD_LABELS: Record<Method, string> = {
  hdbscan: 'HDBSCAN on UMAP',
  leiden: 'Leiden on kNN',
}

export interface Settings {
  /** The labels on the map. */
  digits: number[]
  /** What finds the broad groups, which set the harmony. */
  method: Method
  hdbscan: HdbscanOptions
  /** Leiden's broad groups: as many as there are digits chosen, or `target`. */
  matchDigits: boolean
  target: number
  /** Leiden's resolution, set by hand, or null to find the one that gives the number of groups wanted. */
  resolution: number | null
  /** Leiden's resolution for the small groups, which set the melody: higher makes more of them, smaller. */
  fineResolution: number
  stepsPerSecond: number
  /** Long-short pairs of steps, rather than even ones. */
  swing: boolean
  /** Each layer's level, 0–1. */
  chord: number
  bass: number
  melody: number
}

export const N_DIGITS = 10
/** The walk's nearest neighbours, for its graph, and Leiden's. */
export const NEIGHBOURS = 10
/** At most this many broad groups are asked of Leiden: the chord has 12 tones. */
export const MAX_TARGET = 12

export const DEFAULT_SETTINGS: Settings = {
  digits: Array.from({ length: N_DIGITS }, (_, d) => d),
  method: 'hdbscan',
  hdbscan: { minClusterSize: 60, minSamples: 10, allowSingle: true },
  matchDigits: true,
  target: 10,
  resolution: null,
  fineResolution: 6,
  stepsPerSecond: 7,
  swing: true,
  chord: 0.75,
  bass: 0.65,
  melody: 0.7,
}

/** The number of broad groups Leiden is asked for. */
export const targetOf = (s: Settings) => (s.matchDigits ? Math.max(1, s.digits.length) : s.target)
