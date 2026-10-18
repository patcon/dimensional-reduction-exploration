import { useEffect, useState } from 'react'
import type { MnistData } from '../useMnistData'
import type { PixelShuffle } from '../pixelOrder'
import type { Sweep } from '../sweep'
import { DigitStack } from './DigitStack'
import { DigitPreview } from './DigitPreview'

const FLATTEN_MS = 450

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

  if (mode === 'single') {
    return (
      <DigitPreview
        data={data}
        row={row}
        resolution={resolution}
        pixelOrder={pixelOrder}
        pinned={pinned}
        sweep={sweep}
        onUnpin={onUnpin}
        onClose={() => switchTo(false)}
      />
    )
  }
  return (
    <DigitStack
      data={data}
      row={row}
      resolution={resolution}
      shuffle={shuffle}
      pinned={pinned}
      flatten={flatten}
      onResolution={onResolution}
      onExpand={(side) => {
        onResolution(side)
        switchTo(true)
      }}
      onUnpin={onUnpin}
    />
  )
}
