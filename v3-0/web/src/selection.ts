/** Which digits take part, how they're grouped, and the order their chords sit in. */
import { knnGraph } from './knn.ts'
import { leiden, modularity } from './leiden.ts'
import { makeRng, shuffle } from './rng.ts'

export const N_DIGITS = 10

/** Rows of the pool whose label is in `digits`, shuffled by `seed`, the first `count` of them. */
export function pickRows(labels: number[], digits: ReadonlySet<number>, count: number, seed: number) {
  const pool = labels.flatMap((label, row) => (digits.has(label) ? [row] : []))
  // Seed 0 keeps the pool's own (already random) order, so the first pick is reproducible from the pipeline.
  if (seed !== 0) shuffle(pool, makeRng(seed))
  return pool.slice(0, count)
}

/** The principal components of `rows`, packed into one n × dim array. */
export function pcsOf(pcs: Float32Array, dim: number, rows: number[]) {
  const out = new Float32Array(rows.length * dim)
  rows.forEach((row, i) => out.set(pcs.subarray(row * dim, (row + 1) * dim), i * dim))
  return out
}

export type GroupBy = 'digit' | 'leiden'

export interface LeidenSettings {
  resolution: number
  neighbours: number
  seed: number
}

export interface Group {
  /** A short name: the digit, or the cluster's majority digit and a letter (e.g. 3a, 3b). */
  name: string
  /** Participants in it. */
  size: number
  majorityLabel: number
  labelCounts: number[]
}

export interface Grouping {
  /** Groups, in the order their chords sit when grouped. */
  groups: Group[]
  /** groupOf[participant] = index into groups. */
  groupOf: Int32Array
  /** For Leiden: the clusters' modularity on the kNN graph. */
  modularity?: number
}

function summarise(labels: number[], membership: ArrayLike<number>, count: number) {
  const counts = Array.from({ length: count }, () => new Array<number>(N_DIGITS).fill(0))
  labels.forEach((label, i) => counts[membership[i]][label]++)
  return counts.map((labelCounts) => {
    const size = labelCounts.reduce((a, b) => a + b, 0)
    const majorityLabel = labelCounts.indexOf(Math.max(...labelCounts))
    return { size, majorityLabel, labelCounts }
  })
}

/** Groups participants (with these `labels` and principal components `points`, n × dim) by digit or by Leiden cluster. */
export function groupParticipants(
  labels: number[],
  points: Float32Array,
  dim: number,
  by: GroupBy,
  settings: LeidenSettings,
): Grouping {
  const n = labels.length
  if (by === 'digit') {
    const present = [...new Set(labels)].sort((a, b) => a - b)
    const index = new Map(present.map((d, i) => [d, i]))
    const groupOf = Int32Array.from(labels, (d) => index.get(d)!)
    const groups = summarise(labels, groupOf, present.length).map((g, i) => ({ ...g, name: String(present[i]) }))
    return { groups, groupOf }
  }
  if (n < 3) return { groups: [{ name: 'all', ...summarise(labels, new Int32Array(n), 1)[0] }], groupOf: new Int32Array(n) }
  const graph = knnGraph(points, n, dim, settings.neighbours)
  const membership = leiden(graph, { resolution: settings.resolution, iterations: 2, seed: settings.seed })
  const clusters = summarise(labels, membership, Math.max(...membership) + 1)
  // Clusters of the same digit side by side, biggest first, each named after its digit.
  const order = clusters.map((_, c) => c).sort((a, b) => clusters[a].majorityLabel - clusters[b].majorityLabel || clusters[b].size - clusters[a].size)
  const rank = new Int32Array(order.length)
  order.forEach((c, i) => (rank[c] = i))
  const perDigit = new Array<number>(N_DIGITS).fill(0)
  const groups = order.map((c) => {
    const g = clusters[c]
    const letter = String.fromCharCode(97 + (perDigit[g.majorityLabel]++ % 26))
    return { ...g, name: `${g.majorityLabel}${letter}` }
  })
  return { groups, groupOf: membership.map((c) => rank[c]), modularity: modularity(graph, membership, settings.resolution) }
}

/** How chords are laid out around the geometry: as the digits were picked, or group by group. */
export type ChordOrder = 'random' | 'grouped'

/**
 * slotOf[participant] = its chord's position. Grouped: group by group, and within each group
 * along the first principal component, so neighbouring chords are similar digits.
 */
export function chordSlots(grouping: Grouping, points: Float32Array, dim: number, order: ChordOrder) {
  const n = grouping.groupOf.length
  const byPosition = Array.from({ length: n }, (_, i) => i)
  if (order === 'grouped')
    byPosition.sort((a, b) => grouping.groupOf[a] - grouping.groupOf[b] || points[a * dim] - points[b * dim])
  const slotOf = new Int32Array(n)
  byPosition.forEach((p, slot) => (slotOf[p] = slot))
  return slotOf
}

