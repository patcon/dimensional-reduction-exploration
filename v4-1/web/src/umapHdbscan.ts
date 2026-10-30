/**
 * Density clusters: UMAP embeds the points (in more dimensions than two, as it's not for looking at), then HDBSCAN
 * finds dense regions in the embedding, deciding how many there are itself and leaving stragglers as noise. Takes a
 * few hundred milliseconds for a few hundred points, so it runs in workers (umapHdbscan.worker.ts, and the music's).
 */
import { UMAP } from 'umap-js'
import { hdbscan, type HdbscanOptions } from './hdbscan.ts'
import { nearestNeighbours } from './knn.ts'
import { makeRng } from './rng.ts'

const UMAP_DIMS = 10
const UMAP_EPOCHS = 200

/**
 * Each point's cluster, largest first, or −1 for noise. `points` is n × dim; `neighbours` is UMAP's k, the point
 * itself counted (as knnGraph counts it). Too few points to embed are one cluster.
 */
export function umapHdbscan(points: Float32Array, n: number, dim: number, neighbours: number, options: HdbscanOptions, seed: number): Int32Array {
  const k = Math.max(2, Math.min(neighbours, n - 1))
  if (n <= k + 1 || n <= 3) return new Int32Array(n)
  const { indices, dists } = nearestNeighbours(points, n, dim, k)
  const umap = new UMAP({ nComponents: Math.min(UMAP_DIMS, n - 2), nNeighbors: k, minDist: 0, nEpochs: UMAP_EPOCHS, random: makeRng(seed) })
  umap.setPrecomputedKNN(
    Array.from({ length: n }, (_, i) => Array.from(indices.subarray(i * k, (i + 1) * k))),
    Array.from({ length: n }, (_, i) => Array.from(dists.subarray(i * k, (i + 1) * k))),
  )
  const embedding = umap.fit(Array.from({ length: n }, (_, i) => Array.from(points.subarray(i * dim, (i + 1) * dim))))
  const flat = Float64Array.from(embedding.flat())
  // Points that all read alike can leave UMAP nothing to go on: they're one cluster.
  return flat.every(Number.isFinite) ? hdbscan(flat, n, embedding[0].length, options) : new Int32Array(n)
}
