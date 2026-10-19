import { useEffect, useState } from 'react'
import { DIMS, PAIR_TYPES, type Dim, type Meta, type Pairs } from './types'

const base = `${import.meta.env.BASE_URL}data`

export interface PacmapData {
  meta: Meta
  pairs: Pairs
  /** PaCMAP's layout before its first iteration, per dimension: float32, nSamples x dim row-major.
   * Both share the pairs; the 3D one is the 2D one plus the third principal component. */
  init: Record<Dim, Float32Array>
}

async function fetchBinary(name: string) {
  const r = await fetch(`${base}/${name}`)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.arrayBuffer()
}

export function useData() {
  const [state, setState] = useState<{ data?: PacmapData; error?: string }>({})

  useEffect(() => {
    fetch(`${base}/meta.json`)
      .then((r) => {
        // Vite's dev server answers a missing file with index.html, so check it really is JSON.
        if (!r.ok || !r.headers.get('content-type')?.includes('json'))
          throw new Error(`No meta.json yet. Generate the data first: cd pipeline && uv run v2-0.py`)
        return r.json() as Promise<Meta>
      })
      .then(async (meta) => {
        const [init2, init3, ...pairBuffers] = await Promise.all([
          ...DIMS.map((dim) => fetchBinary(`init_${dim}d.bin`)),
          ...PAIR_TYPES.map((type) => fetchBinary(`pairs_${type}.bin`)),
        ])
        const pairs = Object.fromEntries(PAIR_TYPES.map((type, k) => [type, new Uint32Array(pairBuffers[k])])) as Pairs
        setState({ data: { meta, pairs, init: { 2: new Float32Array(init2), 3: new Float32Array(init3) } } })
      })
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}
