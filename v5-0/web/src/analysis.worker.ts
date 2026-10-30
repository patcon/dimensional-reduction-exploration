/** The map's music (see analysis.ts) off the main thread: the data once, then one request in, its groups out. */
import { Analyser, type AnalysisRequest, type MapMusic } from './analysis.ts'

export type WorkerMessage =
  | { type: 'data'; labels: number[]; pcs: Float32Array; nPcs: number; umap: Float32Array; umapDims: number }
  | ({ type: 'analyse' } & AnalysisRequest)

export interface AnalysisAnswer {
  result: MapMusic
}

let analyser: Analyser | null = null

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data
  if (msg.type === 'data') {
    analyser = new Analyser(msg)
    return
  }
  const result = analyser!.analyse(msg)
  postMessage({ result } satisfies AnalysisAnswer)
}
