/**
 * What the music needs of the map's digits, worked out off the main thread (see analysis.worker.ts): their nearest
 * neighbours, for the walker to step along; their broad groups, which set the harmony (HDBSCAN on the UMAP, or Leiden on
 * the neighbours); and their small groups (Leiden at a high resolution on the same neighbours), which set the melody.
 */

import { hdbscan, type HdbscanOptions } from './hdbscan.ts'
import { knnGraph, type Graph } from './knn.ts'
import { leiden } from './leiden.ts'
import type { Method } from './settings.ts'

export interface AnalysisRequest {
  digits: number[]
  method: Method
  hdbscan: HdbscanOptions
  /** Leiden's broad groups: by hand at `resolution`, or as near `target` as it gets. */
  resolution: number | null
  target: number
  fineResolution: number
  neighbours: number
  seed: number
}

/** The map's digits, grouped. */
export interface MapMusic {
  /** The digits on the map, as rows of the data. */
  rows: number[]
  graph: Graph
  /** Each digit's broad group, largest first, or −1 for noise (HDBSCAN's stragglers). */
  broad: Int32Array
  /** None, with no digits, or every one left as noise. */
  broadCount: number
  fine: Int32Array
  fineCount: number
  /** Leiden's resolution for the broad groups, as set or found; null for HDBSCAN. */
  resolution: number | null
}

/** Leiden's broad-group resolutions are looked for in this range, on a log scale. */
const SEARCH_RANGE = [0.0003, 4]
const SEARCH_STEPS = 16

const countOf = (membership: Int32Array) => Math.max(-1, ...membership) + 1

/**
 * Works out the map's music from the data (`pcs`, n × `nPcs`, and `umap`, n × `umapDims`), keeping what it can between
 * requests: the graph for the same digits, and the resolution found for each number of groups.
 */
export class Analyser {
  private key = ''
  private rows: number[] = []
  private graph: Graph | null = null
  /** Leiden's broad groups, by how many there are, as found looking for a number of them. */
  private found = new Map<number, { resolution: number; membership: Int32Array }>()
  private data: { labels: number[]; pcs: Float32Array; nPcs: number; umap: Float32Array; umapDims: number }

  constructor(data: { labels: number[]; pcs: Float32Array; nPcs: number; umap: Float32Array; umapDims: number }) {
    this.data = data
  }

  analyse(req: AnalysisRequest): MapMusic {
    const { labels, pcs, nPcs, umap, umapDims } = this.data
    const key = `${req.digits.join(',')}|${req.neighbours}|${req.seed}`
    if (key !== this.key || !this.graph) {
      const on = new Set(req.digits)
      this.rows = labels.flatMap((l, r) => (on.has(l) ? [r] : []))
      this.graph = knnGraph(pick(pcs, nPcs, this.rows), this.rows.length, nPcs, req.neighbours)
      this.found = new Map()
      this.key = key
    }
    const { rows, graph } = this
    const n = rows.length
    if (n < 3) return { rows, graph, broad: new Int32Array(n).fill(n ? 0 : -1), broadCount: n ? 1 : 0, fine: new Int32Array(n), fineCount: n ? 1 : 0, resolution: null }

    const fine = leiden(graph, { resolution: req.fineResolution, iterations: 2, seed: req.seed })
    let broad: Int32Array
    let resolution: number | null = null
    if (req.method === 'hdbscan') broad = hdbscan(pick(umap, umapDims, rows), n, umapDims, req.hdbscan)
    else if (req.resolution !== null) {
      resolution = req.resolution
      broad = leiden(graph, { resolution, iterations: 2, seed: req.seed })
    } else ({ resolution, membership: broad } = this.leidenFor(req.target, req.seed))
    return { rows, graph, broad, broadCount: countOf(broad), fine, fineCount: countOf(fine), resolution }
  }

  /** Leiden's broad groups, `target` of them, or as near as it gets: the resolution is halved in on, on a log scale. */
  private leidenFor(target: number, seed: number) {
    const known = this.found.get(target)
    if (known) return known
    let lo = Math.log(SEARCH_RANGE[0])
    let hi = Math.log(SEARCH_RANGE[1])
    let best: { resolution: number; membership: Int32Array; count: number } | null = null
    for (let step = 0; step < SEARCH_STEPS; step++) {
      const mid = (lo + hi) / 2
      const resolution = Math.exp(mid)
      const membership = leiden(this.graph!, { resolution, iterations: 2, seed })
      const count = countOf(membership)
      if (!this.found.has(count)) this.found.set(count, { resolution, membership })
      if (!best || Math.abs(count - target) < Math.abs(best.count - target)) best = { resolution, membership, count }
      if (count === target) break
      if (count > target) hi = mid
      else lo = mid
    }
    this.found.set(target, best!)
    return best!
  }
}

/** The rows of `values` (each `dim` wide) for `rows`, packed together. */
function pick(values: Float32Array, dim: number, rows: number[]) {
  const out = new Float32Array(rows.length * dim)
  rows.forEach((r, i) => out.set(values.subarray(r * dim, (r + 1) * dim), i * dim))
  return out
}

/** The adjusted Rand index between two labellings: 1 when they agree exactly, about 0 when no better than chance. */
export function adjustedRand(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length
  const pairs = new Map<string, number>()
  const as = new Map<number, number>()
  const bs = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const key = `${a[i]},${b[i]}`
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
    as.set(a[i], (as.get(a[i]) ?? 0) + 1)
    bs.set(b[i], (bs.get(b[i]) ?? 0) + 1)
  }
  const c2 = (x: number) => (x * (x - 1)) / 2
  let index = 0
  let sumA = 0
  let sumB = 0
  for (const v of pairs.values()) index += c2(v)
  for (const v of as.values()) sumA += c2(v)
  for (const v of bs.values()) sumB += c2(v)
  const expected = (sumA * sumB) / c2(n)
  const max = (sumA + sumB) / 2
  return max === expected ? 1 : (index - expected) / (max - expected)
}
