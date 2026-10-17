import { useEffect, useRef } from 'react'

/** How long the focused digit must stay put before a sweep starts. */
export const SWEEP_DWELL_MS = 350
/** Time for the sweep head to travel all 784 pixels. */
export const SWEEP_MS = 1100
export const N_PIXELS = 784

/** A pixel-by-pixel walk through one digit, shared by every view so they stay in step. */
export interface Sweep {
  row: number
  start: number
}

export interface SweepFrame {
  row: number
  /** Fractional index of the head pixel; runs past N_PIXELS so tails can drain off the end. */
  pixel: number
}

/**
 * Calls `draw` every animation frame while `sweep` runs (until the head is `tail`
 * pixels past the end), then once with null so the view can clear its overlay.
 */
export function useSweepFrames(sweep: Sweep | null, tail: number, draw: (frame: SweepFrame | null) => void) {
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  })

  useEffect(() => {
    if (!sweep) {
      drawRef.current(null)
      return
    }
    let frame = 0
    const tick = (now: number) => {
      const pixel = ((now - sweep.start) / SWEEP_MS) * N_PIXELS
      if (pixel >= N_PIXELS + tail) {
        drawRef.current(null)
        return
      }
      drawRef.current({ row: sweep.row, pixel })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      drawRef.current(null)
    }
  }, [sweep, tail])
}
