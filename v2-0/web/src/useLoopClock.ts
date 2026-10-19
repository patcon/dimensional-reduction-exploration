import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Engine } from './engine'
import { PAIR_TYPES, type Weights } from './types'

/**
 * idle: waiting at iteration 0 for the first non-zero force.
 * running: stepping at `rate` iterations per second. Keeps going even if every force returns to 0.
 * paused: stopped by hand; resume() picks up where it left off. Resetting keeps it paused.
 * ended: reached the end of the schedule with looping off. Reset starts over (from idle);
 *   resume() carries on, wrapping to iteration 0 with the layout as it is.
 */
export type ClockStatus = 'idle' | 'running' | 'paused' | 'ended'

/** Never step more than this per frame, so a backgrounded tab doesn't come back to a burst. */
const MAX_STEPS_PER_FRAME = 4
/** Stop stepping for this frame once it has taken this long, so big datasets don't stall drawing. */
const STEP_BUDGET_MS = 25

/** How often the layout is redrawn, whatever the step rate. */
const DRAW_FPS = 30

const anyForce = (w: Weights) => PAIR_TYPES.some((type) => w[type] !== 0)

/**
 * A playhead looping over PaCMAP's schedule, stepping the engine once per tick with whatever
 * weights `getWeights` returns at that moment (read fresh every tick, so it can follow live input).
 *
 * With `loop` on, the playhead wraps to 0 after `length` iterations but the layout and optimiser
 * carry on; only reset() returns them to the initial layout. With it off, the clock ends there.
 *
 * `display` is the layout to draw, refreshed at up to DRAW_FPS. With `interpolate` on, it
 * glides from the layout before the latest step to the one after it, timed to arrive as the
 * next step is due, so slow rates move smoothly (one step behind) instead of jumping.
 */
export function useLoopClock(
  engine: Engine,
  length: number,
  getWeights: (playhead: number) => Weights,
  loop: boolean,
  /** Called after each step with the playhead it was taken at and the forces it used. */
  onStep?: (playhead: number, weights: Weights) => void,
) {
  const [status, setStatus] = useState<ClockStatus>('idle')
  const [rate, setRate] = useState(10)
  const [playhead, setPlayhead] = useState(0)
  const [interpolate, setInterpolate] = useState(true)
  /** Bumped whenever `display` changes, to redraw it. */
  const [version, setVersion] = useState(0)

  /** The layout before the latest step, and the one to draw. */
  const prevY = useMemo(() => new Float32Array(engine.Y), [engine])
  const display = useMemo(() => new Float32Array(engine.Y), [engine])
  /** Fractional steps owed, so slow rates step on time rather than once per frame; also how far
   * `display` has glided towards the latest step. */
  const owedRef = useRef(0)

  const getWeightsRef = useRef(getWeights)
  const onStepRef = useRef(onStep)
  const loopRef = useRef(loop)
  useEffect(() => {
    getWeightsRef.current = getWeights
    onStepRef.current = onStep
    loopRef.current = loop
  })
  const statusRef = useRef(status)
  const rateRef = useRef(rate)
  const interpolateRef = useRef(interpolate)
  const playheadRef = useRef(0)
  /** Set when `display` must be refreshed even though nothing stepped (reset, toggling interpolation). */
  const dirtyRef = useRef(false)
  useEffect(() => {
    statusRef.current = status
    rateRef.current = rate
    interpolateRef.current = interpolate
    dirtyRef.current = true
  }, [status, rate, interpolate])

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let lastDraw = -Infinity
    /** Whether anything has stepped since `display` was last refreshed. */
    let stale = false
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (statusRef.current === 'idle' && anyForce(getWeightsRef.current(playheadRef.current))) {
        statusRef.current = 'running'
        setStatus('running')
        // Step straight away, so the first touch moves something.
        owedRef.current = 1
      }
      if (statusRef.current === 'running') {
        owedRef.current = Math.min(owedRef.current + dt * rateRef.current, MAX_STEPS_PER_FRAME)
        let stepped = false
        while (owedRef.current >= 1) {
          // Carrying on after the end: start the next loop.
          if (playheadRef.current === length) playheadRef.current = 0
          owedRef.current -= 1
          prevY.set(engine.Y)
          const w = getWeightsRef.current(playheadRef.current)
          engine.step(w)
          onStepRef.current?.(playheadRef.current, w)
          playheadRef.current = (playheadRef.current + 1) % length
          stepped = true
          // Out of time: drop what's owed beyond the step in progress, so the rate slows instead of lagging.
          if (performance.now() - now > STEP_BUDGET_MS) owedRef.current = Math.min(owedRef.current, 0.999)
          if (playheadRef.current === 0 && !loopRef.current) {
            // Stop at the end, showing iteration `length`, with the final layout drawn.
            playheadRef.current = length
            owedRef.current = 0
            prevY.set(engine.Y)
            statusRef.current = 'ended'
            setStatus('ended')
            break
          }
        }
        if (stepped) {
          setPlayhead(playheadRef.current)
          stale = true
        }
      }
      // Paused keeps owedRef as it was, so the glide resumes from the same point.
      else if (statusRef.current === 'idle') owedRef.current = 0

      const gliding = interpolateRef.current && statusRef.current === 'running'
      if ((stale || gliding || dirtyRef.current) && now - lastDraw >= 1000 / DRAW_FPS - 1) {
        if (interpolateRef.current) {
          const a = Math.min(1, owedRef.current)
          for (let k = 0; k < display.length; k++) display[k] = prevY[k] + (engine.Y[k] - prevY[k]) * a
        } else display.set(engine.Y)
        lastDraw = now
        stale = false
        dirtyRef.current = false
        setVersion((v) => v + 1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine, length, prevY, display])

  const pause = useCallback(() => setStatus((s) => (s === 'running' ? 'paused' : s)), [])
  const resume = useCallback(() => setStatus((s) => (s === 'paused' || s === 'ended' ? 'running' : s)), [])
  const reset = useCallback(() => {
    engine.reset()
    prevY.set(engine.Y)
    owedRef.current = 0
    playheadRef.current = 0
    dirtyRef.current = true
    // A paused loop stays paused (resume() restarts it); otherwise wait for the next force.
    if (statusRef.current !== 'paused') {
      statusRef.current = 'idle'
      setStatus('idle')
    }
    setPlayhead(0)
  }, [engine, prevY])

  return {
    status, rate, setRate, interpolate, setInterpolate, playhead, steps: engine.steps,
    display, version, pause, resume, reset,
  }
}
