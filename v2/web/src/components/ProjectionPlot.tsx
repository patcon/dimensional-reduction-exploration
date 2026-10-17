import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'
import { loadEvolution } from '../useMnistData'

const SIZE = 320
const PAD = 10
const DRAG_SPEED = 0.01
const MIN_ZOOM = 0.5
const MAX_ZOOM = 40
const GLIDE_MS = 450
const MORPH_MS = 900
/** Time spent moving between consecutive optimisation snapshots. */
const EVOLUTION_STEP_MS = 450

const METHOD_NAMES: Record<string, string> = { umap: 'UMAP', pacmap: 'PaCMAP', localmap: 'LocalMAP' }

/** Split projection keys like "pacmap3d_r8" into a method, dimensionality and digit resolution. */
function parseKey(key: string) {
  const m = key.match(/^(.*?)([23])d_r(\d+)$/)
  return m ? { method: m[1], dims: Number(m[2]), resolution: Number(m[3]) } : { method: key, dims: 2, resolution: 0 }
}

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

/** Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations; returns eigenvalues and column eigenvectors. */
function symmetricEigen(a: number[][]) {
  const n = a.length
  const m = a.map((row) => [...row])
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const [mkp, mkq] = [m[k][p], m[k][q]]
          m[k][p] = c * mkp - s * mkq
          m[k][q] = s * mkp + c * mkq
        }
        for (let k = 0; k < n; k++) {
          const [mpk, mqk] = [m[p][k], m[q][k]]
          m[p][k] = c * mpk - s * mqk
          m[q][k] = s * mpk + c * mqk
        }
        for (let k = 0; k < n; k++) {
          const [vkp, vkq] = [v[k][p], v[k][q]]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  return { values: m.map((row, i) => row[i]), vectors: v }
}

/**
 * The rotation (or mirroring) that best maps `points` onto `reference` (orthogonal Procrustes), so
 * that morphing between methods shows how layouts differ rather than their arbitrary orientation.
 * R = M (MᵀM)^-½ with M = XᵀY, which equals UVᵀ from the SVD of M.
 */
function procrustes(points: Vec3[], reference: Vec3[], dims: number): number[][] {
  const mean = (ps: Vec3[]) => Array.from({ length: dims }, (_, d) => ps.reduce((s, p) => s + p[d], 0) / ps.length)
  const [mx, my] = [mean(points), mean(reference)]
  const m = Array.from({ length: dims }, (_, i) =>
    Array.from({ length: dims }, (_, j) => points.reduce((s, p, k) => s + (p[i] - mx[i]) * (reference[k][j] - my[j]), 0)),
  )
  const mtm = m.map((_, i) => m.map((__, j) => m.reduce((s, row) => s + row[i] * row[j], 0)))
  const { values, vectors } = symmetricEigen(mtm)
  const invSqrt = mtm.map((_, i) =>
    mtm.map((__, j) => values.reduce((s, val, k) => s + (vectors[i][k] * vectors[j][k]) / Math.sqrt(Math.max(val, 1e-12)), 0)),
  )
  return m.map((row) => invSqrt.map((_, j) => row.reduce((s, mik, k) => s + mik * invSqrt[k][j], 0)))
}

function identity(dims: number) {
  return Array.from({ length: dims }, (_, i) => Array.from({ length: dims }, (_, j) => (i === j ? 1 : 0)))
}

/** Apply a dims x dims rotation. Orthogonal maps preserve distances from the centre, so points stay within the unit sphere. */
function rotate(points: Vec3[], r: number[][], dims: number): Vec3[] {
  return points.map((p) => {
    const out: Vec3 = [0, 0, 0]
    for (let j = 0; j < dims; j++) for (let i = 0; i < dims; i++) out[j] += p[i] * r[i][j]
    return out
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
  resolution,
  onResolution,
  paths,
  pathsLabel,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  meta: Meta
  /** Digit side length whose projections are shown; shared with the matrices and previews. */
  resolution: number
  onResolution: (resolution: number) => void
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
  const keys = Object.keys(meta.projections)
  const methods = [...new Set(keys.map((k) => parseKey(k).method))]
  const [method, setMethod] = useState(methods[0])
  const [dims, setDims] = useState(parseKey(keys[0]).dims)
  const available = keys.map(parseKey).filter((k) => k.method === method && k.resolution === resolution)
  const dimsForMethod = available.map((k) => k.dims)
  // Fall back to whatever dimensionality this method has if the chosen one is missing.
  const matches = (k: string, d?: number) => {
    const p = parseKey(k)
    return p.method === method && p.resolution === resolution && (d === undefined || p.dims === d)
  }
  const name = keys.find((k) => matches(k, dims)) ?? keys.find((k) => matches(k))!
  // Smallest first, so stepping left to right adds detail.
  const resolutions = [...meta.resolutions].sort((a, b) => a - b)
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
  // Every projection, normalised and aligned to the first one of the same dimensionality (UMAP at full resolution).
  // Keep each rotation too, so its optimisation snapshots can be turned the same way.
  const aligned = useMemo(() => {
    const out: Record<string, { points: Vec3[]; rotation: number[][] }> = {}
    const references = new Map<number, Vec3[]>()
    for (const key of Object.keys(meta.projections)) {
      const { dims } = parseKey(key)
      const pts = normalize(meta.projections[key])
      const reference = references.get(dims)
      const rotation = reference ? procrustes(pts, reference, dims) : identity(dims)
      out[key] = { points: reference ? rotate(pts, rotation, dims) : pts, rotation }
      if (!reference) references.set(dims, pts)
    }
    return out
  }, [meta])
  const target = aligned[name].points

  // Morph between methods or resolutions of the same dimensionality; switching 2D/3D just jumps.
  const [points, setPoints] = useState(target)
  const shown = useRef({ name, points })
  useEffect(() => {
    shown.current.points = points
  })
  const morphing = useRef(false)

  // Replay the optimiser's snapshots for the current projection, ending on its final layout.
  const [evolution, setEvolution] = useState<{ name: string; status: 'loading' | 'playing'; iteration: number } | null>(
    null,
  )
  const evolutionRun = useRef(0)
  const stopEvolution = () => {
    evolutionRun.current++
    setEvolution(null)
    setPoints(target)
  }
  const playEvolution = async () => {
    const run = ++evolutionRun.current
    const { iterations } = meta.evolution[name]
    const dims = parseKey(name).dims
    const width = is3d ? 3 : 2
    const n = meta.rows.label.length
    setEvolution({ name, status: 'loading', iteration: 0 })
    let raw: Float32Array
    try {
      raw = await loadEvolution(name)
    } catch {
      if (run === evolutionRun.current) setEvolution(null)
      return
    }
    // Switching projection abandons a replay; the morph then starts from wherever it had got to.
    const abandoned = () => run !== evolutionRun.current || shown.current.name !== name
    if (abandoned()) {
      if (run === evolutionRun.current) setEvolution(null)
      return
    }
    const { rotation } = aligned[name]
    // Normalise each snapshot on its own (early layouts are much smaller or larger than the final one),
    // then turn it like the final layout; the last snapshot is the projection itself.
    const frames = iterations.map((_, s) => {
      if (s === iterations.length - 1) return target
      const coords = Array.from({ length: n }, (_, i) => Array.from(raw.subarray((s * n + i) * width, (s * n + i + 1) * width)))
      return rotate(normalize(coords), rotation, dims)
    })
    const t0 = performance.now()
    const step = (now: number) => {
      if (abandoned()) {
        if (run === evolutionRun.current) setEvolution(null)
        return
      }
      // rAF timestamps are the frame's start, which can be just before t0.
      const pos = Math.min(frames.length - 1, Math.max(0, (now - t0) / EVOLUTION_STEP_MS))
      const s = Math.min(frames.length - 2, Math.floor(pos))
      const t = pos - s
      const [a, b] = [frames[s], frames[s + 1]]
      setPoints(a.map((p, i) => p.map((v, d) => v + (b[i][d] - v) * t) as Vec3))
      setEvolution({ name, status: 'playing', iteration: Math.round(iterations[s] + (iterations[s + 1] - iterations[s]) * t) })
      if (pos < frames.length - 1) requestAnimationFrame(step)
      else {
        setPoints(target)
        setEvolution(null)
      }
    }
    requestAnimationFrame(step)
  }
  useEffect(() => {
    const { name: fromName, points: from } = shown.current
    shown.current.name = name
    if (from === target) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || parseKey(fromName).dims !== parseKey(name).dims) {
      setPoints(target)
      return
    }
    morphing.current = true
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - t0) / MORPH_MS))
      if (t < 1) {
        setPoints(from.map((p, i) => p.map((v, d) => v + (target[i][d] - v) * t) as Vec3))
        frame = requestAnimationFrame(step)
      } else {
        setPoints(target)
        morphing.current = false
      }
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      morphing.current = false
    }
  }, [name, target])
  const screen = useMemo(
    () => points.map((p) => (is3d ? project(p, pivot, rotation, view) : project(p, ORIGIN, { yaw: 0, pitch: 0 }, view))),
    [points, pivot, rotation, view, is3d],
  )

  // Glide the pivot to the pinned sample (centring it) or back to the origin on unpin.
  // Aim at where the sample ends up; during a morph, glide in step with it so it stays centred.
  const pinnedPoint = is3d && selected !== null ? target[selected] : null
  useEffect(() => {
    const duration = morphing.current ? MORPH_MS : GLIDE_MS
    const from = pivotRef.current
    const to = pinnedPoint ?? ORIGIN
    const fromPan = viewRef.current
    const recentre = pinnedPoint !== null
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = easeInOut(Math.min(1, (now - t0) / duration))
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

  // Keep the camera when only the method (or resolution) changes, so the morph plays out in place.
  const selectProjection = (next: { method?: string; dims?: number }) => {
    if (next.method) setMethod(next.method)
    if (next.dims) {
      setDims(next.dims)
      resetView()
    }
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
        <div className="segmented" role="tablist" aria-label="Digit resolution">
          {resolutions.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === resolution}
              className={r === resolution ? 'on' : ''}
              onClick={() => onResolution(r)}
            >
              {r}×{r}
            </button>
          ))}
        </div>
      </div>
      <div className="projection-head">
        <div className="segmented" role="tablist" aria-label="Projection method">
          {methods.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={m === method}
              className={m === method ? 'on' : ''}
              onClick={() => selectProjection({ method: m })}
            >
              {METHOD_NAMES[m] ?? m}
            </button>
          ))}
        </div>
        <div className="segmented" role="tablist" aria-label="Dimensions">
          {[2, 3].map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === (is3d ? 3 : 2)}
              className={d === (is3d ? 3 : 2) ? 'on' : ''}
              disabled={!dimsForMethod.includes(d)}
              onClick={() => selectProjection({ dims: d })}
            >
              {d}D
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
      <div className="evolution">
        {evolution?.name === name ? (
          <>
            <button className="button" onClick={stopEvolution}>
              {evolution.status === 'loading' ? 'Loading…' : 'Skip to end'}
            </button>
            {evolution.status === 'playing' && (
              <span className="muted">
                {method === 'umap' ? 'Epoch' : 'Iteration'} {evolution.iteration} of{' '}
                {meta.evolution[name].iterations.at(-1)}
              </span>
            )}
          </>
        ) : (
          <button
            className="button"
            onClick={playEvolution}
            title="Replay how the optimiser moved points from its starting layout to this one"
          >
            Show algorithmic evolution
          </button>
        )}
      </div>
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
