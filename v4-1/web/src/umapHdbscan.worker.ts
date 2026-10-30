/** Density clusters (see umapHdbscan.ts) off the main thread, for grouping: one request in, its clusters out. */
import type { HdbscanOptions } from './hdbscan.ts'
import { umapHdbscan } from './umapHdbscan.ts'

export interface ClusterRequest {
  points: Float32Array
  n: number
  dim: number
  neighbours: number
  options: HdbscanOptions
  seed: number
}

export interface ClusterAnswer {
  /** Each point's cluster, largest first, or −1 for noise. */
  membership: Int32Array
}

self.onmessage = (e: MessageEvent<ClusterRequest>) => {
  const { points, n, dim, neighbours, options, seed } = e.data
  const membership = umapHdbscan(points, n, dim, neighbours, options, seed)
  postMessage({ membership } satisfies ClusterAnswer, { transfer: [membership.buffer] })
}
