import { useEffect, useRef, useState } from 'react'
import { BAR, FS, SLOT, SUB, WIN } from '../crowd'
import type { CrowdEngine } from '../engine'
import { gradientRGB, OTHER_COLOR, patternColor, rgbCss, slotColor } from '../palette'
import type { Gradient } from '../protocol'

/** Seconds shown, and how far the view pages at a time. */
const VIEW = 24
const PAGE = 16
/** The strips on the left: true pattern, detected group, selection. */
const GUTTER = 32
const RULER = 18

export interface TimelineProps {
  engine: CrowdEngine
  gradient: Gradient
  focus: number | null
  /** Phones selected for painting, by index. */
  selected: Set<number>
  /** Selects (or deselects) these phones. */
  onSelect: (phones: number[], on: boolean) => void
}

/**
 * Every phone's facing over the last bars, a row each, as "Phone-flip crowd"'s timeline: rows by detected group, with
 * the true pattern (outer) and detected group (inner) along the left, the window being grouped shaded, the playhead,
 * and a tick where a phone switched pattern. Rows are selected for painting by dragging over them with a mouse, or, by
 * touch (so the drawer still scrolls), by tapping a first row and then a last; tapping a row twice selects just it.
 * Rows hold their order while selecting.
 */
export function Timeline({ engine, gradient, focus, selected, onSelect }: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const live = useRef({ gradient, focus, selected, anchor })
  useEffect(() => {
    live.current = { gradient, focus, selected, anchor }
  })
  /** Phones in row order, and each row's height, as last drawn. */
  const rows = useRef<{ order: number[]; rowH: number }>({ order: [], rowH: 4 })
  const drag = useRef<{ on: boolean; last: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const off = document.createElement('canvas')
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const n = engine.phones.length
      const w = canvas.clientWidth
      if (!w || !n) return
      const rowH = Math.max(3, Math.min(12, Math.floor(360 / n)))
      const h = RULER + n * rowH + 4
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        canvas.style.height = `${h}px`
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0f0f0e'
      ctx.fillRect(0, 0, w, h)
      const T = engine.t, pw = w - GUTTER - 2
      const vs = PAGE * Math.floor((T - WIN) / PAGE)
      const tx = (t: number) => GUTTER + ((t - vs) / VIEW) * pw
      // Rows by detected group, then by phone; held while a selection is being made, so rows don't move under it.
      let order = rows.current.order
      if (order.length !== n || (!drag.current && live.current.anchor === null)) {
        order = [...Array(n).keys()].sort((a, b) => ((engine.slot(a) + 99) % 99) - ((engine.slot(b) + 99) % 99) || a - b)
      }
      rows.current = { order, rowH }

      // The window, and the grid of bars and steps.
      ctx.fillStyle = 'rgba(57,135,229,0.16)'
      ctx.fillRect(tx(T - WIN), RULER - 4, tx(T) - tx(T - WIN), h)
      ctx.font = '10px system-ui,sans-serif'
      ctx.textBaseline = 'middle'
      for (let s = Math.ceil(vs / SLOT); s * SLOT <= vs + VIEW + 1e-9; s++) {
        const x = Math.round(tx(s * SLOT)) + 0.5, bar = s % 4 === 0
        ctx.strokeStyle = '#2e2e2b'
        ctx.beginPath()
        ctx.moveTo(x, bar ? RULER - 6 : RULER - 4)
        ctx.lineTo(x, bar ? h : RULER - 1)
        ctx.stroke()
        if (bar) {
          ctx.fillStyle = '#c3c2b7'
          ctx.fillText(String(s / 4 + 1), x + 3, 6)
        } else if (pw / (VIEW / SLOT) >= 13) {
          ctx.fillStyle = '#8b8a83'
          ctx.fillText(SUB[s % 4], x + 3, 6)
        }
      }

      // The heatmap, a pixel per row per column, then stretched.
      const cols = Math.max(1, Math.round(pw))
      if (off.width !== cols || off.height !== n) { off.width = cols; off.height = n }
      const octx = off.getContext('2d')!, img = octx.createImageData(cols, n), d = img.data
      const g = live.current.gradient
      for (let c = 0; c < cols; c++) {
        const t = vs + ((c + 0.5) / cols) * VIEW
        if (t > T) break
        const s = Math.round(t * FS)
        for (let r = 0; r < n; r++) {
          const o = (r * cols + c) * 4
          gradientRGB(g, engine.sample(order[r], s), d, o)
          d[o + 3] = 255
        }
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(off, GUTTER, RULER, pw, n * rowH)

      const { selected, focus, anchor } = live.current
      for (let r = 0; r < n; r++) {
        const i = order[r], y = RULER + r * rowH, p = engine.pattern(i), slot = engine.slot(i)
        // Strips: true pattern (outer; white for a live phone), detected group (inner), selected.
        ctx.fillStyle = p >= 0 ? rgbCss(patternColor(p)) : '#ffffff'
        ctx.fillRect(2, y, 7, rowH)
        ctx.fillStyle = rgbCss(slot >= 0 ? slotColor(slot) : OTHER_COLOR)
        ctx.fillRect(11, y, 7, rowH)
        if (selected.has(i)) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(21, y, 7, rowH)
        }
        // Where it switched pattern, in the new one's colour.
        const phone = engine.phones[i]
        if (phone && !phone.live) {
          const segs = engine.crowd.people[phone.index]?.segs ?? []
          for (let q = 1; q < segs.length; q++) {
            const sg = segs[q]
            if (sg.from < vs || sg.from > vs + VIEW) continue
            const x = tx(sg.from)
            ctx.fillStyle = '#0f0f0e'
            ctx.fillRect(x - 2, y, 4, rowH)
            ctx.fillStyle = rgbCss(patternColor(sg.pattern))
            ctx.fillRect(x - 1, y, 2, rowH)
          }
        }
        if (i === focus || i === anchor) {
          ctx.strokeStyle = '#fff'
          ctx.setLineDash([4, 3])
          ctx.strokeRect(GUTTER + 0.5, y - 1, pw - 1, rowH + 2)
          ctx.setLineDash([])
        }
      }
      // The selection, outlined in runs of rows.
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      for (let r = 0; r < n; r++) {
        if (!selected.has(order[r]) || (r > 0 && selected.has(order[r - 1]))) continue
        let e = r
        while (e + 1 < n && selected.has(order[e + 1])) e++
        ctx.strokeRect(GUTTER + 0.75, RULER + r * rowH + 0.75, pw - 1.5, (e - r + 1) * rowH - 1.5)
      }
      // The playhead.
      ctx.strokeStyle = '#f0efec'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(tx(T), RULER - 4)
      ctx.lineTo(tx(T), h)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  // ── Selecting rows ──
  const rowAt = (clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { order, rowH } = rows.current
    return Math.max(-1, Math.min(order.length - 1, Math.floor((clientY - rect.top - RULER) / rowH)))
  }
  const range = (a: number, b: number) => rows.current.order.slice(Math.min(a, b), Math.max(a, b) + 1)
  const tap = useRef<{ x: number; y: number; t: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse') {
      tap.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      return
    }
    const row = rowAt(e.clientY)
    if (row < 0) return
    e.preventDefault()
    const on = !live.current.selected.has(rows.current.order[row])
    drag.current = { on, last: row }
    onSelect(range(row, row), on)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const row = Math.max(0, rowAt(e.clientY))
    onSelect(range(d.last, row), d.on)
    d.last = row
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) {
      drag.current = null
      return
    }
    const t = tap.current
    tap.current = null
    // A move or a long press was a scroll.
    if (!t || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || performance.now() - t.t > 600) return
    const row = rowAt(e.clientY)
    if (row < 0) return setAnchor(null)
    const i = rows.current.order[row]
    if (anchor === null) return setAnchor(i)
    const from = rows.current.order.indexOf(anchor)
    setAnchor(null)
    if (from < 0) return
    // The same row twice toggles just it; another selects everything between.
    if (from === row) onSelect([i], !live.current.selected.has(i))
    else onSelect(range(from, row), true)
  }

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={canvasRef}
        className="block w-full cursor-crosshair rounded-md"
        aria-label={`Each phone's facing over the last ${VIEW / BAR} bars; select rows to paint`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; tap.current = null }}
      />
      {anchor !== null && (
        <p className="text-xs text-muted-foreground">
          Now tap the last row to select (the same row again for just it).{' '}
          <button className="underline" onClick={() => setAnchor(null)}>Cancel</button>
        </p>
      )}
    </div>
  )
}
