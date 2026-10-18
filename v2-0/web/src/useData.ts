import { useEffect, useState } from 'react'
import { PAIR_TYPES, type Meta, type Pairs } from './types'

const base = `${import.meta.env.BASE_URL}data`

export interface PacmapData {
  meta: Meta
  pairs: Pairs
  /** PaCMAP's layout before its first iteration: float32, nSamples x 2 row-major. */
  init: Float32Array
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
        const [init, ...pairBuffers] = await Promise.all([
          fetchBinary('init.bin'),
          ...PAIR_TYPES.map((type) => fetchBinary(`pairs_${type}.bin`)),
        ])
        const pairs = Object.fromEntries(PAIR_TYPES.map((type, k) => [type, new Uint32Array(pairBuffers[k])])) as Pairs
        setState({ data: { meta, pairs, init: new Float32Array(init) } })
      })
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}
