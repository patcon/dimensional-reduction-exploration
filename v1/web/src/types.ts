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
  }
  /** Per-row coordinates keyed by projection name, e.g. umap2d -> [x, y], umap3d -> [x, y, z]. */
  projections: Record<string, number[][]>
  sortings: Record<SortKey, Sorting>
}

export type SortKey = 'leiden' | 'label'

export interface Sorting {
  /** order[displayRow] = original row index in matrix_original.png */
  order: number[]
  /** Display rows where a new group (cluster or digit) begins. */
  boundaries: number[]
}

/** Shared view of one matrix: which original row is drawn at each display row. */
export interface RowView {
  rowAt: (displayRow: number) => number
}
