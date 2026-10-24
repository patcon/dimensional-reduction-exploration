/** Which digits take part, how they're grouped, and the order their chords sit in. */
import { knnGraph } from './knn.ts'
import { leiden, modularity } from './leiden.ts'
import { makeRng, shuffle } from './rng.ts'
import { valenceAt, type Traces } from './signal.ts'

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

/**
 * Each participant's valence over the window [moment − span, moment], sampled at `samples` evenly
 * spaced moments: what clustering over a window compares, packed n × samples. With `wrap` (playback
 * loops), a window reaching back past the start takes in the end.
 */
export function windowFeatures(traces: Traces, moment: number, span: number, samples: number, wrap = false) {
  const out = new Float32Array(traces.n * samples)
  for (let s = 0; s < samples; s++) {
    const t = moment - span + (span * s) / (samples - 1)
    for (let i = 0; i < traces.n; i++) out[i * samples + s] = valenceAt(traces, i, t, wrap)
  }
  return out
}

export type GroupBy = 'digit' | 'leiden'
/** What Leiden clusters on: each whole digit (its principal components), or the trail's window of each trace. */
export type ClusterOver = 'full' | 'window'

export interface LeidenSettings {
  resolution: number
  neighbours: number
  seed: number
}

export interface Group {
  /** A short name: the digit, or the cluster's number (its id + 1). */
  name: string
  /** For Leiden: the cluster's id, kept from one run to the next where the cluster carries on. */
  id?: number
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

/**
 * Ids for `count` new clusters. With a `previous` grouping of the same participants, each cluster
 * takes the id of the previous group it shares most participants with (one to one, biggest
 * overlaps first), and the rest take the lowest ids free in both, so a cluster that just ended
 * doesn't hand its colour straight to another. Without one, ids follow Leiden's order: largest first.
 */
function stableIds(membership: Int32Array, count: number, previous?: Grouping) {
  if (!previous || previous.groupOf.length !== membership.length) return Int32Array.from({ length: count }, (_, c) => c)
  const previousIds = previous.groups.map((g) => g.id!)
  const span = Math.max(...previousIds) + 1
  const overlap = new Map<number, number>()
  membership.forEach((c, i) => {
    const key = c * span + previousIds[previous.groupOf[i]]
    overlap.set(key, (overlap.get(key) ?? 0) + 1)
  })
  const idOf = new Int32Array(count).fill(-1)
  const used = new Set(previousIds)
  const taken = new Set<number>()
  for (const [key] of [...overlap].sort((a, b) => b[1] - a[1])) {
    const c = Math.floor(key / span)
    const id = key % span
    if (idOf[c] >= 0 || taken.has(id)) continue
    idOf[c] = id
    taken.add(id)
  }
  let free = 0
  for (let c = 0; c < count; c++) {
    if (idOf[c] >= 0) continue
    while (used.has(free)) free++
    idOf[c] = free
    used.add(free)
  }
  return idOf
}

/**
 * Groups participants (with these `labels` and features `points`, n × dim: principal components,
 * or a window of their traces) by digit or by Leiden cluster. For Leiden, a `previous` grouping of
 * the same participants is where clustering starts from, and whose ids carry over.
 */
export function groupParticipants(
  labels: number[],
  points: Float32Array,
  dim: number,
  by: GroupBy,
  settings: LeidenSettings,
  previous?: Grouping,
): Grouping {
  const n = labels.length
  if (by === 'digit') {
    const present = [...new Set(labels)].sort((a, b) => a - b)
    const index = new Map(present.map((d, i) => [d, i]))
    const groupOf = Int32Array.from(labels, (d) => index.get(d)!)
    const groups = summarise(labels, groupOf, present.length).map((g, i) => ({ ...g, name: String(present[i]) }))
    return { groups, groupOf }
  }
  if (n < 3) return { groups: [{ name: '1', id: 0, ...summarise(labels, new Int32Array(n), 1)[0] }], groupOf: new Int32Array(n) }
  const graph = knnGraph(points, n, dim, settings.neighbours)
  const initial = previous?.groupOf.length === n ? previous.groupOf : undefined
  const membership = leiden(graph, { resolution: settings.resolution, iterations: 2, seed: settings.seed, initial })
  const count = Math.max(...membership) + 1
  const clusters = summarise(labels, membership, count)
  const idOf = stableIds(membership, count, previous)
  // In id order, so the legend and grouped chords keep their places from one run to the next.
  const order = clusters.map((_, c) => c).sort((a, b) => idOf[a] - idOf[b])
  const rank = new Int32Array(count)
  order.forEach((c, i) => (rank[c] = i))
  const groups = order.map((c) => ({ ...clusters[c], id: idOf[c], name: String(idOf[c] + 1) }))
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


/**
 * Up to `perGroup` participants per group: its members that come first in `order`, a random order of
 * every participant. A group's picks change only when one of them leaves or an earlier one joins, so
 * they hold steady through churn; and they're a fair sample, so groups merging show both.
 */
export function sampleGroups(groupCount: number, groupOf: Int32Array, order: number[], perGroup: number) {
  const picks = Array.from({ length: groupCount }, () => [] as number[])
  for (const i of order) if (picks[groupOf[i]]?.length < perGroup) picks[groupOf[i]].push(i)
  return picks
}
