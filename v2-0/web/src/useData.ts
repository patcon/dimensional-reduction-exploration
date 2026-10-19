import { useEffect, useState } from 'react'
import { DIMS, PAIR_TYPES, type Dim, type Meta, type Pairs } from './types'

const base = `${import.meta.env.BASE_URL}data`

/** The sample sizes pipeline/v2-0.py exports, by their directory names. */
export const SAMPLE_SIZES = ['10k', '20k', '65k'] as const
export type SampleSize = (typeof SAMPLE_SIZES)[number]

export interface PacmapData {
  meta: Meta
  pairs: Pairs
  /** PaCMAP's layout before its first iteration, per dimension: float32, nSamples x dim row-major.
   * Both share the pairs; the 3D one is the 2D one plus the third principal component. */
  init: Record<Dim, Float32Array>
}

async function fetchBinary(dir: string, name: string) {
  const r = await fetch(`${dir}/${name}`)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.arrayBuffer()
}

async function load(size: SampleSize): Promise<PacmapData> {
  const dir = `${base}/${size}`
  const r = await fetch(`${dir}/meta.json`)
  // Vite's dev server answers a missing file with index.html, so check it really is JSON.
  if (!r.ok || !r.headers.get('content-type')?.includes('json'))
    throw new Error(`No ${size}/meta.json yet. Generate the data first: cd pipeline && uv run v2-0.py`)
  const meta = (await r.json()) as Meta
  const [init2, init3, ...pairBuffers] = await Promise.all([
    ...DIMS.map((dim) => fetchBinary(dir, `init_${dim}d.bin`)),
    ...PAIR_TYPES.map((type) => fetchBinary(dir, `pairs_${type}.bin`)),
  ])
  const pairs = Object.fromEntries(PAIR_TYPES.map((type, k) => [type, new Uint32Array(pairBuffers[k])])) as Pairs
  return { meta, pairs, init: { 2: new Float32Array(init2), 3: new Float32Array(init3) } }
}

/** Each size is fetched once, so switching back to one is instant. */
const cache = new Map<SampleSize, Promise<PacmapData>>()

/**
 * The dataset for `size`. While another size loads, the last one loaded stays as `data`, with
 * `loading` set, so whatever shows it can carry on until the new one arrives.
 */
export function useData(size: SampleSize) {
  const [state, setState] = useState<{ data?: PacmapData; size?: SampleSize; error?: string }>({})

  useEffect(() => {
    let current = true
    if (!cache.has(size)) cache.set(size, load(size))
    cache
      .get(size)!
      .then((data) => current && setState({ data, size }))
      .catch((e: Error) => {
        cache.delete(size)
        if (current) setState((s) => ({ ...s, error: e.message }))
      })
    return () => {
      current = false
    }
  }, [size])

  return { data: state.data, error: state.error, loading: state.size !== size && !state.error }
}
