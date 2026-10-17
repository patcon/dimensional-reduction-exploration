import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'

const SIZE = 320
const PAD = 10
const DRAG_SPEED = 0.01
const MIN_ZOOM = 0.5
const MAX_ZOOM = 40
const GLIDE_MS = 450

const NAMES: Record<string, string> = { umap2d: 'UMAP 2D', umap3d: 'UMAP 3D' }

interface Rotation {
  yaw: number
  pitch: number
}

/** Zoom/pan applied after projection: screen = centre + (p - centre) * zoom + pan. */
interface View {
  zoom: number
  panX: number
  panY: number
}

export interface GroupPath {
  rows: number[]
  color: string
}

const INITIAL_ROTATION: Rotation = { yaw: 0.5, pitch: 0.3 }
const INITIAL_VIEW: View = { zoom: 1, panX: 0, panY: 0 }
const ORIGIN: Vec3 = [0, 0, 0]

type Vec3 = [number, number, number]

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Centre each axis and scale so every point lies within the unit sphere (or disc). */
function normalize(coords: number[][]): Vec3[] {
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

/**
 * Rotate around `pivot`, first about the vertical axis (yaw) then the horizontal axis (pitch).
 * The pivot lands at the canvas centre (before pan); returns screen x/y and depth.
 */
function project(p: Vec3, pivot: Vec3, { yaw, pitch }: Rotation, { zoom, panX, panY }: View) {
  const [x, y, z] = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch)
  const s = (SIZE / 2 - PAD) * zoom
  return { sx: SIZE / 2 + x1 * s + panX, sy: SIZE / 2 - y2 * s + panY, depth: z2 }
}

export function ProjectionPlot({
  meta,
  paths,
  pathsLabel,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  meta: Meta
  /** One path per group of the active sorting, in sort order. */
  paths: GroupPath[]
  pathsLabel: string
  hovered: number | null
  selected: number | null
  onHover: (r: number | null) => void
  /** Called on click (not drag) with the nearest point, or null for empty space. */
  onSelect: (r: number | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  const names = Object.keys(meta.projections)
  const [name, setName] = useState(names[0])
  const [rotation, setRotation] = useState<Rotation>(INITIAL_ROTATION)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [showPaths, setShowPaths] = useState(false)
  // Rotation centre: the pinned sample in 3D, otherwise the middle of the cloud.
  const [pivot, setPivot] = useState<Vec3>(ORIGIN)
  const pivotRef = useRef(pivot)
  const viewRef = useRef(view)
  // Latest values for the glide animation to start from (declared before it, so synced first).
  useEffect(() => {
    pivotRef.current = pivot
    viewRef.current = view
  })
  const drag = useRef<{
    x: number
    y: number
    mode: 'rotate' | 'pan'
    rotation: Rotation
    view: View
    moved: boolean
  } | null>(null)

  const is3d = (meta.projections[name][0]?.length ?? 2) === 3
  const points = useMemo(() => normalize(meta.projections[name]), [meta, name])
  const screen = useMemo(
    () => points.map((p) => (is3d ? project(p, pivot, rotation, view) : project(p, ORIGIN, { yaw: 0, pitch: 0 }, view))),
    [points, pivot, rotation, view, is3d],
  )

  // Glide the pivot to the pinned sample (centring it) or back to the origin on unpin.
  const pinnedPoint = is3d && selected !== null ? points[selected] : null
  useEffect(() => {
    const from = pivotRef.current
    const to = pinnedPoint ?? ORIGIN
    const fromPan = viewRef.current
    const recentre = pinnedPoint !== null
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - t0) / GLIDE_MS))
      setPivot(from.map((v, d) => v + (to[d] - v) * t) as Vec3)
      if (recentre) setView((v) => ({ ...v, panX: fromPan.panX * (1 - t), panY: fromPan.panY * (1 - t) }))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [pinnedPoint])
  const majority = useMemo(() => new Map(meta.clusters.map((c) => [c.id, c.majorityLabel])), [meta])
  // A pinned point keeps its group's path highlighted; otherwise follow the hover.
  const focus = selected ?? hovered
  const focusPath = useMemo(
    () => (focus === null ? -1 : paths.findIndex((p) => p.rows.includes(focus))),
    [paths, focus],
  )

  const resetView = () => {
    setRotation(INITIAL_ROTATION)
    setView(INITIAL_VIEW)
  }

  const selectProjection = (n: string) => {
    setName(n)
    resetView()
  }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    // Painter's algorithm: draw far points first; nearer points are larger and more opaque.
    const drawOrder = screen.map((_, i) => i).sort((a, b) => screen[a].depth - screen[b].depth)
    const pointScale = Math.min(2, Math.sqrt(view.zoom))
    for (const i of drawOrder) {
      const { sx, sy, depth } = screen[i]
      const t = is3d ? (depth + 1) / 2 : 0.5
      const r = (1 + t * 1.2) * pointScale
      ctx.globalAlpha = (0.35 + t * 0.5) * (showPaths ? 0.6 : 1)
      ctx.fillStyle = DIGIT_COLORS[majority.get(meta.rows.cluster[i])!]
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    }

    if (showPaths) {
      ctx.lineJoin = 'round'
      paths.forEach((path, i) => {
        const focused = focusPath === -1 || focusPath === i
        ctx.globalAlpha = focused ? (focusPath === -1 ? 0.55 : 0.9) : 0.08
        ctx.lineWidth = focusPath === i ? 1.25 : 0.75
        ctx.strokeStyle = path.color
        ctx.beginPath()
        path.rows.forEach((row, j) => {
          const { sx, sy } = screen[row]
          if (j === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        })
        ctx.stroke()
      })
    }

    ctx.globalAlpha = 1
    const fg = getComputedStyle(canvas).color
    const ring = (row: number, radius: number, width: number) => {
      const { sx, sy } = screen[row]
      ctx.strokeStyle = fg
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.arc(sx, sy, radius, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (selected !== null) {
      ring(selected, 7, 3)
      ring(selected, 2, 2)
    }
    if (hovered !== null && hovered !== selected) ring(hovered, 6, 1.5)
  }, [screen, hovered, selected, majority, meta, dpr, is3d, view.zoom, showPaths, paths, focusPath])

  // React's onWheel is passive, so attach natively to be able to preventDefault page scroll.
  useEffect(() => {
    const canvas = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left - SIZE / 2
      const my = e.clientY - rect.top - SIZE / 2
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.002)))
        // Keep the point under the cursor fixed while zooming.
        const k = zoom / v.zoom
        return { zoom, panX: mx - (mx - v.panX) * k, panY: my - (my - v.panY) * k }
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

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
      const { x, y, mode, rotation: r0, view: v0 } = drag.current
      const dx = e.clientX - x
      const dy = e.clientY - y
      // Small jitters during a click shouldn't move the view.
      if (!drag.current.moved && Math.hypot(dx, dy) < 3) return
      if (!drag.current.moved) onHover(null)
      drag.current.moved = true
      if (mode === 'pan') {
        setView({ ...v0, panX: v0.panX + dx, panY: v0.panY + dy })
      } else {
        const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, r0.pitch + dy * DRAG_SPEED))
        setRotation({ yaw: r0.yaw + dx * DRAG_SPEED, pitch })
      }
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    onHover(nearest(e.clientX - rect.left, e.clientY - rect.top))
  }

  const handleDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pan = !is3d || e.shiftKey || e.button === 2
    drag.current = { x: e.clientX, y: e.clientY, mode: pan ? 'pan' : 'rotate', rotation, view, moved: false }
  }

  const handleUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasClick = drag.current && !drag.current.moved && e.button === 0
    drag.current = null
    if (wasClick) {
      const rect = e.currentTarget.getBoundingClientRect()
      onSelect(nearest(e.clientX - rect.left, e.clientY - rect.top))
    }
  }

  const endDrag = () => (drag.current = null)

  const transformed = view !== INITIAL_VIEW || rotation !== INITIAL_ROTATION

  return (
    <div className="projection">
      <div className="projection-head">
        <div className="segmented" role="tablist" aria-label="Projection">
          {names.map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={n === name}
              className={n === name ? 'on' : ''}
              onClick={() => selectProjection(n)}
            >
              {NAMES[n] ?? n}
            </button>
          ))}
        </div>
        <label className="checkbox" title={`Connect points within each group in the sorted matrix's order (${pathsLabel})`}>
          <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} />
          Sort paths
        </label>
      </div>
      <canvas
        ref={ref}
        className={`plot ${is3d ? 'rotatable' : 'pannable'}`}
        width={SIZE * dpr}
        height={SIZE * dpr}
        style={{ width: SIZE, height: SIZE }}
        onMouseMove={handleMove}
        onMouseDown={handleDown}
        onMouseUp={handleUp}
        onContextMenu={(e) => e.preventDefault()}
        onMouseLeave={() => {
          endDrag()
          onHover(null)
        }}
      />
      <p className="section-note">
        {showPaths && <>Paths follow {pathsLabel}. </>}
        Scroll to zoom; {is3d ? `drag to ${pinnedPoint ? 'orbit the pinned sample' : 'rotate'}, shift-drag to pan.` : 'drag to pan.'}{' '}
        {transformed && (
          <button className="link" onClick={resetView}>
            Reset view
          </button>
        )}
      </p>
    </div>
  )
}
