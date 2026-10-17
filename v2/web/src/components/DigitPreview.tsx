import { useEffect, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { DIGIT_COLORS } from '../palette'
import { useSweepFrames, type Sweep } from '../sweep'

const PREVIEW_SIZE = 112
const SWEEP_TAIL_MS = 30 // trail behind the head, in time (so it shrinks as the head slows)

export function DigitPreview({
  data,
  row,
  resolution,
  pixelOrder,
  pinned,
  sweep,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  resolution: number
  pixelOrder: number[] | null
  pinned: boolean
  sweep: Sweep | null
  onUnpin: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  // The preview stays the same size at every resolution; cells just get bigger.
  const nPixels = resolution * resolution
  const cell = PREVIEW_SIZE / resolution

  // Walk a red pixel through the digit cell by cell: the same order its row is laid out in the matrix.
  useSweepFrames(sweep, SWEEP_TAIL_MS, nPixels, (frame) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    if (!frame || frame.row !== row) return
    ctx.fillStyle = getComputedStyle(canvas).color
    const head = Math.floor(frame.pixel)
    const tail = Math.floor(frame.tailPixel)
    const length = head - tail + 1
    for (let i = Math.max(tail, 0); i <= Math.min(head, nPixels - 1); i++) {
      ctx.globalAlpha = ((i - tail + 1) / length) ** 1.5
      ctx.fillRect((i % resolution) * cell, Math.floor(i / resolution) * cell, cell, cell)
    }
    ctx.globalAlpha = 1
  })
  const { meta, pixels } = data

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(resolution, resolution)
    if (row !== null) {
      const offset = row * nPixels
      // Fold the row back into a square in its current column order, so a shuffle scrambles the digit too.
      for (let i = 0; i < nPixels; i++) {
        const v = pixels[resolution][offset + (pixelOrder ? pixelOrder[i] : i)]
        img.data.set([v, v, v, 255], i * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [row, pixels, resolution, nPixels, pixelOrder])

  const cluster = row === null ? null : meta.clusters.find((c) => c.id === meta.rows.cluster[row])!
  const label = row === null ? null : meta.rows.label[row]

  return (
    <div className="digit-preview">
      <div className="digit-canvas">
        <canvas ref={ref} width={resolution} height={resolution} />
        <canvas
          ref={overlayRef}
          className="sweep-overlay"
          width={PREVIEW_SIZE * dpr}
          height={PREVIEW_SIZE * dpr}
          aria-hidden
        />
      </div>
      {row === null ? (
        <p className="muted">Hover a row in either matrix, a sample, or a point in the projection. Click to pin it.</p>
      ) : (
        <dl>
          <dt>Label</dt>
          <dd>
            <span className="swatch" style={{ background: DIGIT_COLORS[label!] }} /> {label}
          </dd>
          <dt>Cluster</dt>
          <dd>
            <span className="swatch" style={{ background: DIGIT_COLORS[cluster!.majorityLabel] }} /> #{cluster!.id}{' '}
            <span className="muted">
              (mostly {cluster!.majorityLabel}, {Math.round(cluster!.purity * 100)}% pure)
            </span>
          </dd>
          <dt>MNIST index</dt>
          <dd>{meta.rows.sourceIndex[row]}</dd>
          <dt>{pinned ? 'Pinned' : ''}</dt>
          <dd>
            {pinned ? (
              <button className="link" onClick={onUnpin}>
                Unpin (Esc)
              </button>
            ) : (
              <span className="muted">Click to pin</span>
            )}
          </dd>
        </dl>
      )}
    </div>
  )
}
