/**
 * Leiden community detection (Traag, Waltman & van Eck 2019) on modularity, as scanpy's
 * `sc.tl.leiden(flavor="igraph")` runs it: weighted, undirected, with a resolution γ and a
 * fixed number of iterations, each starting from the last one's clusters.
 *
 * Each pass moves nodes between clusters while that raises modularity, refines every cluster
 * into well-connected pieces (so no cluster ends up disconnected, Leiden's fix over Louvain),
 * then collapses the refined pieces into single nodes and repeats on that smaller graph,
 * until nothing more can be merged. `pnpm run check:leiden` compares it with igraph's.
 */
import type { Graph } from './knn.ts'
import { makeRng, shuffle } from './rng.ts'

export interface LeidenOptions {
  resolution: number
  /** Whole passes; 2 is scanpy's default. */
  iterations: number
  seed: number
  /** Randomness in the refinement step; igraph's default. */
  beta?: number
}

/** A graph during aggregation: nodes may stand for many original nodes, so they carry their total strength. */
interface Level {
  graph: Graph
  /** Each node's strength (weighted degree) in the original graph, summed over the nodes it stands for. */
  strength: Float64Array
}

function strengths(g: Graph) {
  const k = new Float64Array(g.n)
  for (let i = 0; i < g.n; i++) for (let e = g.offsets[i]; e < g.offsets[i + 1]; e++) k[i] += g.weights[e]
  return k
}

/** Modularity Q = 1/2m Σ_ij (A_ij − γ k_i k_j / 2m) δ(c_i, c_j), as igraph's `Graph.modularity`. */
export function modularity(g: Graph, membership: ArrayLike<number>, resolution = 1) {
  const k = strengths(g)
  let twoM = 0
  for (const x of k) twoM += x
  if (twoM === 0) return 0
  const total = new Map<number, number>()
  let inside = 0
  for (let i = 0; i < g.n; i++) {
    total.set(membership[i], (total.get(membership[i]) ?? 0) + k[i])
    for (let e = g.offsets[i]; e < g.offsets[i + 1]; e++) if (membership[g.nbrs[e]] === membership[i]) inside += g.weights[e]
  }
  let expected = 0
  for (const K of total.values()) expected += K * K
  return (inside - (resolution * expected) / twoM) / twoM
}

/** Renumbers clusters 0..c−1, largest first (ties by first appearance). */
function renumber(membership: Int32Array) {
  const sizes = new Map<number, number>()
  const first = new Map<number, number>()
  membership.forEach((c, i) => {
    sizes.set(c, (sizes.get(c) ?? 0) + 1)
    if (!first.has(c)) first.set(c, i)
  })
  const ids = [...sizes.keys()].sort((a, b) => sizes.get(b)! - sizes.get(a)! || first.get(a)! - first.get(b)!)
  const to = new Map(ids.map((c, i) => [c, i]))
  return membership.map((c) => to.get(c)!)
}

export function leiden(g: Graph, { resolution, iterations, seed, beta = 0.01 }: LeidenOptions): Int32Array {
  const rand = makeRng(seed)
  const k = strengths(g)
  let twoM = 0
  for (const x of k) twoM += x
  let membership = Int32Array.from({ length: g.n }, (_, i) => i)
  if (twoM === 0) return membership
  // γ / 2m: the cost of putting two units of strength in one cluster.
  const gamma = resolution / twoM

  for (let it = 0; it < iterations; it++) {
    let level: Level = { graph: g, strength: k }
    // Which level-node each original node is currently part of.
    let nodeOf = Int32Array.from({ length: g.n }, (_, i) => i)
    let partition = Int32Array.from(membership)
    for (;;) {
      partition = moveNodesFast(level, partition, gamma, rand)
      const clusters = new Set(partition).size
      if (clusters === level.graph.n) break
      let refined = refine(level, partition, gamma, beta, rand)
      // If refinement merged nothing, collapse the clusters themselves (as igraph does), so each pass shrinks the graph.
      if (new Set(refined).size === level.graph.n) refined = partition
      const { next, mapping } = aggregate(level, refined)
      // The collapsed graph starts from the unrefined clusters, so refinement never undoes a merge.
      const ids = new Map<number, number>()
      const nextPartition = new Int32Array(next.graph.n)
      for (let v = 0; v < level.graph.n; v++) {
        if (!ids.has(partition[v])) ids.set(partition[v], ids.size)
        nextPartition[mapping[v]] = ids.get(partition[v])!
      }
      nodeOf = nodeOf.map((v) => mapping[v])
      level = next
      partition = nextPartition
    }
    membership = renumber(nodeOf.map((v) => partition[v]))
  }
  return membership
}

/** Moves each node, from a queue in random order, to the neighbouring cluster (or a new, empty one) that gains most. */
function moveNodesFast({ graph, strength }: Level, initial: Int32Array, gamma: number, rand: () => number) {
  const n = graph.n
  const partition = Int32Array.from(initial)
  const total = new Float64Array(n)
  const size = new Int32Array(n)
  for (let v = 0; v < n; v++) {
    total[partition[v]] += strength[v]
    size[partition[v]]++
  }
  const empty: number[] = []
  for (let c = n - 1; c >= 0; c--) if (size[c] === 0) empty.push(c)

  const queue = shuffle(Array.from({ length: n }, (_, i) => i), rand)
  const queued = new Uint8Array(n).fill(1)
  const linkTo = new Float64Array(n)
  const touched: number[] = []
  let head = 0
  while (head < queue.length) {
    const v = queue[head++]
    queued[v] = 0
    const from = partition[v]
    for (let e = graph.offsets[v]; e < graph.offsets[v + 1]; e++) {
      const u = graph.nbrs[e]
      if (u === v) continue
      const c = partition[u]
      if (linkTo[c] === 0) touched.push(c)
      linkTo[c] += graph.weights[e]
    }
    total[from] -= strength[v]
    size[from]--
    // Staying put competes on the same footing as moving.
    let best = from
    let bestGain = linkTo[from] - gamma * strength[v] * total[from]
    for (const c of touched) {
      const gain = linkTo[c] - gamma * strength[v] * total[c]
      if (gain > bestGain) {
        best = c
        bestGain = gain
      }
    }
    if (bestGain < 0) {
      // On its own beats every neighbour: an empty cluster (its old one, if it was alone there).
      best = size[from] === 0 ? from : empty.pop()!
    }
    for (const c of touched) linkTo[c] = 0
    touched.length = 0
    total[best] += strength[v]
    size[best]++
    if (size[from] === 0 && best !== from) empty.push(from)
    if (best !== from) {
      partition[v] = best
      for (let e = graph.offsets[v]; e < graph.offsets[v + 1]; e++) {
        const u = graph.nbrs[e]
        if (!queued[u] && partition[u] !== best) {
          queued[u] = 1
          queue.push(u)
        }
      }
    }
  }
  return partition
}

/**
 * Splits each cluster into well-connected pieces: starting from singletons, each still-alone
 * node that is well connected to the rest of its cluster may join a well-connected piece of
 * the same cluster, picked at random weighted towards the biggest gain.
 */
function refine({ graph, strength }: Level, partition: Int32Array, gamma: number, beta: number, rand: () => number) {
  const n = graph.n
  const refined = Int32Array.from({ length: n }, (_, i) => i)
  const clusterTotal = new Float64Array(n)
  for (let v = 0; v < n; v++) clusterTotal[partition[v]] += strength[v]
  // Per refined piece: its strength, size, and edge weight to the rest of its cluster.
  const total = Float64Array.from(strength)
  const size = new Int32Array(n).fill(1)
  const external = new Float64Array(n)
  for (let v = 0; v < n; v++)
    for (let e = graph.offsets[v]; e < graph.offsets[v + 1]; e++)
      if (graph.nbrs[e] !== v && partition[graph.nbrs[e]] === partition[v]) external[v] += graph.weights[e]

  const linkTo = new Float64Array(n)
  const touched: number[] = []
  for (const v of shuffle(Array.from({ length: n }, (_, i) => i), rand)) {
    const own = refined[v]
    if (size[own] !== 1) continue
    const C = clusterTotal[partition[v]]
    if (external[own] < gamma * strength[v] * (C - strength[v])) continue
    for (let e = graph.offsets[v]; e < graph.offsets[v + 1]; e++) {
      const u = graph.nbrs[e]
      if (u === v || partition[u] !== partition[v]) continue
      const r = refined[u]
      if (linkTo[r] === 0) touched.push(r)
      linkTo[r] += graph.weights[e]
    }
    const options: number[] = [own]
    const gains: number[] = [0]
    for (const r of touched) {
      if (r === own) continue
      if (external[r] < gamma * total[r] * (C - total[r])) continue
      const gain = linkTo[r] - gamma * strength[v] * total[r]
      if (gain >= 0) {
        options.push(r)
        gains.push(gain)
      }
    }
    const maxGain = Math.max(...gains)
    const odds = gains.map((g) => Math.exp((g - maxGain) / beta))
    let pick = rand() * odds.reduce((a, b) => a + b, 0)
    let chosen = options[options.length - 1]
    for (let o = 0; o < options.length; o++) {
      pick -= odds[o]
      if (pick <= 0) {
        chosen = options[o]
        break
      }
    }
    if (chosen !== own) {
      // Joining r: its external weight gains v's, less the edges between them (now inside).
      external[chosen] += external[own] - 2 * linkTo[chosen]
      total[chosen] += strength[v]
      size[chosen]++
      size[own] = 0
      refined[v] = chosen
    }
    for (const r of touched) linkTo[r] = 0
    touched.length = 0
  }
  return refined
}

/** Collapses each refined piece into one node, summing edge weights between pieces and the strengths within each. */
function aggregate({ graph, strength }: Level, refined: Int32Array) {
  const ids = new Map<number, number>()
  const mapping = new Int32Array(graph.n)
  for (let v = 0; v < graph.n; v++) {
    if (!ids.has(refined[v])) ids.set(refined[v], ids.size)
    mapping[v] = ids.get(refined[v])!
  }
  const m = ids.size
  const nextStrength = new Float64Array(m)
  const rows: Map<number, number>[] = Array.from({ length: m }, () => new Map())
  for (let v = 0; v < graph.n; v++) {
    const a = mapping[v]
    nextStrength[a] += strength[v]
    for (let e = graph.offsets[v]; e < graph.offsets[v + 1]; e++) {
      const b = mapping[graph.nbrs[e]]
      rows[a].set(b, (rows[a].get(b) ?? 0) + graph.weights[e])
    }
  }
  const offsets = new Int32Array(m + 1)
  rows.forEach((row, i) => (offsets[i + 1] = offsets[i] + row.size))
  const nbrs = new Int32Array(offsets[m])
  const weights = new Float64Array(offsets[m])
  rows.forEach((row, i) => {
    let at = offsets[i]
    for (const [j, w] of row) {
      nbrs[at] = j
      weights[at++] = w
    }
  })
  return { next: { graph: { n: m, offsets, nbrs, weights }, strength: nextStrength }, mapping }
}
