import { useEffect, useState } from 'react'
import type { MnistData } from '../useMnistData'
import type { PixelShuffle } from '../pixelOrder'
import type { Sweep } from '../sweep'
import { DigitStack } from './DigitStack'
import { stackSize } from './digitLayout'
import { DigitPreview } from './DigitPreview'

const FLATTEN_MS = 450
const TOGGLE_SIZE = 18

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

type Mode = 'stack' | 'expanding' | 'single' | 'collapsing'

/**
 * The sidebar's digit: every resolution as an isometric stack, or one resolution flat (with the
 * pixel sweep). Expanding a layer animates it out of the stack into the flat view, and back.
 * Stays mounted while focus moves between digits, so the chosen view sticks.
 */
export function DigitView({
  data,
  row,
  resolution,
  shuffle,
  pixelOrder,
  pinned,
  sweep,
  onResolution,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  resolution: number
  shuffle: PixelShuffle
  pixelOrder: number[] | null
  pinned: boolean
  sweep: Sweep | null
  onResolution: (resolution: number) => void
  onUnpin: () => void
}) {
  const [mode, setMode] = useState<Mode>('stack')
  const [flatten, setFlatten] = useState(0)

  useEffect(() => {
    if (mode !== 'expanding' && mode !== 'collapsing') return
    const expanding = mode === 'expanding'
    const settle = () => setMode(expanding ? 'single' : 'stack')
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FLATTEN_MS)
      setFlatten(easeInOut(expanding ? t : 1 - t))
      if (t < 1) frame = requestAnimationFrame(step)
      else settle()
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [mode])

  // Animate between the views, or jump straight there when motion is reduced.
  const switchTo = (expand: boolean) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFlatten(expand ? 1 : 0)
      setMode(expand ? 'single' : 'stack')
    } else {
      setMode(expand ? 'expanding' : 'collapsing')
    }
  }

  const footprint = stackSize(data.meta.resolutions.length)
  const expanded = mode === 'single' || mode === 'expanding'
  const toggle = (
    <button
      className="view-toggle"
      style={{ left: footprint.width - TOGGLE_SIZE, top: footprint.height - TOGGLE_SIZE }}
      onClick={() => switchTo(!expanded)}
      title={expanded ? 'Back to the stack' : 'Expand the selected layer'}
      aria-label={expanded ? 'Back to the stack' : 'Expand the selected layer'}
    >
      <ExpandCloseIcon t={flatten} />
    </button>
  )

  return (
    <div className="digit-view">
      {mode === 'single' ? (
        <DigitPreview
          data={data}
          row={row}
          resolution={resolution}
          pixelOrder={pixelOrder}
          pinned={pinned}
          sweep={sweep}
          onUnpin={onUnpin}
          footprint={footprint}
        />
      ) : (
        <DigitStack
          data={data}
          row={row}
          resolution={resolution}
          shuffle={shuffle}
          pinned={pinned}
          sweep={sweep}
          flatten={flatten}
          onResolution={onResolution}
          onUnpin={onUnpin}
        />
      )}
      {toggle}
    </div>
  )
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Expand (two arrows out to opposite corners) at t = 0, morphing into × at t = 1: the arrow
 * shafts swing into the cross's two strokes while the arrowheads fade away.
 */
function ExpandCloseIcon({ t }: { t: number }) {
  const line = (from: number[], to: number[]) => {
    const [x1, y1, x2, y2] = from.map((v, i) => lerp(v, to[i], t))
    return <line x1={x1} y1={y1} x2={x2} y2={y2} />
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {line([7, 5, 11, 1], [2, 10, 10, 2])}
      {line([5, 7, 1, 11], [2, 2, 10, 10])}
      <path d="M7 1h4v4M5 11H1V7" opacity={1 - t} />
    </svg>
  )
}
