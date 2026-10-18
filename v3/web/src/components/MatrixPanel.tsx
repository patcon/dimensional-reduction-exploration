import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'
import { useSweepFrames, type Sweep } from '../sweep'
import { useMatrixImage } from '../pixelOrder'
import { usePixelTheme } from '../pixelTheme'

interface Props {
  title: string
  subtitle: string
  imageUrl: string
  meta: Meta
  /** order[displayRow] = original row index */
  order: number[]
  /** Digit side length: the image has resolution² columns, drawn `width` wide at every resolution. */
  resolution: number
  /** pixelOrder[column] = row-major pixel drawn at that column; null keeps row-major. */
  pixelOrder: number[] | null
  height: number
  /** Matrix image width in px; defaults to MATRIX_WIDTH. */
  width?: number
  /** Display rows at which to draw a group separator line. */
  boundaries?: number[]
  controls?: ReactNode
  /** Shown under the matrix, at the panel's width. */
  footer?: ReactNode
  hovered: number | null
  selected: number | null
  sweep: Sweep | null
  onHover: (row: number | null) => void
  /** Called with the clicked row, or null to unpin. */
  onSelect: (row: number | null) => void
}

const STRIP_WIDTH = 14
const SWEEP_TAIL_MS = 120 // trail behind the dot, in time (so it shrinks as the dot slows)
const MATRIX_WIDTH = 392 // the same width at every resolution
const DRAG_THRESHOLD_PX = 3 // vertical movement before a press counts as a drag rather than a click
const DRIFT_PX_PER_S = 60 // speed of the drifting hover, like a slow, steady mouse

function Strip({ colors, height, title }: { colors: string[]; height: number; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    colors.forEach((c, i) => {
      ctx.fillStyle = c
      ctx.fillRect(0, i, 1, 1)
    })
  }, [colors])
  return (
    <canvas
      ref={ref}
      className="strip"
      width={1}
      height={colors.length}
      style={{ width: STRIP_WIDTH, height }}
      title={title}
    />
  )
}

export function MatrixPanel({ title, subtitle, imageUrl, meta, order, resolution, pixelOrder, height, width = MATRIX_WIDTH, boundaries = [], controls, footer, hovered, selected, sweep, onHover, onSelect }: Props) {
  const n = order.length
  const nPixels = resolution * resolution
  const imageSrc = useMatrixImage(imageUrl, pixelOrder, usePixelTheme())
  const majorityByCluster = useMemo(
    () => new Map(meta.clusters.map((c) => [c.id, c.majorityLabel])),
    [meta],
  )
  const clusterColors = useMemo(
    () => order.map((r) => DIGIT_COLORS[majorityByCluster.get(meta.rows.cluster[r])!]),
    [order, meta, majorityByCluster],
  )
  const labelColors = useMemo(() => order.map((r) => DIGIT_COLORS[meta.rows.label[r]]), [order, meta])
  const displayRowOf = useMemo(() => {
    const inv = new Int32Array(n)
    order.forEach((r, i) => (inv[r] = i))
    return inv
  }, [order, n])

  const toY = (row: number) => (row / n) * height

  // Shrink the image to the room there is, rather than ever scrolling sideways.
  const imageRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(Infinity)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom(Math.floor(entry.contentRect.width)))
    observer.observe(imageRef.current!)
    return () => observer.disconnect()
  }, [])
  const drawWidth = Math.min(width, room)

  // The sweep dot travels along the focused row's line, one matrix column per pixel.
  const dotRef = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  useSweepFrames(sweep, SWEEP_TAIL_MS, nPixels, (frame) => {
    const dot = dotRef.current
    const tail = tailRef.current
    if (!dot || !tail) return
    // Hide as soon as focus moves on, without waiting for the sweep itself to be cleared.
    if (!frame || frame.row !== (selected ?? hovered)) {
      dot.style.opacity = tail.style.opacity = '0'
      return
    }
    const y = toY(displayRowOf[frame.row])
    const toX = (px: number) => (Math.min(Math.max(px, 0), nPixels) / nPixels) * drawWidth
    const head = toX(frame.pixel)
    const start = toX(frame.tailPixel)
    dot.style.opacity = frame.pixel <= nPixels ? '1' : '0'
    dot.style.transform = `translate(${head}px, ${y}px)`
    tail.style.opacity = '1'
    tail.style.transform = `translate(${start}px, ${y}px)`
    tail.style.width = `${head - start}px`
  })

  const rowAtPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    return order[Math.min(n - 1, Math.max(0, Math.floor((y / height) * n)))]
  }

  // Dragging vertically marks a band of display rows; letting go sets a hover drifting through it,
  // down and back up at a constant speed, until a click or Escape stops it.
  const [band, setBand] = useState<{ from: number; to: number } | null>(null)
  const [drifting, setDrifting] = useState(false)
  // A drag ends with a click on the matrix; that click shouldn't also stop the drift it just started.
  const dragged = useRef(false)

  const stopDrift = () => {
    setDrifting(false)
    setBand(null)
  }

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Don't select page text while dragging.
    e.preventDefault()
    const top = e.currentTarget.getBoundingClientRect().top
    const rowAtY = (clientY: number) => Math.min(n - 1, Math.max(0, Math.floor(((clientY - top) / height) * n)))
    const startY = e.clientY
    const from = rowAtY(startY)
    dragged.current = false
    const move = (ev: MouseEvent) => {
      if (!dragged.current && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return
      dragged.current = true
      setDrifting(false)
      setBand({ from, to: rowAtY(ev.clientY) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      if (!dragged.current) return
      // Unpin, so the preview follows the drifting hover as it would a real one.
      onSelect(null)
      setDrifting(true)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up, { once: true })
  }

  useEffect(() => {
    if (!drifting || !band) return
    const lo = Math.min(band.from, band.to)
    const span = Math.max(band.from, band.to) - lo
    const rowsPerMs = (DRIFT_PX_PER_S / 1000) * (n / height)
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      // A triangle wave: linear down to the bottom of the band, then linear back up.
      const d = span ? ((now - t0) * rowsPerMs) % (2 * span) : 0
      onHover(order[lo + Math.round(d <= span ? d : 2 * span - d)])
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      stopDrift()
      onHover(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
    }
  }, [drifting, band, n, height, order, onHover])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    if (drifting) {
      stopDrift()
      onHover(rowAtPointer(e))
      return
    }
    onSelect(rowAtPointer(e))
  }

  return (
    <section className="panel">
      <header>
        <div className="panel-title">
          <h2>{title}</h2>
          {controls}
        </div>
        <p>{subtitle}</p>
      </header>
      <div className="matrix-row">
        <div className="strip-labels" style={{ height }}>
          <span>cluster</span>
          <span>label</span>
        </div>
        <div
          className="matrix"
          style={{ height }}
          onMouseDown={startDrag}
          // While drifting, the drift owns the hover; the real pointer only takes it back with a click.
          onMouseMove={(e) => !drifting && !band && onHover(rowAtPointer(e))}
          onMouseLeave={() => !drifting && !band && onHover(null)}
          onClick={handleClick}
          title={drifting ? 'Click or press Escape to stop the drift' : 'Drag up or down to drift the hover through a band of rows'}
        >
          <Strip colors={clusterColors} height={height} title="Leiden cluster (coloured by majority digit)" />
          <Strip colors={labelColors} height={height} title="True digit label" />
          <div ref={imageRef} className="matrix-image" style={{ width }}>
            {/* Keep matrices shown at 1px per column or more crisp; let wide ones scale down smoothly.
                Remount on resize so the browser doesn't upscale a copy it scaled down for the old width. */}
            <img
              key={drawWidth}
              src={imageSrc}
              alt={title}
              className={nPixels <= drawWidth ? 'blocky' : ''}
              style={{ width: drawWidth, height }}
              draggable={false}
            />
            <div ref={tailRef} className="sweep-tail" />
            <div ref={dotRef} className="sweep-dot" />
          </div>
          {boundaries.map((row) => (
            <div key={row} className="boundary" style={{ top: toY(row) }} />
          ))}
          {band && (
            <div
              className={`drift-band${drifting ? ' drifting' : ''}`}
              style={{ top: toY(Math.min(band.from, band.to)), height: toY(Math.abs(band.to - band.from) + 1) }}
            />
          )}
          {selected !== null && <div className="cursor pinned" style={{ top: toY(displayRowOf[selected]) }} />}
          {hovered !== null && hovered !== selected && (
            <div className="cursor" style={{ top: toY(displayRowOf[hovered]) }} />
          )}
        </div>
      </div>
      {footer}
    </section>
  )
}
