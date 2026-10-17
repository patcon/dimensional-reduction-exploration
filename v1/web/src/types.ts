export interface ClusterSummary {
  id: number
  start: number
  size: number
  labelCounts: number[]
  majorityLabel: number
  purity: number
}

export interface Meta {
  params: Record<string, number>
  nSamples: number
  nPixels: number
  nClusters: number
  clusters: ClusterSummary[]
  rows: {
    sourceIndex: number[]
    label: number[]
    cluster: number[]
    umap: [number, number][]
  }
  sortedOrder: number[]
}

/** Shared view of one matrix: which original row is drawn at each display row. */
export interface RowView {
  rowAt: (displayRow: number) => number
}
