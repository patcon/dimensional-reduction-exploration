/**
 * The kNN graph scanpy's `sc.pp.neighbors` builds (method "umap"), for the handful of digits
 * picked in the browser: exact k nearest neighbours (the point itself counted as the first),
 * then UMAP's fuzzy simplicial set as edge weights. `pnpm run check:leiden` compares it with
 * scanpy's own on the same points.
 */

/** An undirected weighted graph in compressed sparse rows: node i's neighbours are nbrs[offsets[i]..offsets[i+1]]. */
export interface Graph {
  n: number
  offsets: Int32Array
  nbrs: Int32Array
  weights: Float64Array
}

const SMOOTH_K_TOLERANCE = 1e-5
const MIN_K_DIST_SCALE = 1e-3
const N_ITER = 64

/** Each row's k nearest rows (itself first) and their euclidean distances. `points` is n × dim. */
export function nearestNeighbours(points: Float32Array, n: number, dim: number, k: number) {
  const indices = new Int32Array(n * k)
  const dists = new Float64Array(n * k)
  // Squared distances, each pair computed once; n is at most a few hundred.
  const d2 = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let c = 0; c < dim; c++) {
        const diff = points[i * dim + c] - points[j * dim + c]
        s += diff * diff
      }
      d2[i * n + j] = d2[j * n + i] = s
    }
  }
  // Per row, a running top k (the point itself first), kept sorted by insertion. Shifting only past
  // strictly farther entries keeps ties in index order, as a stable sort would.
  const best = new Float64Array(k)
  for (let i = 0; i < n; i++) {
    const row = indices.subarray(i * k, (i + 1) * k)
    best.fill(Infinity)
    best[0] = -1
    row[0] = i
    for (let j = 0; j < n; j++) {
      const s = d2[i * n + j]
      if (j === i || s >= best[k - 1]) continue
      let m = k - 1
      while (m > 1 && best[m - 1] > s) {
        best[m] = best[m - 1]
        row[m] = row[m - 1]
        m--
      }
      best[m] = s
      row[m] = j
    }
    for (let m = 0; m < k; m++) dists[i * k + m] = Math.sqrt(Math.max(0, best[m]))
  }
  return { indices, dists }
}

/** UMAP's smooth_knn_dist: per row, the distance to its nearest neighbour (rho) and a bandwidth (sigma). */
function smoothKnnDist(dists: Float64Array, n: number, k: number) {
  const target = Math.log2(k)
  const rhos = new Float64Array(n)
  const sigmas = new Float64Array(n)
  let meanAll = 0
  for (const d of dists) meanAll += d
  meanAll /= dists.length
  for (let i = 0; i < n; i++) {
    const row = dists.subarray(i * k, (i + 1) * k)
    const nonZero = Array.from(row).filter((d) => d > 0)
    if (nonZero.length >= 1) rhos[i] = nonZero[0]
    let lo = 0
    let hi = Infinity
    let mid = 1
    for (let it = 0; it < N_ITER; it++) {
      let psum = 0
      for (let j = 1; j < k; j++) {
        const d = row[j] - rhos[i]
        psum += d > 0 ? Math.exp(-(d / mid)) : 1
      }
      if (Math.abs(psum - target) < SMOOTH_K_TOLERANCE) break
      if (psum > target) {
        hi = mid
        mid = (lo + hi) / 2
      } else {
        lo = mid
        mid = hi === Infinity ? mid * 2 : (lo + hi) / 2
      }
    }
    let meanRow = 0
    for (const d of row) meanRow += d
    meanRow /= k
    const floor = MIN_K_DIST_SCALE * (rhos[i] > 0 ? meanRow : meanAll)
    sigmas[i] = Math.max(mid, floor)
  }
  return { rhos, sigmas }
}

/** Builds a graph from symmetric edge weights held as a map per row. */
function fromRows(rows: Map<number, number>[]): Graph {
  const n = rows.length
  const offsets = new Int32Array(n + 1)
  rows.forEach((row, i) => (offsets[i + 1] = offsets[i] + row.size))
  const nbrs = new Int32Array(offsets[n])
  const weights = new Float64Array(offsets[n])
  rows.forEach((row, i) => {
    let at = offsets[i]
    for (const [j, w] of [...row].sort((a, b) => a[0] - b[0])) {
      nbrs[at] = j
      weights[at++] = w
    }
  })
  return { n, offsets, nbrs, weights }
}

/** UMAP's directed membership strengths: directed[i] maps each of i's k nearest (not itself) to w(j|i). */
function memberships(points: Float32Array, n: number, dim: number, k: number) {
  const { indices, dists } = nearestNeighbours(points, n, dim, k)
  const { rhos, sigmas } = smoothKnnDist(dists, n, k)
  const directed: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (let i = 0; i < n; i++) {
    for (let m = 0; m < k; m++) {
      const j = indices[i * k + m]
      if (j === i) continue
      const d = dists[i * k + m] - rhos[i]
      const w = d <= 0 || sigmas[i] === 0 ? 1 : Math.exp(-d / sigmas[i])
      directed[i].set(j, w)
    }
  }
  return directed
}

/** scanpy's connectivities for `points` (n × dim): k includes the point itself, as in sc.pp.neighbors. */
export function knnGraph(points: Float32Array, n: number, dim: number, k: number): Graph {
  k = Math.max(2, Math.min(k, n))
  // Directed membership strengths, then the fuzzy union P + Pᵀ − P∘Pᵀ.
  const directed = memberships(points, n, dim, k)
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (let i = 0; i < n; i++) {
    for (const [j, w] of directed[i]) {
      const back = directed[j].get(i) ?? 0
      const sym = w + back - w * back
      if (sym > 0) {
        rows[i].set(j, sym)
        rows[j].set(i, sym)
      }
    }
  }
  return fromRows(rows)
}

/**
 * How much each point counts each other as a neighbour, dense n × n: `[i * n + j]` is w(j|i), UMAP's membership
 * strength of j in i's neighbourhood, 0 past i's k nearest. One-way, it isn't symmetric: an outlier counts the
 * dense points near it, which needn't count it back. Otherwise it's the fuzzy union, the weights `knnGraph` gives.
 */
export function neighbourAffinity(points: Float32Array, n: number, dim: number, k: number, oneWay: boolean) {
  const affinity = new Float32Array(n * n)
  if (n < 2) return affinity
  k = Math.max(2, Math.min(k, n))
  const directed = memberships(points, n, dim, k)
  for (let i = 0; i < n; i++) {
    for (const [j, w] of directed[i]) {
      if (oneWay) affinity[i * n + j] = w
      else {
        const back = directed[j].get(i) ?? 0
        affinity[i * n + j] = affinity[j * n + i] = w + back - w * back
      }
    }
  }
  return affinity
}

/** A graph from an undirected edge list (each edge once), e.g. scanpy's connectivities. */
export function graphFromEdges(n: number, i: number[], j: number[], w: number[]): Graph {
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  i.forEach((a, e) => {
    rows[a].set(j[e], w[e])
    rows[j[e]].set(a, w[e])
  })
  return fromRows(rows)
}
