import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'

const SIZE = 320
const PAD = 10
const DRAG_SPEED = 0.01

const NAMES: Record<string, string> = { umap2d: 'UMAP 2D', umap3d: 'UMAP 3D' }

interface Rotation {
  yaw: number
  pitch: number
}

/** Centre each axis and scale so every point lies within the unit sphere (or disc). */
function normalize(coords: number[][]): [number, number, number][] {
  const dims = coords[0]?.length ?? 2
  const centre = Array.from({ length: dims }, (_, d) => {
    const vals = coords.map((p) => p[d])
    return (Math.min(...vals) + Math.max(...vals)) / 2
  })
  const radius = Math.max(...coords.map((p) => Math.hypot(...p.map((v, d) => v - centre[d]))))
  return coords.map((p) => {
    const [x, y, z = 0] = p.map((v, d) => (v - centre[d]) / radius)
    return [x, y, z]
  })
}

/** Rotate around the vertical axis (yaw) then the horizontal axis (pitch); returns screen x/y and depth. */
function project([x, y, z]: [number, number, number], { yaw, pitch }: Rotation) {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch)
  const s = SIZE / 2 - PAD
  return { sx: SIZE / 2 + x1 * s, sy: SIZE / 2 - y2 * s, depth: z2 }
}

export function ProjectionPlot({
  meta,
  hovered,
  onHover,
}: {
  meta: Meta
  hovered: number | null
  onHover: (r: number | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  const names = Object.keys(meta.projections)
  const [name, setName] = useState(names[0])
  const [rotation, setRotation] = useState<Rotation>({ yaw: 0.5, pitch: 0.3 })
  const drag = useRef<{ x: number; y: number; start: Rotation } | null>(null)

  const is3d = (meta.projections[name][0]?.length ?? 2) === 3
  const points = useMemo(() => normalize(meta.projections[name]), [meta, name])
  const screen = useMemo(
    () => points.map((p) => project(p, is3d ? rotation : { yaw: 0, pitch: 0 })),
    [points, rotation, is3d],
  )
  const majority = useMemo(() => new Map(meta.clusters.map((c) => [c.id, c.majorityLabel])), [meta])

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    // Painter's algorithm: draw far points first; nearer points are larger and more opaque.
    const drawOrder = screen.map((_, i) => i).sort((a, b) => screen[a].depth - screen[b].depth)
    for (const i of drawOrder) {
      const { sx, sy, depth } = screen[i]
      const t = is3d ? (depth + 1) / 2 : 0.5
      const r = 1 + t * 1.2
      ctx.globalAlpha = 0.35 + t * 0.5
      ctx.fillStyle = DIGIT_COLORS[majority.get(meta.rows.cluster[i])!]
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 1
    if (hovered !== null) {
      const { sx, sy } = screen[hovered]
      ctx.strokeStyle = getComputedStyle(canvas).color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [screen, hovered, majority, meta, dpr, is3d])

  const nearest = (mx: number, my: number) => {
    let best = -1
    let bestD = 100 // only snap within 10px
    let bestDepth = -Infinity
    screen.forEach(({ sx, sy, depth }, i) => {
      const d = (sx - mx) ** 2 + (sy - my) ** 2
      // Among overlapping candidates, prefer the one drawn on top.
      if (d < bestD || (d < 9 && depth > bestDepth)) {
        bestD = d
        bestDepth = depth
        best = i
      }
    })
    return best === -1 ? null : best
  }

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drag.current) {
      const { x, y, start } = drag.current
      const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, start.pitch + (e.clientY - y) * DRAG_SPEED))
      setRotation({ yaw: start.yaw + (e.clientX - x) * DRAG_SPEED, pitch })
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    onHover(nearest(e.clientX - rect.left, e.clientY - rect.top))
  }

  const handleDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!is3d) return
    drag.current = { x: e.clientX, y: e.clientY, start: rotation }
    onHover(null)
  }

  const endDrag = () => (drag.current = null)

  return (
    <div className="projection">
      <div className="projection-head">
        <div className="segmented" role="tablist" aria-label="Projection">
          {names.map((n) => (
            <button key={n} role="tab" aria-selected={n === name} className={n === name ? 'on' : ''} onClick={() => setName(n)}>
              {NAMES[n] ?? n}
            </button>
          ))}
        </div>
        {is3d && (
          <button className="link" onClick={() => setRotation({ yaw: 0.5, pitch: 0.3 })}>
            reset view
          </button>
        )}
      </div>
      <canvas
        ref={ref}
        className={`plot${is3d ? ' rotatable' : ''}`}
        width={SIZE * dpr}
        height={SIZE * dpr}
        style={{ width: SIZE, height: SIZE }}
        onMouseMove={handleMove}
        onMouseDown={handleDown}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag()
          onHover(null)
        }}
      />
      {is3d && <p className="section-note">Drag to rotate.</p>}
    </div>
  )
}
