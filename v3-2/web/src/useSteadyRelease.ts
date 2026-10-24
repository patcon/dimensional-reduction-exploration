import type * as React from 'react'
import { useRef } from 'react'

/** How far back before a release to look for where a finger came to rest. */
const SETTLE_MS = 120
/** The most a finger can drift in that time, in CSS pixels, and still count as at rest: lifting it, not dragging. */
const SETTLE_PX = 6

/**
 * Keeps a slider where a finger rested on it, not where lifting the finger nudged it. A finger's contact point
 * shifts as it lifts, which reaches the slider as one last move just before release. Feed in pointer events and
 * each value the slider takes; on release, `release` gives the value it had just before the lift, if the finger
 * was all but still then (it moved no more than a few pixels), or null to leave it be. Mouse drags are left be.
 */
export function useSteadyRelease<T>() {
  const moves = useRef<{ t: number; x: number; y: number }[]>([])
  const values = useRef<{ t: number; value: T }[]>([])
  const active = useRef(false)
  const downAt = useRef(0)

  const forget = (before: number) => {
    // Kept a little past the window, so the value in effect at its start is still there.
    while (moves.current.length > 1 && moves.current[1].t < before) moves.current.shift()
    while (values.current.length > 1 && values.current[1].t < before) values.current.shift()
  }

  return {
    onPointerDown(e: React.PointerEvent, value: T) {
      active.current = e.pointerType !== 'mouse'
      downAt.current = e.timeStamp
      moves.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
      values.current = [{ t: e.timeStamp, value }]
    },
    onPointerMove(e: React.PointerEvent) {
      if (!active.current) return
      moves.current.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
      forget(e.timeStamp - SETTLE_MS)
    },
    /** Notes a value the slider took while dragging. */
    noteValue(value: T) {
      if (active.current) values.current.push({ t: performance.now(), value })
    },
    /** The value to put back on release, or null. */
    release(e: React.PointerEvent): T | null {
      if (!active.current) return null
      active.current = false
      const since = e.timeStamp - SETTLE_MS
      // A tap, or too short a drag to have come to rest: nothing to go back to but the value before it.
      if (since <= downAt.current) return null
      const recent = moves.current.filter((m) => m.t >= since)
      const last = moves.current[moves.current.length - 1]
      if (recent.some((m) => Math.hypot(m.x - last.x, m.y - last.y) > SETTLE_PX)) return null
      // The value in effect when the finger came to rest: the last one taken before the window began.
      const settled = [...values.current].reverse().find((v) => v.t < since) ?? values.current[0]
      const current = values.current[values.current.length - 1]
      return settled && settled !== current ? settled.value : null
    },
  }
}
