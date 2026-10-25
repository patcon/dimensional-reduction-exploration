import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { DIGIT_COLORS, FORCE_COLORS } from '../palette'
import { Button } from './ui/button'
import type { Dim, PairType, Weights } from '../types'

interface Props {
  /** Layout, n x dim row-major. Mutated in place by the engine, so redraws are driven by `version`. */
  Y: Float32Array
  dim: Dim
  labels: number[]
  /** Which digit labels are drawn (and can be picked); the layout is still fitted to them all, so it holds still. */
  shown: boolean[]
  /** Bump to redraw after Y changes. */
  version: number
  /** In 3D, spin the view slowly about the vertical axis. */
  autoRotate?: boolean
  /** Overlaid in the top left corner (e.g. the digits shown); points are kept clear of the top. */
  children?: ReactNode
  /** Overlaid in the top right corner (e.g. a preview of the picked digit). */
  corner?: ReactNode
  /** The clicked digit, ringed, and the one under the cursor (or a held finger), ringed more faintly. */
  selected: number | null
  hovered: number | null
  /** A digit was clicked, or nothing was (null), to select none. */
  onSelect: (i: number | null) => void
  onHover: (i: number | null) => void
  /** The selected digit's partners in each pair type, drawn as edges to it, or null for none. */
  edges: Record<PairType, Uint32Array> | null
  /** The forces now, which style the edges: solid attracting, dashed repelling, left out at no force. */
  weights: Weights
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
/** How near the cursor, in CSS pixels, a digit has to be to pick it. */
const PICK_RADIUS = 8
/** A press that moves further than this, in CSS pixels, is a drag (panning or turning), not a click. */
const CLICK_SLOP = 5
/** A press held this long without moving is a hold. */
const HOLD_MS = 350
/**
 * While a press is held, a random spot this many CSS pixels around it is picked every JITTER_MS, as if tapping all
 * round it, and whichever digit is there is hovered: so many digits nearby can be previewed, as a mouse could.
 */
const JITTER_RADIUS = 36
const JITTER_MS = 110
/** Spots tried per pick for a digit other than the one hovered, before keeping it. */
const JITTER_TRIES = 6
/** Far pairs first, so the nearer pairs' shorter edges are drawn over them. */
const EDGE_ORDER: PairType[] = ['fp', 'mn', 'nb']
/** How opaque each pair type's edges are: far pairs, the most numerous and longest, the faintest. */
const EDGE_ALPHA: Record<PairType, number> = { nb: 0.8, mn: 0.7, fp: 0.35 }
/** How wide each pair type's edges are, in CSS pixels: neighbours' are short, so they're drawn heavier to show. */
const EDGE_WIDTH: Record<PairType, number> = { nb: 2, mn: 1, fp: 1 }
/** The ring around a picked digit, in CSS pixels. */
const RING_RADIUS = 6

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
  probe.fillStyle = getComputedStyle(el).getPropertyValue('--background').trim() || '#ffffff'
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
 *
 * Clicking a digit selects it and clicking away selects none; the mouse hovers digits, and holding a press still
 * hovers digits picked at random around it (see JITTER_RADIUS), inside a ring drawn there.
 */
export function Scatter({ Y, dim, labels, shown, version, autoRotate = false, children, corner, selected, hovered, onSelect, onHover, edges, weights }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** The rings around the selected and hovered digits, over the points, so they move without redrawing them. */
  const marksRef = useRef<HTMLCanvasElement>(null)
  const holdRingRef = useRef<HTMLDivElement>(null)
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
  /** How the last draw was scaled, to find its points again: device pixels per CSS pixel, and the dot's size. */
  const drawnRef = useRef({ dpr: 1, dot: 1 })
  /** What the rings and the hold's jitter read, as they run outside a render. */
  const live = useRef({ selected, hovered, onHover })

  /** The digit nearest a canvas point (CSS pixels) as last drawn, within PICK_RADIUS, or null. */
  const pickAt = (x: number, y: number): number | null => {
    const scratch = scratchRef.current
    if (!scratch) return null
    const { dpr, dot } = drawnRef.current
    const px = x * dpr - dot / 2, py = y * dpr - dot / 2
    let best: number | null = null
    let bestD2 = (PICK_RADIUS * dpr) ** 2
    for (let i = 0; i < scratch.sx.length; i++) {
      if (!shown[labels[i]]) continue
      const d2 = (scratch.sx[i] - px) ** 2 + (scratch.sy[i] - py) ** 2
      // In 3D, nearer digits win ties, as they're drawn on top.
      if (d2 < bestD2 || (d2 === bestD2 && best !== null && scratch.level[i] < scratch.level[best])) {
        bestD2 = d2
        best = i
      }
    }
    return best
  }

  /** Rings the selected and hovered digits where they were last drawn, with the selected one's edges. */
  const drawMarks = useRef(() => {})
  const ringDigits = () => {
    const marks = marksRef.current!
    const canvas = canvasRef.current!
    if (marks.width !== canvas.width || marks.height !== canvas.height) {
      marks.width = canvas.width
      marks.height = canvas.height
    }
    const ctx = marks.getContext('2d')!
    ctx.clearRect(0, 0, marks.width, marks.height)
    const scratch = scratchRef.current
    if (!scratch) return
    const { dpr, dot } = drawnRef.current
    const style = getComputedStyle(marks)
    const ring = (i: number | null, faint: boolean) => {
      if (i === null || i >= scratch.sx.length) return
      ctx.beginPath()
      ctx.arc(scratch.sx[i] + dot / 2, scratch.sy[i] + dot / 2, RING_RADIUS * dpr, 0, 2 * Math.PI)
      // A halo of the background under the ring, so it shows over dense clusters.
      ctx.lineWidth = 4 * dpr
      ctx.strokeStyle = style.getPropertyValue('--background')
      ctx.stroke()
      ctx.lineWidth = (faint ? 1.25 : 2) * dpr
      ctx.strokeStyle = style.getPropertyValue(faint ? '--muted-foreground' : '--foreground')
      ctx.stroke()
    }
    const { selected, hovered } = live.current
    if (selected !== null && edges && selected < scratch.sx.length) {
      const x0 = scratch.sx[selected] + dot / 2, y0 = scratch.sy[selected] + dot / 2
      for (const type of EDGE_ORDER) {
        if (!weights[type]) continue
        ctx.beginPath()
        // To hidden digits too, so their pull on it still shows.
        for (const j of edges[type]) {
          ctx.moveTo(x0, y0)
          ctx.lineTo(scratch.sx[j] + dot / 2, scratch.sy[j] + dot / 2)
        }
        ctx.setLineDash(weights[type] < 0 ? [4 * dpr, 3 * dpr] : [])
        ctx.lineWidth = EDGE_WIDTH[type] * dpr
        ctx.globalAlpha = EDGE_ALPHA[type]
        ctx.strokeStyle = FORCE_COLORS[type]
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
    if (hovered !== selected) ring(hovered, true)
    ring(selected, false)
  }
  // First of the effects, so the others see this render's.
  useEffect(() => {
    live.current = { selected, hovered, onHover }
    drawMarks.current = ringDigits
  })
  useEffect(() => drawMarks.current(), [selected, hovered, edges, weights])

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
    drawnRef.current = { dpr, dot }
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
      if (!shown[labels[i]]) continue
      const x0 = Math.round(sx[i])
      const y0 = Math.round(sy[i])
      if (x0 < 0 || y0 < 0 || x0 > w - dot || y0 > h - dot) continue
      const c = colors[labels[i] * FADE_LEVELS + level[i]]
      for (let dy = 0; dy < dot; dy++) px.fill(c, (y0 + dy) * w + x0, (y0 + dy) * w + x0 + dot)
    }
    ctx.putImageData(image, 0, 0)
    drawMarks.current()
  }, [Y, dim, labels, shown, order, size, version, viewVersion])

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

  /**
   * A single press, from where it went down: whether it has moved far enough to be a drag, and the view as it was,
   * to undo what it dragged within CLICK_SLOP if it turns out to be a hold.
   */
  const pressRef = useRef<{ x: number; y: number; far: boolean; view: View; moved: boolean } | null>(null)
  /** The hold, once a press is held: where it is now, and its timers. */
  const holdRef = useRef<{ timer?: ReturnType<typeof setTimeout>; jitter?: ReturnType<typeof setInterval>; at: { x: number; y: number } | null }>({ at: null })

  const placeHoldRing = (x: number, y: number) => {
    const ring = holdRingRef.current!
    ring.style.transform = `translate(${x}px, ${y}px)`
    ring.hidden = false
  }
  const jitterPick = () => {
    const at = holdRef.current.at
    if (!at) return
    for (let t = 0; t < JITTER_TRIES; t++) {
      const r = JITTER_RADIUS * Math.sqrt(Math.random()), a = Math.random() * 2 * Math.PI
      const i = pickAt(at.x + r * Math.cos(a), at.y + r * Math.sin(a))
      if (i !== null && i !== live.current.hovered) return live.current.onHover(i)
    }
  }
  const startHold = () => {
    const press = pressRef.current
    if (!press) return
    // Whatever the press dragged within the slop is undone, and it no longer drags or clicks.
    viewRef.current = press.view
    setMoved(press.moved)
    redraw()
    const at = [...pointersRef.current.values()][0] ?? press
    holdRef.current.at = at
    placeHoldRing(at.x, at.y)
    jitterPick()
    holdRef.current.jitter = setInterval(jitterPick, JITTER_MS)
  }
  const endHold = () => {
    const hold = holdRef.current
    clearTimeout(hold.timer)
    if (!hold.at) return
    clearInterval(hold.jitter)
    hold.at = null
    holdRingRef.current!.hidden = true
    live.current.onHover(null)
  }
  useEffect(() => endHold, [])

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, at(e))
    dragModeRef.current = turnable && e.button === 0 && !e.shiftKey ? 'turn' : 'pan'
    if (pointersRef.current.size === 1 && e.button === 0) {
      pressRef.current = { ...at(e), far: false, view: { ...viewRef.current }, moved }
      holdRef.current.timer = setTimeout(startHold, HOLD_MS)
    } else {
      // A second finger (a pinch) or another button: not a click or a hold.
      pressRef.current = null
      endHold()
    }
  }
  const onPointerMove = (e: PointerEvent) => {
    const pointers = pointersRef.current
    const last = pointers.get(e.pointerId)
    const now = at(e)
    if (!last) {
      // Nothing pressed: the mouse hovers whichever digit it's over.
      if (e.pointerType === 'mouse') onHover(pickAt(now.x, now.y))
      return
    }
    if (holdRef.current.at) {
      holdRef.current.at = now
      placeHoldRing(now.x, now.y)
      return
    }
    const press = pressRef.current
    if (press && !press.far && Math.hypot(now.x - press.x, now.y - press.y) > CLICK_SLOP) {
      press.far = true
      clearTimeout(holdRef.current.timer)
      onHover(null)
    }
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
    const press = pressRef.current
    const held = holdRef.current.at !== null
    endHold()
    pressRef.current = null
    // A click selects the digit under it, or, away from any, selects none.
    if (press && !press.far && !held && e.type === 'pointerup') {
      const { x, y } = at(e)
      onSelect(pickAt(x, y))
    }
  }
  const onPointerLeave = () => {
    if (!pointersRef.current.size && !holdRef.current.at) onHover(null)
  }
  const resetView = () => {
    viewRef.current = { ...INITIAL_VIEW }
    setMoved(false)
    redraw()
  }

  return (
    <div ref={wrapRef} className="scatter h-[60vh] min-w-0 flex-1 rounded-lg border">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={resetView}
        onContextMenu={(e) => e.preventDefault()}
        className={hovered !== null ? 'over-digit' : undefined}
      />
      <canvas ref={marksRef} className="scatter-marks" style={{ width: size.width, height: size.height }} />
      <div
        ref={holdRingRef}
        hidden
        className="scatter-hold"
        style={{ width: JITTER_RADIUS * 2, height: JITTER_RADIUS * 2, margin: -JITTER_RADIUS }}
      />
      {children && <div className="scatter-overlay">{children}</div>}
      {corner && <div className="scatter-corner">{corner}</div>}
      {moved && (
        <Button variant="outline" size="sm" className="scatter-reset" onClick={resetView} title="Or double-click the plot">
          Reset view
        </Button>
      )}
    </div>
  )
}
