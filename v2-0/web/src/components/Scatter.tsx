import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { DIGIT_COLORS } from '../palette'
import type { Dim } from '../types'

interface Props {
  /** Layout, n x dim row-major. Mutated in place by the engine, so redraws are driven by `version`. */
  Y: Float32Array
  dim: Dim
  labels: number[]
  /** Bump to redraw after Y changes. */
  version: number
  /** In 3D, spin the view slowly about the vertical axis. */
  autoRotate?: boolean
  /** Overlaid along the top of the plot (e.g. a legend); points are kept clear of it. */
  children?: ReactNode
}

const PAD = 12
/** Room kept clear at the top for the overlay. */
const PAD_TOP = 36
/** Point size in CSS pixels. */
const DOT = 2

/** 3D: the camera sits this many layout radii from the centre (lower is stronger perspective). */
const CAMERA_DISTANCE = 4
/** 3D: the farthest points fade this far towards the background, as a depth cue. */
const FAR_FADE = 0.65
/** 3D: shades of each digit's colour, from near to far. */
const FADE_LEVELS = 16
/** 3D: depth buckets points are sorted into, so nearer points are drawn over farther ones. */
const DEPTH_BUCKETS = 512
/** 3D: auto-rotate speed, radians per second (a turn every ~25 s). */
const SPIN = 0.25
/** 3D: radians turned per CSS pixel dragged. */
const DRAG_TURN = 0.008
/** How far zoom can go, as a multiple of the fitted size. */
const ZOOM_RANGE = [0.5, 500]
/** Zoom per pixel of wheel scroll. */
const WHEEL_ZOOM = 0.002

interface View {
  /** 3D: yaw about the vertical axis, then pitch towards the viewer. */
  yaw: number
  pitch: number
  /** Magnification over the auto-fit, and the pan applied after it, in CSS pixels. */
  zoom: number
  panX: number
  panY: number
}
const INITIAL_VIEW: View = { yaw: 0.6, pitch: 0.3, zoom: 1, panX: 0, panY: 0 }

/** Packs r, g, b as a little-endian RGBA word for a Uint32Array view of ImageData. */
const pack = (r: number, g: number, b: number) => ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0

const rgb = (hex: string) => {
  const v = parseInt(hex.slice(1), 16)
  return [v >> 16, (v >> 8) & 0xff, v & 0xff]
}

/** Each digit's colour at FADE_LEVELS depths, faded towards `bg`: index digit * FADE_LEVELS + level. */
function packedColors(bg: number[]) {
  const out = new Uint32Array(DIGIT_COLORS.length * FADE_LEVELS)
  DIGIT_COLORS.forEach((hex, digit) => {
    const c = rgb(hex)
    for (let level = 0; level < FADE_LEVELS; level++) {
      const t = (FAR_FADE * level) / (FADE_LEVELS - 1)
      const [r, g, b] = c.map((v, k) => Math.round(v + (bg[k] - v) * t))
      out[digit * FADE_LEVELS + level] = pack(r, g, b)
    }
  })
  return out
}

/** Indices 0..n-1 in a fixed shuffled order (seeded mulberry32), so no digit is always drawn on top. */
function shuffledOrder(n: number) {
  let seed = 0x9e3779b9
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const o = Uint32Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

function makeScratch(n: number) {
  return {
    /** Each point's top-left corner on the canvas, and how faded it is. */
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    level: new Uint8Array(n),
    /** 3D: each point's depth bucket, where each bucket starts, and the points in drawing order. */
    bucket: new Uint16Array(n),
    starts: new Uint32Array(DEPTH_BUCKETS + 1),
    sorted: new Uint32Array(n),
  }
}

/** The middle of the space the layout is fitted into (below the overlay), in canvas pixels. */
const plotCentre = (w: number, h: number, dpr: number) => [w / 2, PAD_TOP * dpr + (h - (PAD + PAD_TOP) * dpr) / 2]

/** The page background as [r, g, b], so the canvas follows light/dark mode. */
function background(el: Element) {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.fillStyle = getComputedStyle(el).getPropertyValue('--bg').trim() || '#ffffff'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/**
 * Every point as a small square, coloured by digit and refitted to the canvas on every draw
 * (the layout grows ~1000x over a run). Points are drawn straight into ImageData.
 *
 * In 3D the layout is seen in perspective, turned by dragging or auto-rotating. It's fitted to
 * its bounding sphere, so the zoom doesn't wobble as it turns; nearer points are drawn over
 * farther ones, which fade towards the background.
 *
 * Zoom and pan sit on top of the auto-fit, so they hold as the layout grows: the wheel (or a
 * trackpad or two-finger pinch) zooms about the cursor, and dragging pans (in 3D, shift- or
 * right-drag, or two fingers). Double-click resets the view.
 */
export function Scatter({ Y, dim, labels, version, autoRotate = false, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const viewRef = useRef<View>({ ...INITIAL_VIEW })
  /** Bumped whenever the view changes, to redraw. */
  const [viewVersion, setViewVersion] = useState(0)
  /** Whether the view has been zoomed or panned, to offer resetting it. */
  const [moved, setMoved] = useState(false)
  /** Pointers down on the plot, by id, at their last canvas position (CSS pixels). */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  /** What a single pointer's drag does. */
  const dragModeRef = useRef<'turn' | 'pan'>('pan')

  const order = useMemo(() => shuffledOrder(labels.length), [labels])
  /** Per-point working space for a draw, reused between draws. */
  const scratchRef = useRef<ReturnType<typeof makeScratch>>(null)

  useEffect(() => {
    const el = wrapRef.current!
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Spin, unless the view is being dragged.
  useEffect(() => {
    if (dim !== 3 || !autoRotate) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      if (!pointersRef.current.size) {
        viewRef.current.yaw += (SPIN * (now - last)) / 1000
        setViewVersion((v) => v + 1)
      }
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dim, autoRotate])

  useEffect(() => {
    const canvas = canvasRef.current!
    const { width, height } = size
    if (!width || !height) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr)
    const h = Math.round(height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const pad = PAD * dpr
    const padTop = PAD_TOP * dpr
    const dot = Math.max(1, Math.round(DOT * dpr))
    const n = labels.length
    if (scratchRef.current?.sx.length !== n) scratchRef.current = makeScratch(n)
    const scratch = scratchRef.current
    const { sx, sy, level } = scratch
    let drawOrder: Uint32Array = order

    if (dim === 2) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (let k = 0; k < Y.length; k += 2) {
        minX = Math.min(minX, Y[k])
        maxX = Math.max(maxX, Y[k])
        minY = Math.min(minY, Y[k + 1])
        maxY = Math.max(maxY, Y[k + 1])
      }
      // One scale for both axes, so the layout's shape isn't distorted.
      const scale = Math.min((w - 2 * pad - dot) / (maxX - minX || 1), (h - pad - padTop - dot) / (maxY - minY || 1))
      const offX = (w - (maxX - minX) * scale - dot) / 2
      // Distance from the bottom edge, centring the layout in the space below the overlay.
      const offY = pad + (h - pad - padTop - (maxY - minY) * scale - dot) / 2
      for (let i = 0; i < n; i++) {
        sx[i] = offX + (Y[2 * i] - minX) * scale
        // Flip y so the layout reads like a conventional plot.
        sy[i] = h - offY - (Y[2 * i + 1] - minY) * scale - dot
      }
      level.fill(0)
    } else {
      // Centre on the bounding box, and fit the sphere around it that holds every point.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let k = 0; k < Y.length; k += 3) {
        minX = Math.min(minX, Y[k])
        maxX = Math.max(maxX, Y[k])
        minY = Math.min(minY, Y[k + 1])
        maxY = Math.max(maxY, Y[k + 1])
        minZ = Math.min(minZ, Y[k + 2])
        maxZ = Math.max(maxZ, Y[k + 2])
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
      let r2 = 0
      for (let k = 0; k < Y.length; k += 3)
        r2 = Math.max(r2, (Y[k] - cx) ** 2 + (Y[k + 1] - cy) ** 2 + (Y[k + 2] - cz) ** 2)
      const R = Math.sqrt(r2) || 1
      const D = CAMERA_DISTANCE * R
      // A point on the sphere's rim can't project further out than R / sin(the sphere's half-angle).
      const rim = R / Math.sqrt(1 - 1 / CAMERA_DISTANCE ** 2)
      const scale = Math.min(w - 2 * pad - dot, h - pad - padTop - dot) / (2 * rim)
      const midX = (w - dot) / 2
      const midY = padTop + (h - pad - padTop - dot) / 2
      const { yaw, pitch } = viewRef.current
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch)
      const { bucket, starts, sorted } = scratch
      starts.fill(0)
      for (let i = 0; i < n; i++) {
        const x = Y[3 * i] - cx, y = Y[3 * i + 1] - cy, z = Y[3 * i + 2] - cz
        const x1 = cosY * x + sinY * z
        const z1 = cosY * z - sinY * x
        const y2 = cosP * y - sinP * z1
        // Towards the viewer is positive.
        const z2 = sinP * y + cosP * z1
        const persp = (D * scale) / (D - z2)
        sx[i] = midX + x1 * persp
        sy[i] = midY - y2 * persp
        // 0 nearest, 1 farthest.
        const far = Math.min(1, Math.max(0, (R - z2) / (2 * R)))
        level[i] = Math.round(far * (FADE_LEVELS - 1))
        // Far points in low buckets, drawn first.
        bucket[i] = Math.round((1 - far) * (DEPTH_BUCKETS - 1))
        starts[bucket[i] + 1]++
      }
      // Counting sort by depth; within a bucket, keep the shuffled order.
      for (let b = 0; b < DEPTH_BUCKETS; b++) starts[b + 1] += starts[b]
      for (const i of order) sorted[starts[bucket[i]]++] = i
      drawOrder = sorted
    }

    // Zoom about the plot's centre, then pan.
    const { zoom, panX, panY } = viewRef.current
    if (zoom !== 1 || panX || panY) {
      const [cx, cy] = plotCentre(w, h, dpr)
      for (let i = 0; i < n; i++) {
        sx[i] = cx + (sx[i] - cx) * zoom + panX * dpr
        sy[i] = cy + (sy[i] - cy) * zoom + panY * dpr
      }
    }

    const bg = background(canvas)
    const colors = packedColors(bg)
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(w, h)
    const px = new Uint32Array(image.data.buffer)
    px.fill(pack(bg[0], bg[1], bg[2]))
    for (const i of drawOrder) {
      const x0 = Math.round(sx[i])
      const y0 = Math.round(sy[i])
      if (x0 < 0 || y0 < 0 || x0 > w - dot || y0 > h - dot) continue
      const c = colors[labels[i] * FADE_LEVELS + level[i]]
      for (let dy = 0; dy < dot; dy++) px.fill(c, (y0 + dy) * w + x0, (y0 + dy) * w + x0 + dot)
    }
    ctx.putImageData(image, 0, 0)
  }, [Y, dim, labels, order, size, version, viewVersion])

  const turnable = dim === 3
  const redraw = () => setViewVersion((v) => v + 1)

  /** Zoom by `factor` about a canvas point (CSS pixels), keeping what's under it in place. */
  const zoomAt = (x: number, y: number, factor: number) => {
    const view = viewRef.current
    const zoom = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], view.zoom * factor))
    const [cx, cy] = plotCentre(size.width, size.height, 1)
    const k = zoom / view.zoom
    view.panX = (x - cx) - k * (x - cx - view.panX)
    view.panY = (y - cy) - k * (y - cy - view.panY)
    view.zoom = zoom
    setMoved(true)
    redraw()
  }

  // A native listener, as React's wheel listeners can't preventDefault to stop the page scrolling.
  // Trackpad pinches arrive as wheel events with ctrlKey, finer-grained, so they're scaled up.
  const zoomAtRef = useRef(zoomAt)
  useEffect(() => {
    zoomAtRef.current = zoomAt
  })
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAtRef.current(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-pixels * WHEEL_ZOOM * (e.ctrlKey ? 5 : 1)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const at = (e: PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, at(e))
    dragModeRef.current = turnable && e.button === 0 && !e.shiftKey ? 'turn' : 'pan'
  }
  const onPointerMove = (e: PointerEvent) => {
    const pointers = pointersRef.current
    const last = pointers.get(e.pointerId)
    if (!last) return
    const now = at(e)
    const view = viewRef.current
    if (pointers.size === 1) {
      const dx = now.x - last.x, dy = now.y - last.y
      if (dragModeRef.current === 'turn') {
        view.yaw += dx * DRAG_TURN
        view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch + dy * DRAG_TURN))
      } else {
        view.panX += dx
        view.panY += dy
        setMoved(true)
      }
      pointers.set(e.pointerId, now)
      redraw()
    } else if (pointers.size === 2) {
      // Two fingers: pan with their midpoint, zoom with their spread.
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const before = { x: (last.x + other.x) / 2, y: (last.y + other.y) / 2, d: Math.hypot(last.x - other.x, last.y - other.y) }
      const after = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2, d: Math.hypot(now.x - other.x, now.y - other.y) }
      pointers.set(e.pointerId, now)
      view.panX += after.x - before.x
      view.panY += after.y - before.y
      zoomAt(after.x, after.y, before.d ? after.d / before.d : 1)
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    // Lifting one of two fingers leaves the other panning, not turning.
    dragModeRef.current = 'pan'
  }
  const resetView = () => {
    viewRef.current = { ...INITIAL_VIEW }
    setMoved(false)
    redraw()
  }

  return (
    <div ref={wrapRef} className="scatter">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
        onContextMenu={(e) => e.preventDefault()}
      />
      {children && <div className="scatter-overlay">{children}</div>}
      {moved && (
        <button type="button" className="scatter-reset" onClick={resetView} title="Or double-click the plot">
          Reset view
        </button>
      )}
    </div>
  )
}
