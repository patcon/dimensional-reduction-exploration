import { useEffect, useMemo, useRef, useState } from 'react'
import { DIGIT_COLORS } from '../palette'

interface Props {
  /** Layout, n x 2 row-major. Mutated in place by the engine, so redraws are driven by `version`. */
  Y: Float32Array
  labels: number[]
  /** Bump to redraw after Y changes. */
  version: number
}

const PAD = 12
/** Point size in CSS pixels. */
const DOT = 2

/** DIGIT_COLORS as little-endian RGBA words for a Uint32Array view of ImageData. */
function packedColors() {
  return DIGIT_COLORS.map((hex) => {
    const v = parseInt(hex.slice(1), 16)
    return ((0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | (v >> 16)) >>> 0
  })
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

/** The page background as a packed RGBA word, so the canvas follows light/dark mode. */
function packedBackground(el: Element) {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.fillStyle = getComputedStyle(el).getPropertyValue('--bg').trim() || '#ffffff'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/**
 * Every point as a small square, coloured by digit and refitted to the canvas on every draw
 * (the layout grows ~1000x over a run). Points are drawn straight into ImageData.
 */
export function Scatter({ Y, labels, version }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const colors = useMemo(() => packedColors(), [])
  const order = useMemo(() => shuffledOrder(labels.length), [labels])

  useEffect(() => {
    const el = wrapRef.current!
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let k = 0; k < Y.length; k += 2) {
      minX = Math.min(minX, Y[k])
      maxX = Math.max(maxX, Y[k])
      minY = Math.min(minY, Y[k + 1])
      maxY = Math.max(maxY, Y[k + 1])
    }
    // One scale for both axes, so the layout's shape isn't distorted.
    const pad = PAD * dpr
    const dot = Math.max(1, Math.round(DOT * dpr))
    const scale = Math.min((w - 2 * pad - dot) / (maxX - minX || 1), (h - 2 * pad - dot) / (maxY - minY || 1))
    const offX = (w - (maxX - minX) * scale - dot) / 2
    const offY = (h - (maxY - minY) * scale - dot) / 2

    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(w, h)
    const px = new Uint32Array(image.data.buffer)
    px.fill(packedBackground(canvas))
    for (const i of order) {
      const x0 = Math.round(offX + (Y[2 * i] - minX) * scale)
      // Flip y so the layout reads like a conventional plot.
      const y0 = Math.round(h - offY - (Y[2 * i + 1] - minY) * scale - dot)
      const c = colors[labels[i]]
      for (let dy = 0; dy < dot; dy++) px.fill(c, (y0 + dy) * w + x0, (y0 + dy) * w + x0 + dot)
    }
    ctx.putImageData(image, 0, 0)
  }, [Y, labels, order, colors, size, version])

  return (
    <div ref={wrapRef} className="scatter">
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
    </div>
  )
}
