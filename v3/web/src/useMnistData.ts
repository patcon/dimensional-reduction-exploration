import { useEffect, useState } from 'react'
import type { GroupKey, Meta, WithinKey } from './types'

const base = `${import.meta.env.BASE_URL}data`

export interface MnistData {
  meta: Meta
  /** Grayscale pixels of matrix_original_r<r>.png keyed by resolution r: row-major, nSamples x r*r. */
  pixels: Record<number, Uint8Array>
}

async function loadPixels(url: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data
  const data = new Uint8Array(img.width * img.height)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]
  return { data, width: img.width, height: img.height }
}

export function useMnistData() {
  const [state, setState] = useState<{ data?: MnistData; error?: string }>({})

  useEffect(() => {
    fetch(`${base}/meta.json`)
      .then((r) => {
        // Vite's dev server answers a missing file with index.html, so check it really is JSON.
        if (!r.ok || !r.headers.get('content-type')?.includes('json'))
          throw new Error(`No meta.json yet. Generate the data first: cd pipeline && uv run v3.py`)
        return r.json() as Promise<Meta>
      })
      .then(async (meta) => {
        const loaded = await Promise.all(meta.resolutions.map((res) => loadPixels(MATRIX_URLS.original(res))))
        const pixels = Object.fromEntries(meta.resolutions.map((res, i) => [res, loaded[i].data]))
        setState({ data: { meta, pixels } })
      })
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}

const evolutions = new Map<string, Promise<Float32Array>>()

/** Layout snapshots for one projection: float32, snapshots x nSamples x dims, row-major (cached). */
export function loadEvolution(name: string) {
  if (!evolutions.has(name)) {
    const request = fetch(`${base}/evolution/${name}.bin`).then(async (r) => {
      if (!r.ok) throw new Error(`evolution/${name}.bin: ${r.status}`)
      return new Float32Array(await r.arrayBuffer())
    })
    // Let a failed fetch be retried.
    request.catch(() => evolutions.delete(name))
    evolutions.set(name, request)
  }
  return evolutions.get(name)!
}

export const MATRIX_URLS = {
  original: (res: number) => `${base}/matrix_original_r${res}.png`,
  sorted: (group: GroupKey, within: WithinKey, res: number) => `${base}/matrix_sorted_${group}_${within}_r${res}.png`,
}
