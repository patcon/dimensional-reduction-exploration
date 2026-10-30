/**
 * HDBSCAN (Campello, Moulavi & Sander 2013), excess-of-mass selection, for the few hundred points the browser
 * clusters: it finds dense regions and decides how many there are itself, and leaves stragglers out as noise (−1)
 * rather than forcing them into a cluster.
 *
 * Each point's core distance is how far its `minSamples`th nearest is. Mutual reachability between two points is the
 * largest of their distance and both core distances, so sparse points sit further from everything. Its minimum
 * spanning tree, cut at ever shorter edges, splits the points apart; a split where both sides have at least
 * `minClusterSize` points makes two new clusters, and any smaller piece falls out as noise. Clusters are then chosen
 * from that tree by how long they last (their stability), a parent winning over its children when it outlasts them.
 */

export interface HdbscanOptions {
  minClusterSize: number
  minSamples: number
  /** Let every point be one cluster, the root; otherwise there are always at least two, or none at all. */
  allowSingle: boolean
}

/** Past this density, distances count as 0 (so identical points don't make an infinite λ). */
const MAX_LAMBDA = 1e6

/** Each point's cluster, numbered largest first, or −1 for noise. `points` is n × dim. */
export function hdbscan(points: Float32Array | Float64Array, n: number, dim: number, options: HdbscanOptions): Int32Array {
  if (n < 2) return new Int32Array(n)
  const minClusterSize = Math.max(2, options.minClusterSize)
  const dist = (a: number, b: number) => {
    let s = 0
    for (let c = 0; c < dim; c++) {
      const d = points[a * dim + c] - points[b * dim + c]
      s += d * d
    }
    return Math.sqrt(s)
  }

  // Core distances: to the kth nearest, the point itself counted first (as scikit-learn's).
  const k = Math.max(1, Math.min(options.minSamples, n - 1))
  const core = new Float64Array(n)
  const nearest = new Float64Array(k + 1)
  for (let a = 0; a < n; a++) {
    nearest.fill(Infinity)
    nearest[0] = 0
    for (let b = 0; b < n; b++) {
      if (b === a) continue
      const d = dist(a, b)
      if (d >= nearest[k]) continue
      let m = k
      while (m > 0 && nearest[m - 1] > d) {
        nearest[m] = nearest[m - 1]
        m--
      }
      nearest[m] = d
    }
    core[a] = nearest[k - 1]
  }

  // Prim's minimum spanning tree over mutual reachability, its edges shortest first.
  const inTree = new Uint8Array(n)
  const best = new Float64Array(n).fill(Infinity)
  const from = new Int32Array(n)
  const edges: [number, number, number][] = []
  let current = 0
  inTree[0] = 1
  for (let added = 1; added < n; added++) {
    let next = -1
    let nextDist = Infinity
    for (let b = 0; b < n; b++) {
      if (inTree[b]) continue
      const m = Math.max(core[current], core[b], dist(current, b))
      if (m < best[b]) {
        best[b] = m
        from[b] = current
      }
      if (best[b] < nextDist) {
        nextDist = best[b]
        next = b
      }
    }
    edges.push([from[next], next, nextDist])
    inTree[next] = 1
    current = next
  }
  edges.sort((x, y) => x[2] - y[2])

  // Single linkage: node n + i joins two earlier nodes at the ith edge's length.
  const size = new Int32Array(2 * n).fill(1)
  const parentOf = Int32Array.from({ length: 2 * n }, (_, i) => i)
  const left = new Int32Array(2 * n)
  const right = new Int32Array(2 * n)
  const height = new Float64Array(2 * n)
  const find = (x: number) => {
    while (parentOf[x] !== x) {
      parentOf[x] = parentOf[parentOf[x]]
      x = parentOf[x]
    }
    return x
  }
  let node = n
  for (const [a, b, w] of edges) {
    const ra = find(a)
    const rb = find(b)
    left[node] = ra
    right[node] = rb
    height[node] = w
    size[node] = size[ra] + size[rb]
    parentOf[ra] = parentOf[rb] = node
    node++
  }
  const root = node - 1
  const lambdaOf = (h: number) => (h > 1 / MAX_LAMBDA ? 1 / h : MAX_LAMBDA)

  // The condensed tree: clusters (0 the root), each born at a λ, and how stable each is.
  const parent = [-1]
  const birth = [0]
  const children: number[][] = [[]]
  const stability = [0]
  const clusterOfPoint = new Int32Array(n)
  /** Every point under `start` falls out of cluster `c` at `lambda`. */
  const fallOut = (start: number, c: number, lambda: number) => {
    const stack = [start]
    while (stack.length) {
      const x = stack.pop()!
      if (x < n) {
        clusterOfPoint[x] = c
        stability[c] += lambda - birth[c]
      } else stack.push(left[x], right[x])
    }
  }
  const stack: [number, number][] = [[root, 0]]
  while (stack.length) {
    const [x, c] = stack.pop()!
    if (x < n) {
      clusterOfPoint[x] = c
      stability[c] += MAX_LAMBDA - birth[c]
      continue
    }
    const lambda = lambdaOf(height[x])
    const l = left[x]
    const r = right[x]
    const bigL = size[l] >= minClusterSize
    const bigR = size[r] >= minClusterSize
    if (bigL && bigR) {
      for (const child of [l, r]) {
        const id = parent.length
        parent.push(c)
        birth.push(lambda)
        children.push([])
        stability.push(0)
        children[c].push(id)
        stability[c] += size[child] * (lambda - birth[c])
        stack.push([child, id])
      }
    } else {
      // The cluster carries on through the bigger side; a side too small falls out of it.
      if (bigL) stack.push([l, c])
      else fallOut(l, c, lambda)
      if (bigR) stack.push([r, c])
      else fallOut(r, c, lambda)
    }
  }

  // Excess of mass: from the leaves up, a cluster is chosen if it's more stable than its chosen descendants together.
  const count = parent.length
  const chosen = new Uint8Array(count)
  const kept = new Float64Array(count)
  const unchoose = (c: number) => {
    const s = [...children[c]]
    while (s.length) {
      const x = s.pop()!
      chosen[x] = 0
      s.push(...children[x])
    }
  }
  for (let c = count - 1; c >= 0; c--) {
    const canChoose = c !== 0 || options.allowSingle
    const below = children[c].reduce((s, x) => s + kept[x], 0)
    if (!children[c].length) {
      if (canChoose) chosen[c] = 1
      kept[c] = stability[c]
    } else if (stability[c] > below && canChoose) {
      chosen[c] = 1
      kept[c] = stability[c]
      unchoose(c)
    } else kept[c] = below
  }

  // Each point's chosen cluster is the nearest chosen one above where it fell out; none, and it's noise.
  const raw = new Int32Array(n).fill(-1)
  const index = new Map<number, number>()
  for (let p = 0; p < n; p++) {
    let c = clusterOfPoint[p]
    while (c >= 0 && !chosen[c]) c = parent[c]
    if (c < 0) continue
    if (!index.has(c)) index.set(c, index.size)
    raw[p] = index.get(c)!
  }
  const sizes = new Map<number, number>()
  for (const c of raw) if (c >= 0) sizes.set(c, (sizes.get(c) ?? 0) + 1)
  const rank = new Map([...sizes].sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i]))
  return raw.map((c) => (c < 0 ? -1 : rank.get(c)!))
}
