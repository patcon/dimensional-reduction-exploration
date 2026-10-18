import { useEffect, useRef } from 'react'

/** How long the focused digit must stay put before a sweep starts. */
export const SWEEP_DWELL_MS = 350
/** Time for the sweep head to travel all 784 pixels. */
export const SWEEP_MS = 1400
export const N_PIXELS = 784
/** The head arrives fast and decelerates to this fraction of its starting speed. */
const END_SPEED_RATIO = 1 / 6

/**
 * Head position (in pixels) after `elapsed` ms. Speed falls linearly from fast to
 * END_SPEED_RATIO of that by the last pixel, then holds there so tails drain off the end.
 */
function headPixel(elapsed: number) {
  const r = END_SPEED_RATIO
  const s = elapsed / SWEEP_MS
  const norm = (1 + r) / 2 // distance covered by s = 1, before normalising
  const progress = s <= 1 ? (s - ((1 - r) / 2) * s * s) / norm : 1 + (r / norm) * (s - 1)
  return progress * N_PIXELS
}

/** A pixel-by-pixel walk through one digit, shared by every view so they stay in step. */
export interface Sweep {
  row: number
  start: number
}

export interface SweepFrame {
  row: number
  /** Fractional index of the head pixel; runs past N_PIXELS so tails can drain off the end. */
  pixel: number
  /** Where the head was `tailMs` ago: the tail is longer while fast, shorter as it slows. */
  tailPixel: number
}

/**
 * Calls `draw` every animation frame while `sweep` runs (until its tail, `tailMs`
 * behind the head, has drained off the end), then once with null so the view can clear.
 */
export function useSweepFrames(sweep: Sweep | null, tailMs: number, draw: (frame: SweepFrame | null) => void) {
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
      const elapsed = now - sweep.start
      const tailPixel = Math.max(0, headPixel(elapsed - tailMs))
      if (tailPixel >= N_PIXELS) {
        drawRef.current(null)
        return
      }
      drawRef.current({ row: sweep.row, pixel: headPixel(elapsed), tailPixel })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      drawRef.current(null)
    }
  }, [sweep, tailMs])
}
