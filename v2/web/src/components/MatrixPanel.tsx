import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'
import { useSweepFrames, type Sweep } from '../sweep'

interface Props {
  title: string
  subtitle: string
  imageUrl: string
  meta: Meta
  /** order[displayRow] = original row index */
  order: number[]
  /** Digit side length: the image has resolution² columns, always drawn MATRIX_WIDTH wide. */
  resolution: number
  height: number
  /** Display rows at which to draw a group separator line. */
  boundaries?: number[]
  controls?: ReactNode
  hovered: number | null
  selected: number | null
  sweep: Sweep | null
  onHover: (row: number | null) => void
  onSelect: (row: number) => void
}

const STRIP_WIDTH = 14
const SWEEP_TAIL_MS = 120 // trail behind the dot, in time (so it shrinks as the dot slows)
const MATRIX_WIDTH = 392 // the same width at every resolution

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

export function MatrixPanel({ title, subtitle, imageUrl, meta, order, resolution, height, boundaries = [], controls, hovered, selected, sweep, onHover, onSelect }: Props) {
  const n = order.length
  const nPixels = resolution * resolution
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
    const toX = (px: number) => (Math.min(Math.max(px, 0), nPixels) / nPixels) * MATRIX_WIDTH
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
          onMouseMove={(e) => onHover(rowAtPointer(e))}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => onSelect(rowAtPointer(e))}
        >
          <Strip colors={clusterColors} height={height} title="Leiden cluster (coloured by majority digit)" />
          <Strip colors={labelColors} height={height} title="True digit label" />
          <div className="matrix-image">
            {/* Stretch narrow (low-resolution) matrices into crisp blocks; let wide ones scale down smoothly. */}
            <img
              src={imageUrl}
              alt={title}
              className={nPixels < MATRIX_WIDTH ? 'blocky' : ''}
              style={{ width: MATRIX_WIDTH, height }}
              draggable={false}
            />
            <div ref={tailRef} className="sweep-tail" />
            <div ref={dotRef} className="sweep-dot" />
          </div>
          {boundaries.map((row) => (
            <div key={row} className="boundary" style={{ top: toY(row) }} />
          ))}
          {selected !== null && <div className="cursor pinned" style={{ top: toY(displayRowOf[selected]) }} />}
          {hovered !== null && hovered !== selected && (
            <div className="cursor" style={{ top: toY(displayRowOf[hovered]) }} />
          )}
        </div>
      </div>
    </section>
  )
}
