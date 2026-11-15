/** Grouping (analysis.ts) off the main thread: one window in, its groups out, with the phones' keys handed back. */
import { analyse, type Analysis, type AnalysisRequest } from './analysis.ts'

export type AnalysisMessage = AnalysisRequest & { keys: string[] }
export type AnalysisAnswer = Analysis & { keys: string[] }

self.onmessage = (e: MessageEvent<AnalysisMessage>) => {
  const { keys, ...req } = e.data
  const result = analyse(req)
  postMessage({ ...result, keys } satisfies AnalysisAnswer, { transfer: [result.S.buffer, result.edges.buffer] })
}
