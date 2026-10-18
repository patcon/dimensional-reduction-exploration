import { useEffect, useMemo, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { pixelOrderFor, type PixelShuffle } from '../pixelOrder'
import { DigitDetails } from './DigitPreview'

const TILE = 84 // side of each layer before the isometric squash
const GAP = 20 // vertical distance between stacked layers
const PAD = 6
const LABEL_WIDTH = 44
const COS30 = Math.cos(Math.PI / 6)
const DIAMOND_WIDTH = 2 * TILE * COS30
const WIDTH = Math.ceil(DIAMOND_WIDTH + LABEL_WIDTH + PAD * 2)
const DIMMED = 0.18

/** One layer's digit as fg-coloured ink with alpha = intensity, so stacked layers stay see-through. */
function inkTile(pixels: Uint8Array, row: number, side: number, pixelOrder: number[] | null, rgb: number[]) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(side, side)
  const offset = row * side * side
  for (let i = 0; i < side * side; i++) {
    img.data.set([...rgb, pixels[offset + (pixelOrder ? pixelOrder[i] : i)]], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * The focused digit at every resolution, as an isometric stack: full resolution at the bottom,
 * coarsest at the top. The current resolution stands out and the rest dim; click a layer to pick it.
 */
export function DigitStack({
  data,
  row,
  resolution,
  shuffle,
  pinned,
  onResolution,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  resolution: number
  shuffle: PixelShuffle
  pinned: boolean
  onResolution: (resolution: number) => void
  onUnpin: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  const { meta, pixels } = data
  // Top to bottom: coarsest first.
  const layers = useMemo(() => [...meta.resolutions].reverse(), [meta])
  const height = Math.ceil(TILE + (layers.length - 1) * GAP + PAD * 2)
  const layerTop = (i: number) => PAD + i * GAP

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const fg = getComputedStyle(canvas).color
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim()
    const rgb = fg.match(/\d+/g)!.slice(0, 3).map(Number)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Painter's order: bottom layer first, so higher layers sit over it.
    for (let i = layers.length - 1; i >= 0; i--) {
      const side = layers[i]
      const y0 = layerTop(i)
      const on = side === resolution
      // Map the square tile onto a diamond whose top vertex is at (PAD + DIAMOND_WIDTH / 2, y0).
      ctx.setTransform(COS30 * dpr, 0.5 * dpr, -COS30 * dpr, 0.5 * dpr, (PAD + DIAMOND_WIDTH / 2) * dpr, y0 * dpr)
      // A faint accent wash under the selected layer.
      if (on) {
        ctx.globalAlpha = 0.12
        ctx.fillStyle = accent
        ctx.fillRect(0, 0, TILE, TILE)
      }
      ctx.globalAlpha = on ? 1 : DIMMED
      if (row !== null) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(inkTile(pixels[side], row, side, pixelOrderFor(shuffle, side), rgb), 0, 0, TILE, TILE)
      }
      ctx.strokeStyle = on ? accent : fg
      ctx.lineWidth = (on ? 1.5 : 1) / dpr
      ctx.globalAlpha = on ? 1 : DIMMED * 1.5
      ctx.strokeRect(0, 0, TILE, TILE)

      // Resolution label beside the layer's right vertex.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = on ? 1 : 0.5
      ctx.fillStyle = on ? accent : fg
      ctx.font = `${on ? 600 : 400} 11px ui-sans-serif, system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillText(`${side}×${side}`, PAD + DIAMOND_WIDTH + 6, y0 + TILE / 2)
    }
    ctx.globalAlpha = 1
  }, [row, pixels, resolution, shuffle, layers, dpr])

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
      <canvas
        ref={ref}
        className="digit-stack"
        width={WIDTH * dpr}
        height={height * dpr}
        style={{ width: WIDTH, height }}
        onClick={handleClick}
        title="Click a layer to switch resolution"
      />
      <DigitDetails data={data} row={row} pinned={pinned} onUnpin={onUnpin} />
    </div>
  )
}
