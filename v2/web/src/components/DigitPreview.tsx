import { useEffect, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { DIGIT_COLORS } from '../palette'
import { N_PIXELS, useSweepFrames, type Sweep } from '../sweep'

const PREVIEW_SIZE = 112
const CELL = PREVIEW_SIZE / 28
const SWEEP_TAIL_MS = 30 // trail behind the head, in time (so it shrinks as the head slows)

export function DigitPreview({
  data,
  row,
  pixelOrder,
  pinned,
  sweep,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  pixelOrder: number[] | null
  pinned: boolean
  sweep: Sweep | null
  onUnpin: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1

  // Walk a red pixel through the digit cell by cell: the same order its row is laid out in the matrix.
  useSweepFrames(sweep, SWEEP_TAIL_MS, (frame) => {
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
    for (let i = Math.max(tail, 0); i <= Math.min(head, N_PIXELS - 1); i++) {
      ctx.globalAlpha = ((i - tail + 1) / length) ** 1.5
      ctx.fillRect((i % 28) * CELL, Math.floor(i / 28) * CELL, CELL, CELL)
    }
    ctx.globalAlpha = 1
  })
  const { meta, pixels } = data

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(28, 28)
    if (row !== null) {
      const offset = row * meta.nPixels
      // Fold the row back into 28×28 in its current column order, so a shuffle scrambles the digit too.
      for (let i = 0; i < 784; i++) {
        const v = pixels[offset + (pixelOrder ? pixelOrder[i] : i)]
        img.data.set([v, v, v, 255], i * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [row, meta, pixels, pixelOrder])

  const cluster = row === null ? null : meta.clusters.find((c) => c.id === meta.rows.cluster[row])!
  const label = row === null ? null : meta.rows.label[row]

  return (
    <div className="digit-preview">
      <div className="digit-canvas">
        <canvas ref={ref} width={28} height={28} />
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
