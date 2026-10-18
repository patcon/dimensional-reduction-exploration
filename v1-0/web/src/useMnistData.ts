import { useEffect, useState } from 'react'
import type { GroupKey, Meta, WithinKey } from './types'

const base = `${import.meta.env.BASE_URL}data`

export interface MnistData {
  meta: Meta
  /** Grayscale pixels of matrix_original.png, row-major, nSamples x nPixels. */
  pixels: Uint8Array
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
    Promise.all([
      fetch(`${base}/meta.json`).then((r) => {
        // Vite's dev server answers a missing file with index.html, so check it really is JSON.
        if (!r.ok || !r.headers.get('content-type')?.includes('json'))
          throw new Error(`No meta.json yet. Generate the data first: cd pipeline && uv run v1-0.py`)
        return r.json() as Promise<Meta>
      }),
      loadPixels(`${base}/matrix_original.png`),
    ])
      .then(([meta, px]) => setState({ data: { meta, pixels: px.data } }))
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}

export const MATRIX_URLS = {
  original: `${base}/matrix_original.png`,
  sorted: (group: GroupKey, within: WithinKey) => `${base}/matrix_sorted_${group}_${within}.png`,
}
