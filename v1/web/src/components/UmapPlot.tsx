import { useEffect, useMemo, useRef } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'

const SIZE = 320
const PAD = 8

export function UmapPlot({ meta, hovered, onHover }: { meta: Meta; hovered: number | null; onHover: (r: number | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1

  const points = useMemo(() => {
    const xs = meta.rows.umap.map((p) => p[0])
    const ys = meta.rows.umap.map((p) => p[1])
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
    const s = (SIZE - 2 * PAD) / Math.max(x1 - x0, y1 - y0)
    return meta.rows.umap.map(([x, y]) => [PAD + (x - x0) * s, SIZE - PAD - (y - y0) * s] as const)
  }, [meta])

  const majority = useMemo(() => new Map(meta.clusters.map((c) => [c.id, c.majorityLabel])), [meta])

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    points.forEach(([x, y], i) => {
      ctx.fillStyle = DIGIT_COLORS[majority.get(meta.rows.cluster[i])!]
      ctx.globalAlpha = 0.7
      ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5)
    })
    ctx.globalAlpha = 1
    if (hovered !== null) {
      const [x, y] = points[hovered]
      ctx.lineWidth = 2
      ctx.strokeStyle = getComputedStyle(ref.current!).color
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [points, hovered, majority, meta, dpr])

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let best = -1
    let bestD = 100 // only snap within 10px
    points.forEach(([x, y], i) => {
      const d = (x - mx) ** 2 + (y - my) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    onHover(best === -1 ? null : best)
  }

  return (
    <canvas
      ref={ref}
      className="umap"
      width={SIZE * dpr}
      height={SIZE * dpr}
      style={{ width: SIZE, height: SIZE }}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    />
  )
}
