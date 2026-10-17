import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'

interface Props {
  title: string
  subtitle: string
  imageUrl: string
  meta: Meta
  /** order[displayRow] = original row index */
  order: number[]
  height: number
  /** Display rows at which to draw a group separator line. */
  boundaries?: number[]
  controls?: ReactNode
  hovered: number | null
  onHover: (row: number | null) => void
}

const STRIP_WIDTH = 14
const MATRIX_WIDTH = 392 // 784 px columns at 0.5x

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

export function MatrixPanel({ title, subtitle, imageUrl, meta, order, height, boundaries = [], controls, hovered, onHover }: Props) {
  const n = order.length
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

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const displayRow = Math.min(n - 1, Math.max(0, Math.floor((y / height) * n)))
    onHover(order[displayRow])
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
        <div className="matrix" style={{ height }} onMouseMove={handleMove} onMouseLeave={() => onHover(null)}>
          <Strip colors={clusterColors} height={height} title="Leiden cluster (coloured by majority digit)" />
          <Strip colors={labelColors} height={height} title="True digit label" />
          <img src={imageUrl} alt={title} style={{ width: MATRIX_WIDTH, height }} draggable={false} />
          {boundaries.map((row) => (
            <div key={row} className="boundary" style={{ top: toY(row) }} />
          ))}
          {hovered !== null && <div className="cursor" style={{ top: toY(displayRowOf[hovered]) }} />}
        </div>
      </div>
    </section>
  )
}
