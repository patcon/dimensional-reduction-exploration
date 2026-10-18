import { useEffect, useMemo, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { pixelOrderFor, type PixelShuffle } from '../pixelOrder'
import { useSweepFrames, type Sweep } from '../sweep'
import { DigitDetails, PREVIEW_SIZE } from './DigitPreview'

const TILE = 84 // side of each layer before the isometric squash
const GAP = 20 // vertical distance between stacked layers
const PAD = 6
const LABEL_WIDTH = 64 // resolution label plus its expand button
const COS30 = Math.cos(Math.PI / 6)
const DIAMOND_WIDTH = 2 * TILE * COS30
const WIDTH = Math.ceil(DIAMOND_WIDTH + LABEL_WIDTH + PAD * 2)
const DIMMED = 0.3
// Where DigitPreview draws its digit (inside a 1px border), so a fully flattened layer lines up with it.
const FLAT_OFFSET = 1
const FLAT_SCALE = PREVIEW_SIZE / TILE
const SWEEP_TAIL_MS = 30 // as in DigitPreview

/** One layer's digit, white on black like DigitPreview. */
function digitTile(pixels: Uint8Array, row: number | null, side: number, pixelOrder: number[] | null) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(side, side)
  const offset = (row ?? 0) * side * side
  for (let i = 0; i < side * side; i++) {
    const v = row === null ? 0 : pixels[offset + (pixelOrder ? pixelOrder[i] : i)]
    img.data.set([v, v, v, 255], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const layerTop = (i: number) => PAD + i * GAP

/**
 * Isometric: the tile's top-left corner at the diamond's top vertex for layer `i`. With `t` > 0 it
 * blends towards an unskewed square where DigitPreview draws its digit.
 */
function setLayerTransform(ctx: CanvasRenderingContext2D, i: number, t: number, dpr: number) {
  ctx.setTransform(
    lerp(COS30, FLAT_SCALE, t) * dpr,
    lerp(0.5, 0, t) * dpr,
    lerp(-COS30, 0, t) * dpr,
    lerp(0.5, FLAT_SCALE, t) * dpr,
    lerp(PAD + DIAMOND_WIDTH / 2, FLAT_OFFSET, t) * dpr,
    lerp(layerTop(i), FLAT_OFFSET, t) * dpr,
  )
}

/**
 * The focused digit at every resolution, as an isometric stack: full resolution at the bottom,
 * coarsest at the top. The current resolution stands out and the rest dim; click a layer to pick it.
 * `flatten` (0 to 1) un-skews the current layer into DigitPreview's square and fades the rest away.
 */
export function DigitStack({
  data,
  row,
  resolution,
  shuffle,
  pinned,
  sweep,
  flatten = 0,
  onResolution,
  onExpand,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  resolution: number
  shuffle: PixelShuffle
  pinned: boolean
  sweep: Sweep | null
  flatten?: number
  onResolution: (resolution: number) => void
  /** Open the flat single-resolution preview at this resolution. */
  onExpand: (resolution: number) => void
  onUnpin: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const sweepRef = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  const { meta, pixels } = data
  // Top to bottom: coarsest first.
  const layers = useMemo(() => [...meta.resolutions].reverse(), [meta])
  const height = Math.ceil(TILE + (layers.length - 1) * GAP + PAD * 2)
  const tiles = useMemo(
    () => new Map(layers.map((side) => [side, digitTile(pixels[side], row, side, pixelOrderFor(shuffle, side))])),
    [layers, pixels, row, shuffle],
  )

  // Walk the red pixel through the current layer, as DigitPreview does on its flat digit.
  const nPixels = resolution * resolution
  useSweepFrames(sweep, SWEEP_TAIL_MS, nPixels, (frame) => {
    const canvas = sweepRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!frame || frame.row !== row) return
    setLayerTransform(ctx, layers.indexOf(resolution), flatten, dpr)
    ctx.fillStyle = getComputedStyle(canvas).color
    const cell = TILE / resolution
    const head = Math.floor(frame.pixel)
    const tail = Math.floor(frame.tailPixel)
    const length = head - tail + 1
    for (let i = Math.max(tail, 0); i <= Math.min(head, nPixels - 1); i++) {
      ctx.globalAlpha = ((i - tail + 1) / length) ** 1.5
      ctx.fillRect((i % resolution) * cell, Math.floor(i / resolution) * cell, cell, cell)
    }
    ctx.globalAlpha = 1
  })

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    const drawLayer = (i: number) => {
      const side = layers[i]
      const on = side === resolution
      if (!on && flatten >= 1) return
      const t = on ? flatten : 0
      setLayerTransform(ctx, i, t, dpr)
      ctx.globalAlpha = on ? 1 : DIMMED * (1 - flatten)
      ctx.drawImage(tiles.get(side)!, 0, 0, TILE, TILE)
      if (on) {
        ctx.globalAlpha = 1 - flatten
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.5 / lerp(1, FLAT_SCALE, t)
        ctx.strokeRect(0, 0, TILE, TILE)
      }
    }
    // Painter's order from the bottom up, then the current layer again on top so the
    // translucent layers above it never dim it.
    layers.forEach((_, i) => layers[layers.length - 1 - i] !== resolution && drawLayer(layers.length - 1 - i))
    drawLayer(layers.indexOf(resolution))
    ctx.globalAlpha = 1
  }, [tiles, resolution, layers, dpr, flatten])

  // Pick the layer whose centre line is nearest the click: layers overlap, so this beats hit-testing diamonds.
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const nearest = layers
      .map((side, i) => ({ side, d: Math.abs(layerTop(i) + TILE / 2 - y) }))
      .reduce((a, b) => (b.d < a.d ? b : a))
    onResolution(nearest.side)
  }

  return (
    <div className="digit-preview stacked">
      <div className="digit-stack-wrap" style={{ width: WIDTH, height }}>
        <canvas
          ref={ref}
          className="digit-stack"
          width={WIDTH * dpr}
          height={height * dpr}
          style={{ width: WIDTH, height }}
          onClick={flatten ? undefined : handleClick}
          title="Click a layer to switch resolution"
        />
        <canvas
          ref={sweepRef}
          className="digit-stack sweep"
          width={WIDTH * dpr}
          height={height * dpr}
          style={{ width: WIDTH, height }}
          aria-hidden
        />
        {/* Labels beside each layer's right vertex, with a button to open that layer on its own. */}
        {layers.map((side, i) => (
          <div
            key={side}
            className={`stack-label${side === resolution ? ' on' : ''}`}
            style={{
              top: layerTop(i) + TILE / 2,
              left: PAD + DIAMOND_WIDTH + 4,
              opacity: 1 - flatten,
              pointerEvents: flatten ? 'none' : undefined,
            }}
          >
            <button className="stack-label-name" onClick={() => onResolution(side)}>
              {side}×{side}
            </button>
            <button className="icon-button" onClick={() => onExpand(side)} title={`Expand ${side}×${side}`} aria-label={`Expand ${side}×${side}`}>
              <ExpandIcon />
            </button>
          </div>
        ))}
      </div>
      <DigitDetails data={data} row={row} pinned={pinned} onUnpin={onUnpin} />
    </div>
  )
}

/** Two arrows pointing out to opposite corners. */
function ExpandIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 1h4v4M11 1 7 5M5 11H1V7M1 11l4-4" />
    </svg>
  )
}
