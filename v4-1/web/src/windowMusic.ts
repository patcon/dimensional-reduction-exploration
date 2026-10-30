/**
 * What the music needs of the window, worked out off the main thread (see windowMusic.worker.ts), as UMAP takes a few
 * hundred milliseconds: the digits' nearest neighbours over it, for the walker to step along, their broad groups
 * (HDBSCAN on a UMAP of the window), which set the harmony, and their small groups (Leiden at a high resolution on the
 * same neighbours), which set the melody.
 */

import { knnGraph, type Graph } from './knn.ts'
import { leiden } from './leiden.ts'
import { umapHdbscan } from './umapHdbscan.ts'

export interface MusicSettings {
  /** Nearest neighbours, for the walk's graph, the small groups and UMAP alike. */
  neighbours: number
  /** HDBSCAN: the smallest group worth calling a broad group. */
  minClusterSize: number
  /** HDBSCAN: how conservative it is; higher leaves more digits as noise. */
  minSamples: number
  /** Let every digit be one broad group, rather than always splitting or leaving everything as noise. */
  allowSingle: boolean
  /**
   * Take the visualiser's groups (the Groups tab's) as the broad groups, rather than the music's own over the window,
   * so what's heard is what's coloured, worked out once.
   */
  syncGroups: boolean
  /** Leiden's resolution for the small groups: higher makes more of them, smaller. */
  fineResolution: number
  stepsPerSecond: number
  /** Long-short pairs of steps, rather than even ones. */
  swing: boolean
  /** Each layer's level, 0–1. */
  chord: number
  bass: number
  melody: number
}

export const DEFAULT_MUSIC: MusicSettings = {
  neighbours: 15,
  minClusterSize: 8,
  minSamples: 5,
  allowSingle: true,
  syncGroups: false,
  fineResolution: 6,
  stepsPerSecond: 7,
  swing: true,
  chord: 0.75,
  bass: 0.65,
  melody: 0.7,
}

/** What the walk needs of the window: the neighbours to step along, and which broad and small group each digit is in. */
export interface WindowMusic {
  /** The digits (and participants) it was worked out for, as the visualiser's rows. */
  rows: number[]
  graph: Graph
  /** Each digit's broad group, largest first, or −1 for noise. */
  broad: Int32Array
  /** None, with no digits, or every one left as noise. */
  broadCount: number
  fine: Int32Array
  fineCount: number
}

/** Broad and small groups over the window's `features` (n × dim, as windowFeatures gives them). */
export function analyseWindow(rows: number[], features: Float32Array, dim: number, settings: MusicSettings, seed: number): WindowMusic {
  const n = rows.length
  const k = Math.max(2, Math.min(settings.neighbours, n - 1))
  const graph = knnGraph(features, n, dim, k)
  const fine = n < 3 ? new Int32Array(n) : leiden(graph, { resolution: settings.fineResolution, iterations: 2, seed })
  // Synced, the visualiser's groups stand in (see MusicWalk.setShared).
  const broad = settings.syncGroups ? new Int32Array(n) : umapHdbscan(features, n, dim, settings.neighbours, settings, seed)
  return { rows, graph, broad, broadCount: Math.max(-1, ...broad) + 1, fine, fineCount: Math.max(-1, ...fine) + 1 }
}
