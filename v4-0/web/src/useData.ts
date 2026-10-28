import { useEffect, useState } from 'react'
import { MAX_PARTICIPANTS } from './protocol'

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
  /**
   * Grayscale pixels of matrix.png, row-major, nSamples × nPixels, then a row for each participant slot (see `liveRow`):
   * what they've drawn so far, written as they draw.
   */
  pixels: Uint8Array
  /** Principal components, a row per digit and then per participant slot, as `pixels`; participants' as projected. */
  pcs: Float32Array
  /** Each row's label, as `pixels`: a digit's, or −1 for a participant's. */
  labels: number[]
  /** The PCA the components came from, to project drawings with: pcs = (pixels / 255 − mean) · loadings. */
  pca: { mean: Float32Array; loadings: Float32Array }
}

/** The row of `pixels` (and `pcs`, `labels`) holding the drawing of the participant in `slot`. */
export const liveRow = (meta: Meta, slot: number) => meta.nSamples + slot

/** Projects participant rows' drawings onto the principal components, into `pcs`. */
export function projectDrawings(data: PoolData, rows: number[]) {
  const { meta, pixels, pcs, pca } = data
  const { nPixels, nPcs } = meta
  const centred = new Float32Array(nPixels)
  for (const row of rows) {
    for (let p = 0; p < nPixels; p++) centred[p] = pixels[row * nPixels + p] / 255 - pca.mean[p]
    for (let k = 0; k < nPcs; k++) {
      let s = 0
      for (let p = 0; p < nPixels; p++) s += centred[p] * pca.loadings[k * nPixels + p]
      pcs[row * nPcs + k] = s
    }
  }
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
          throw new Error('No meta.json yet. Generate the data first: cd pipeline && uv run v4-0.py')
        return r.json() as Promise<Meta>
      }),
      loadPixels(`${base}/matrix.png`),
      fetch(`${base}/pcs.bin`).then((r) => r.arrayBuffer()),
      fetch(`${base}/pca.bin`).then((r) => r.arrayBuffer()),
    ])
      .then(([meta, pool, poolPcs, pcaBuffer]) => {
        // Room after the pool for each participant's drawing, blank (all paper) to start with.
        const rows = meta.nSamples + MAX_PARTICIPANTS
        const pixels = new Uint8Array(rows * meta.nPixels)
        pixels.set(pool)
        const pcs = new Float32Array(rows * meta.nPcs)
        pcs.set(new Float32Array(poolPcs))
        const labels = [...meta.rows.label, ...new Array<number>(MAX_PARTICIPANTS).fill(-1)]
        const pca = new Float32Array(pcaBuffer)
        const data: PoolData = {
          meta,
          pixels,
          pcs,
          labels,
          pca: { mean: pca.subarray(0, meta.nPixels), loadings: pca.subarray(meta.nPixels) },
        }
        projectDrawings(data, Array.from({ length: MAX_PARTICIPANTS }, (_, slot) => liveRow(meta, slot)))
        setState({ data })
      })
      .catch((e: Error) => setState({ error: e.message }))
  }, [])

  return state
}
