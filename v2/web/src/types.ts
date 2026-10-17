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
  /** Side length of each available resolution (digits padded to 32×32, then average-pooled), largest first. */
  resolutions: number[]
  nClusters: number
  clusters: ClusterSummary[]
  rows: {
    sourceIndex: number[]
    label: number[]
    cluster: number[]
  }
  /** Per-row coordinates keyed by projection name, e.g. umap2d_r32 -> [x, y], pacmap3d_r4 -> [x, y, z]. */
  projections: Record<string, number[][]>
  sortings: Record<GroupKey, Record<WithinKey, Sorting>>
}

/** How rows are grouped in the sorted matrix. */
export type GroupKey = 'leiden' | 'label'
/** How rows are ordered inside each group. */
export type WithinKey = 'random' | 'pc1'

export interface Sorting {
  /** order[displayRow] = original row index in matrix_original_r<r>.png */
  order: number[]
  /** Display rows where a new group (cluster or digit) begins. */
  boundaries: number[]
}

/** Shared view of one matrix: which original row is drawn at each display row. */
export interface RowView {
  rowAt: (displayRow: number) => number
}
