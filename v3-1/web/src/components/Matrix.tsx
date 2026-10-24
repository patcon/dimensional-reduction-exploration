import { useEffect, useMemo, useRef, useState } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import type { Traces } from '../signal'

const STRIP_WIDTH = 8
const MATRIX_HEIGHT = 360

/**
 * v1's matrix with a playhead: one row per digit taking part (in chord order, so a
 * grouped order shows each group as a band), one column per moment, in grey as it's played
 * (smoothed). The playhead sweeps across it, with the trail's reach shaded behind.
 */
export function Matrix({
  traces,
  slotOf,
  groupOf,
  colors,
  grouped,
  focus,
  hover,
  onFocus,
  onHover,
  playhead,
  trailPixels,
}: {
  traces: Traces
  slotOf: Int32Array
  groupOf: Int32Array
  colors: RGB[]
  /** Whether rows sit group by group, so boundaries between groups are worth drawing. */
  grouped: boolean
  focus: number | null
  hover: number | null
  onFocus: (participant: number) => void
  onHover: (participant: number | null) => void
  playhead: Playhead
  trailPixels: number
}) {
  const imageRef = useRef<HTMLCanvasElement>(null)
  const stripRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const { n, length } = traces
  const rowHeight = Math.max(1, Math.min(10, Math.floor(MATRIX_HEIGHT / Math.max(n, 1))))
  const height = rowHeight * n
  const dpr = window.devicePixelRatio || 1

  // participantAt[row] = who is drawn at that row.
  const participantAt = useMemo(() => {
    const at = new Int32Array(n)
    slotOf.forEach((slot, p) => (at[slot] = p))
    return at
  }, [slotOf, n])

  useEffect(() => {
    const box = boxRef.current!
    const observer = new ResizeObserver(() => setWidth(Math.max(100, box.clientWidth - STRIP_WIDTH - 4)))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // One pixel per moment and per digit; CSS scales it up, unsmoothed.
  useEffect(() => {
    const ctx = imageRef.current!.getContext('2d')!
    const img = ctx.createImageData(length, n)
    for (let row = 0; row < n; row++) {
      const p = participantAt[row]
      for (let t = 0; t < length; t++) {
        const v = Math.round(traces.ink[p * length + t] * 255)
        img.data.set([v, v, v, 255], (row * length + t) * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
    const strip = stripRef.current!.getContext('2d')!
    for (let row = 0; row < n; row++) {
      strip.fillStyle = rgbCss(colors[groupOf[participantAt[row]]])
      strip.fillRect(0, row, 1, 1)
    }
  }, [traces, participantAt, groupOf, colors, n, length])

  // The playhead, the trail behind it, group boundaries and the followed/hovered rows.
  useEffect(() => {
    const canvas = overlayRef.current!
    const draw = () => {
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const x = (m: number) => ((m + 0.5) / length) * width
      const head = x(playhead.moment)
      const from = playhead.moment - trailPixels
      const tail = x(Math.max(0, from))
      const accent = getComputedStyle(canvas).color
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.18
      ctx.fillRect(tail, 0, head - tail, height)
      // Looping, a trail reaching back past the start carries on from the end.
      if (playhead.loop && from < 0) {
        const wrapped = x(Math.max(playhead.moment, from + length - 1))
        ctx.fillRect(wrapped, 0, width - wrapped, height)
      }
      ctx.globalAlpha = 1
      ctx.fillRect(head - 1, 0, 2, height)
      if (grouped) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
        for (let row = 1; row < n; row++)
          if (groupOf[participantAt[row]] !== groupOf[participantAt[row - 1]]) ctx.fillRect(0, row * rowHeight, width, 1)
      }
      for (const [p, w] of [[hover, 1], [focus, 2]] as const) {
        if (p === null || p >= n) continue
        ctx.strokeStyle = accent
        ctx.lineWidth = w
        ctx.strokeRect(w / 2, slotOf[p] * rowHeight - w / 2, width - w, rowHeight + w)
      }
    }
    draw()
    return playhead.onFrame(draw)
  }, [playhead, playhead.loop, width, height, length, n, trailPixels, grouped, groupOf, participantAt, slotOf, rowHeight, focus, hover, dpr])

  const participantFrom = (e: React.MouseEvent<HTMLDivElement>) => {
    const row = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / rowHeight)
    return row >= 0 && row < n ? participantAt[row] : null
  }

  return (
    <div className="matrix" ref={boxRef}>
      <canvas ref={stripRef} className="matrix-strip" width={1} height={Math.max(n, 1)} style={{ width: STRIP_WIDTH, height }} />
      <div
        className="matrix-image"
        style={{ width, height }}
        onPointerMove={(e) => onHover(participantFrom(e))}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => {
          const p = participantFrom(e)
          if (p !== null) onFocus(p)
        }}
      >
        <canvas ref={imageRef} width={Math.max(length, 1)} height={Math.max(n, 1)} style={{ width, height }} />
        <canvas ref={overlayRef} className="matrix-overlay" width={width * dpr} height={height * dpr} style={{ width, height }} />
      </div>
    </div>
  )
}
