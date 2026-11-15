import { useEffect, useRef } from 'react'
import { BAR, FS, SLOT, SUB, WIN } from '../crowd'
import type { CrowdEngine } from '../engine'
import { gradientRGB, OTHER_COLOR, patternColor, rgbCss, slotColor } from '../palette'
import type { Gradient } from '../protocol'

/** Seconds shown, and how far the view pages at a time. */
const VIEW = 24
const PAGE = 16
const GUTTER = 28
const RULER = 18

/**
 * Every phone's facing over the last bars, a row each, as "Phone-flip crowd"'s timeline: rows by detected group, with
 * the true pattern (outer) and detected group (inner) along the left, the window being grouped shaded, and the playhead.
 */
export function Timeline({ engine, gradient, focus }: { engine: CrowdEngine; gradient: Gradient; focus: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ gradient, focus })
  useEffect(() => {
    live.current = { gradient, focus }
  })

  useEffect(() => {
    const canvas = canvasRef.current!
    const off = document.createElement('canvas')
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const n = engine.phones.length
      const w = canvas.clientWidth
      if (!w || !n) return
      const rowH = Math.max(2, Math.min(10, Math.floor(320 / n)))
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
      // Rows by detected group, then by phone.
      const order = [...Array(n).keys()].sort((a, b) => ((engine.slot(a) + 99) % 99) - ((engine.slot(b) + 99) % 99) || a - b)

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

      // Strips: true pattern (outer), detected group (inner); the followed phone marked.
      for (let r = 0; r < n; r++) {
        const i = order[r], y = RULER + r * rowH, p = engine.pattern(i), slot = engine.slot(i)
        ctx.fillStyle = p >= 0 ? rgbCss(patternColor(p)) : '#ffffff'
        ctx.fillRect(3, y, 7, rowH)
        ctx.fillStyle = rgbCss(slot >= 0 ? slotColor(slot) : OTHER_COLOR)
        ctx.fillRect(12, y, 7, rowH)
        if (i === live.current.focus) {
          ctx.strokeStyle = '#fff'
          ctx.setLineDash([4, 3])
          ctx.strokeRect(GUTTER + 0.5, y - 1, pw - 1, rowH + 2)
          ctx.setLineDash([])
        }
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

  return <canvas ref={canvasRef} className="block w-full rounded-md" aria-label={`Each phone's facing over the last ${VIEW / BAR} bars`} />
}
