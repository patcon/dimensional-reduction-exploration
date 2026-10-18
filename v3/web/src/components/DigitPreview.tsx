import { useEffect, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { DIGIT_COLORS } from '../palette'
import { usePixelTheme } from '../pixelTheme'
import { useSweepFrames, type Sweep } from '../sweep'
import { PREVIEW_SIZE } from './digitLayout'

// Mid-grey so the lines show over both black background and white ink.
const GRID_COLOR = 'rgba(128, 128, 128, 0.3)'
const SWEEP_TAIL_MS = 30 // trail behind the head, in time (so it shrinks as the head slows)

export function DigitPreview({
  data,
  row,
  resolution,
  pixelOrder,
  pinned,
  sweep,
  onUnpin,
  footprint,
}: {
  data: MnistData
  row: number | null
  resolution: number
  pixelOrder: number[] | null
  pinned: boolean
  sweep: Sweep | null
  onUnpin: () => void
  /** Reserve this much room for the digit (e.g. the stack's), laid out like the stack, so swapping views doesn't shift anything. */
  footprint?: { width: number; height: number }
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  // The preview stays the same size at every resolution; cells just get bigger.
  const nPixels = resolution * resolution
  // Fill the reserved footprint's height (inside the 1px border), or the usual size on its own.
  const size = footprint ? footprint.height - 2 : PREVIEW_SIZE
  const cell = size / resolution

  // Walk a red pixel through the digit cell by cell: the same order its row is laid out in the matrix.
  useSweepFrames(sweep, SWEEP_TAIL_MS, nPixels, (frame) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
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
  const { pixels } = data
  const theme = usePixelTheme()

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(resolution, resolution)
    if (row !== null) {
      const offset = row * nPixels
      // Fold the row back into a square in its current column order, so a shuffle scrambles the digit too.
      for (let i = 0; i < nPixels; i++) {
        img.data.set([...theme.shade(pixels[resolution][offset + (pixelOrder ? pixelOrder[i] : i)]), 255], i * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [row, pixels, resolution, nPixels, pixelOrder, theme])

  // Faint 1px lines between cells, snapped to device pixels so they stay crisp at fractional cell sizes.
  useEffect(() => {
    const ctx = gridRef.current!.getContext('2d')!
    const deviceSize = size * dpr
    const line = Math.max(1, Math.round(dpr))
    ctx.clearRect(0, 0, deviceSize, deviceSize)
    ctx.fillStyle = GRID_COLOR
    for (let i = 1; i < resolution; i++) {
      const at = Math.round(i * cell * dpr) - Math.floor(line / 2)
      ctx.fillRect(at, 0, line, deviceSize)
      ctx.fillRect(0, at, deviceSize, line)
    }
  }, [resolution, cell, size, dpr])

  return (
    <div className={`digit-preview${footprint ? ' stacked' : ''}`}>
      <div className="digit-footprint" style={footprint}>
        <div className="digit-canvas" style={{ width: size + 2, height: size + 2 }}>
          <canvas ref={ref} width={resolution} height={resolution} style={{ width: size, height: size }} />
          <canvas
            ref={gridRef}
            className="grid-overlay"
            width={size * dpr}
            height={size * dpr}
            style={{ width: size, height: size }}
            aria-hidden
          />
          <canvas
            ref={overlayRef}
            className="sweep-overlay"
            width={size * dpr}
            height={size * dpr}
            style={{ width: size, height: size }}
            aria-hidden
          />
        </div>
      </div>
      <DigitDetails data={data} row={row} pinned={pinned} onUnpin={onUnpin} />
    </div>
  )
}

/** Label, cluster and pin state of the focused digit, or a hint when nothing is focused. */
export function DigitDetails({
  data,
  row,
  pinned,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  pinned: boolean
  onUnpin: () => void
}) {
  const { meta } = data
  const cluster = row === null ? null : meta.clusters.find((c) => c.id === meta.rows.cluster[row])!
  const label = row === null ? null : meta.rows.label[row]
  return row === null ? (
    <p className="muted">Hover a row in either matrix, a sample, or a point in the projection. Click to pin it.</p>
  ) : (
    <dl>
      <dt>Label</dt>
      <dd>
        <span className="swatch" style={{ background: DIGIT_COLORS[label!] }} /> {label}
      </dd>
      <dt>Leiden</dt>
      <dd>
        <span className="swatch" style={{ background: DIGIT_COLORS[cluster!.majorityLabel] }} /> #{cluster!.id}
      </dd>
      <dt>MNIST index</dt>
      <dd>{meta.rows.sourceIndex[row]}</dd>
      {/* A × beside "Pinned" rather than an Unpin link, so it fits on one line beside the stack. */}
      <dt>
        {pinned && (
          <>
            Pinned{' '}
            <button className="unpin" onClick={onUnpin} title="Unpin (Esc)" aria-label="Unpin (Esc)">
              ×
            </button>
          </>
        )}
      </dt>
      <dd>{!pinned && <span className="muted">Click to pin</span>}</dd>
    </dl>
  )
}
