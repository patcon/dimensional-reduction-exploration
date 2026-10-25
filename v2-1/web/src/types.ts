/** The layout's dimensions: PaCMAP runs in either. */
export type Dim = 2 | 3

export const DIMS: Dim[] = [2, 3]

export type PairType = 'nb' | 'mn' | 'fp'

export const PAIR_TYPES: PairType[] = ['nb', 'mn', 'fp']

/** Signed force multiplier per pair type: positive attracts, negative repels. */
export type Weights = Record<PairType, number>

/** Flat (i, j) index pairs per pair type: [i0, j0, i1, j1, ...]. */
export type Pairs = Record<PairType, Uint32Array>

export interface Schedule {
  /** Iterations in each of PaCMAP's three phases. */
  phases: [number, number, number]
  /** Mid-near weight at iteration 0, easing to 3 over phase 1. */
  wMnInit: number
}

export interface AdamParams {
  lr: number
  beta1: number
  beta2: number
  eps: number
}

/** data/meta.json, written by pipeline/v2-1.py. */
export interface Meta {
  nSamples: number
  seed: number
  labels: number[]
  sourceIndex: number[]
  pairs: Record<PairType, { count: number; perPoint: number }>
  dims: Dim[]
  reference: { iterations: number[] }
  schedule: Schedule
  adam: AdamParams
}
