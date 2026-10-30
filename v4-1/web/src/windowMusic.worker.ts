/** Works out the window's music (see windowMusic.ts) off the main thread: one request in, its answer out. */
import { analyseWindow, type MusicSettings } from './windowMusic.ts'

export interface WindowRequest {
  id: number
  rows: number[]
  features: Float32Array
  dim: number
  settings: MusicSettings
  seed: number
}

self.onmessage = (e: MessageEvent<WindowRequest>) => {
  const { id, rows, features, dim, settings, seed } = e.data
  const result = analyseWindow(rows, features, dim, settings, seed)
  const { graph, broad, fine } = result
  postMessage({ id, result }, { transfer: [graph.offsets.buffer, graph.nbrs.buffer, graph.weights.buffer, broad.buffer, fine.buffer] })
}
