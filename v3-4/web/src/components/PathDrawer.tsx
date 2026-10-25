import { useEffect, useState } from 'react'
import { accentOf } from '../digitImage'
import { N_PIXELS, SIDE, strokePixels } from '../signal'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

/**
 * A digit, as large as the screen allows, to draw a path across: the pixels it passes through, in the order drawn,
 * become the reading order. Lifting the pen hands the path to `onPath`, if it's more than a single pixel.
 */
export function PathDrawer({
  open,
  onOpenChange,
  pixels,
  poolRow,
  onPath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pixels: Uint8Array
  /** The digit to trace over, or null for a blank square. */
  poolRow: number | null
  onPath: (path: Int32Array) => void
}) {
  // In state, as the dialog mounts it only once open: drawn as soon as it's there, before any stroke.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  /** The stroke so far, as [column, row] in pixels (fractional), or null while the pen is up. */
  const [points, setPoints] = useState<[number, number][] | null>(null)

  // The digit, with the pixels the stroke has passed through tinted.
  useEffect(() => {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    const accent = accentOf(canvas)
    const onPath = new Uint8Array(N_PIXELS)
    if (points) for (const p of strokePixels(points)) onPath[p] = 1
    for (let p = 0; p < N_PIXELS; p++) {
      const v = poolRow === null ? 0 : pixels[poolRow * N_PIXELS + p]
      const rgb = onPath[p] ? accent.map((c) => v * 0.4 + c * 0.6) : [v, v, v]
      img.data.set([rgb[0], rgb[1], rgb[2], 255], p * 4)
    }
    ctx.putImageData(img, 0, 0)
  }, [canvas, points, pixels, poolRow])

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = e.currentTarget
    return [(e.nativeEvent.offsetX / canvas.clientWidth) * SIDE, (e.nativeEvent.offsetY / canvas.clientHeight) * SIDE]
  }
  const finish = () => {
    if (!points) return
    const path = strokePixels(points)
    setPoints(null)
    if (path.length > 1) onPath(path)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setPoints(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="w-auto max-w-none gap-3 p-4 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Draw a reading path</DialogTitle>
          <DialogDescription>Trace across the digit; playback reads the pixels you pass through, in order, looping round.</DialogDescription>
        </DialogHeader>
        <div className="relative size-[min(calc(100vw_-_4rem),calc(100dvh_-_9rem))]">
          <canvas
            ref={setCanvas}
            className="digit-image size-full rounded-sm"
            width={SIDE}
            height={SIDE}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setPoints([pointAt(e)])
            }}
            onPointerMove={(e) => {
              if (points) setPoints([...points, pointAt(e)])
            }}
            onPointerUp={finish}
            onPointerCancel={() => setPoints(null)}
          />
          {/* The stroke itself, over the pixels it picks out. */}
          {points && (
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${SIDE} ${SIDE}`} aria-hidden>
              <polyline
                points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="white"
                strokeOpacity={0.8}
                strokeWidth={0.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
