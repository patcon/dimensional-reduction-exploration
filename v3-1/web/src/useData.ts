import { useEffect, useState } from 'react'

const base = `${import.meta.env.BASE_URL}data`

export interface Meta {
  params: Record<string, number>
  nSamples: number
  nPixels: number
  nPcs: number
  rows: { sourceIndex: number[]; label: number[] }
}

export interface PoolData {
  meta: Meta
  /** Grayscale pixels of matrix.png, row-major, nSamples × nPixels. */
  pixels: Uint8Array
  /** Principal components, nSamples × nPcs. */
  pcs: Float32Array
}

async function loadPixels(url: string) {
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
  return data
}

export function useData() {
  const [state, setState] = useState<{ data?: PoolData; error?: string }>({})

  useEffect(() => {
    Promise.all([
      fetch(`${base}/meta.json`).then((r) => {
        // Vite's dev server answers a missing file with index.html, so check it really is JSON.
        if (!r.ok || !r.headers.get('content-type')?.includes('json'))
          throw new Error('No meta.json yet. Generate the data first: cd pipeline && uv run v3-1.py')
        return r.json() as Promise<Meta>
      }),
      loadPixels(`${base}/matrix.png`),
      fetch(`${base}/pcs.bin`).then((r) => r.arrayBuffer()),
    ])
      .then(([meta, pixels, pcs]) => setState({ data: { meta, pixels, pcs: new Float32Array(pcs) } }))
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}
