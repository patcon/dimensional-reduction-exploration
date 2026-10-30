import { useEffect, useState } from 'react'

const base = `${import.meta.env.BASE_URL}data`

export interface Meta {
  params: Record<string, number>
  nSamples: number
  nPixels: number
  nPcs: number
  umapDims: number
  rows: { sourceIndex: number[]; label: number[] }
}

/** The digits, as pipeline/v5-0.py writes them: worked out once, on every digit. */
export interface MapData {
  meta: Meta
  /** Grayscale pixels of digits.png, row-major, nSamples × nPixels. */
  pixels: Uint8Array
  /** Principal components, nSamples × nPcs: for the walk's nearest neighbours, and Leiden. */
  pcs: Float32Array
  /** UMAP of the components, nSamples × umapDims: for HDBSCAN. */
  umap: Float32Array
  /** PaCMAP of the components, nSamples × 2: the map. */
  xy: Float32Array
  labels: number[]
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

async function loadFloats(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Float32Array(await res.arrayBuffer())
}

export function useData() {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([
      fetch(`${base}/meta.json`).then((r) => r.json() as Promise<Meta>),
      loadPixels(`${base}/digits.png`),
      loadFloats(`${base}/pcs.bin`),
      loadFloats(`${base}/umap.bin`),
      loadFloats(`${base}/xy.bin`),
    ])
      .then(([meta, pixels, pcs, umap, xy]) => setData({ meta, pixels, pcs, umap, xy, labels: meta.rows.label }))
      .catch(() => setError('Couldn’t load the digits. Run pipeline/v5-0.py first.'))
  }, [])
  return { data, error }
}
