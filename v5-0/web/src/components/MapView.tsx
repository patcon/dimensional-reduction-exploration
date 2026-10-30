import { useEffect, useMemo, useRef } from 'react'
import type { MapMusic } from '../analysis'
import type { MusicWalk } from '../music'
import { broadColor, fineColor, rgbCss } from '../palette'

/** Clear of the window's edges, in CSS pixels. */
const PAD = 24
/** How near a tap must land to a digit to move the walker there, in CSS pixels. */
const TAP_RADIUS = 40

/**
 * The map: each digit on the map at its PaCMAP position, coloured by its broad group (or, `showFine`, its small
 * group), with the walker's small group ringed, its trail behind it, and the walker itself ringed in white. It fills
 * the window and centres in what `coveredBottom` leaves above the drawer, as a map would; tapping moves the walker.
 */
export function MapView({ xy, music, walk, showFine, coveredBottom }: {
  xy: Float32Array
  music: MapMusic | null
  walk: MusicWalk
  showFine: boolean
  /** How much of the window's bottom the drawer covers right now, in CSS pixels. */
  coveredBottom: () => number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ showFine })
  useEffect(() => {
    latest.current = { showFine }
  })

  // The map's bounds, for the digits on it.
  const bounds = useMemo(() => {
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const r of music?.rows ?? []) {
      x0 = Math.min(x0, xy[2 * r])
      x1 = Math.max(x1, xy[2 * r])
      y0 = Math.min(y0, xy[2 * r + 1])
      y1 = Math.max(y1, xy[2 * r + 1])
    }
    return { x0, x1, y0, y1 }
  }, [music?.rows, xy])

  /** Where row r of the data is on the canvas now, in CSS pixels. */
  const place = useRef<(r: number) => [number, number]>(() => [0, 0])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let id = requestAnimationFrame(function draw() {
      id = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const { width, height } = canvas.getBoundingClientRect()
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      if (!music || !music.rows.length) return

      const { x0, x1, y0, y1 } = bounds
      const h = Math.max(1, height - coveredBottom())
      const scale = Math.min((width - 2 * PAD) / (x1 - x0 || 1), (h - 2 * PAD) / (y1 - y0 || 1))
      const ox = (width - (x1 - x0) * scale) / 2
      const oy = (h - (y1 - y0) * scale) / 2
      const at = (r: number): [number, number] => [ox + (xy[2 * r] - x0) * scale, oy + (xy[2 * r + 1] - y0) * scale]
      place.current = at

      const { showFine } = latest.current
      const { rows, broad, fine } = music
      const radius = Math.max(1.7, Math.min(width, h) / 320)
      ctx.globalAlpha = 0.75
      rows.forEach((r, i) => {
        const [x, y] = at(r)
        ctx.fillStyle = showFine ? fineColor(fine[i]) : rgbCss(broadColor(broad[i]))
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, 2 * Math.PI)
        ctx.fill()
      })

      const node = walk.node !== null && walk.node < rows.length ? walk.node : null
      ctx.strokeStyle = 'white'
      // The walker's small group, whose note it's playing.
      if (node !== null) {
        ctx.globalAlpha = 0.6
        ctx.lineWidth = 1
        ctx.beginPath()
        rows.forEach((r, i) => {
          if (fine[i] !== fine[node]) return
          const [x, y] = at(r)
          ctx.moveTo(x + radius + 2, y)
          ctx.arc(x, y, radius + 2, 0, 2 * Math.PI)
        })
        ctx.stroke()
      }
      // Its trail, fading into the past.
      const trail = walk.trail
      ctx.lineWidth = 1.5
      for (let k = 1; k < trail.length; k++) {
        ctx.globalAlpha = (k / trail.length) * 0.8
        ctx.beginPath()
        ctx.moveTo(...at(trail[k - 1]))
        ctx.lineTo(...at(trail[k]))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (node !== null) {
        const [x, y] = at(rows[node])
        ctx.fillStyle = showFine ? fineColor(fine[node]) : rgbCss(broadColor(broad[node]))
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, y, 6.5, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [music, bounds, xy, walk, coveredBottom])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!music) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let best = -1
    let bestD = TAP_RADIUS * TAP_RADIUS
    music.rows.forEach((r, i) => {
      const [x, y] = place.current(r)
      const d = (x - px) ** 2 + (y - py) ** 2
      if (d < bestD) [bestD, best] = [d, i]
    })
    if (best >= 0) walk.moveTo(best)
  }

  return (
    <div className="viz-canvas">
      <canvas ref={canvasRef} onPointerDown={onPointerDown} aria-label="Map of digits; tap one to move the walker there" className="cursor-crosshair" />
    </div>
  )
}
