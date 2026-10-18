import { useCallback, useEffect, useRef, useState } from 'react'
import type { Engine } from './engine'
import { PAIR_TYPES, type Weights } from './types'

/**
 * idle: waiting at iteration 0 for the first non-zero force.
 * running: stepping at `rate` iterations per second. Keeps going even if every force returns to 0.
 * paused: stopped by hand; resume() picks up where it left off.
 */
export type ClockStatus = 'idle' | 'running' | 'paused'

/** Never step more than this per frame, so a backgrounded tab doesn't come back to a burst. */
const MAX_STEPS_PER_FRAME = 4

const anyForce = (w: Weights) => PAIR_TYPES.some((type) => w[type] !== 0)

/**
 * A playhead looping over PaCMAP's schedule, stepping the engine once per tick with whatever
 * weights `getWeights` returns at that moment (read fresh every tick, so it can follow live input).
 *
 * The playhead wraps to 0 after `length` iterations but the layout and optimiser carry on;
 * only reset() returns them to the initial layout.
 */
export function useLoopClock(engine: Engine, length: number, getWeights: (playhead: number) => Weights) {
  const [status, setStatus] = useState<ClockStatus>('idle')
  const [rate, setRate] = useState(10)
  const [playhead, setPlayhead] = useState(0)
  /** Bumped after every step, to redraw anything that reads the engine's layout. */
  const [version, setVersion] = useState(0)

  const getWeightsRef = useRef(getWeights)
  useEffect(() => {
    getWeightsRef.current = getWeights
  })
  const statusRef = useRef(status)
  const rateRef = useRef(rate)
  const playheadRef = useRef(0)
  useEffect(() => {
    statusRef.current = status
    rateRef.current = rate
  }, [status, rate])

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    /** Fractional steps owed, so slow rates step on time rather than once per frame. */
    let owed = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (statusRef.current === 'idle' && anyForce(getWeightsRef.current(playheadRef.current))) {
        statusRef.current = 'running'
        setStatus('running')
        // Step straight away, so the first touch moves something.
        owed = 1
      }
      if (statusRef.current === 'running') {
        owed = Math.min(owed + dt * rateRef.current, MAX_STEPS_PER_FRAME)
        let stepped = false
        while (owed >= 1) {
          owed -= 1
          engine.step(getWeightsRef.current(playheadRef.current))
          playheadRef.current = (playheadRef.current + 1) % length
          stepped = true
        }
        if (stepped) {
          setPlayhead(playheadRef.current)
          setVersion((v) => v + 1)
        }
      } else owed = 0
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine, length])

  const pause = useCallback(() => setStatus((s) => (s === 'running' ? 'paused' : s)), [])
  const resume = useCallback(() => setStatus((s) => (s === 'paused' ? 'running' : s)), [])
  const reset = useCallback(() => {
    engine.reset()
    playheadRef.current = 0
    statusRef.current = 'idle'
    setStatus('idle')
    setPlayhead(0)
    setVersion((v) => v + 1)
  }, [engine])

  return { status, rate, setRate, playhead, steps: engine.steps, version, pause, resume, reset }
}
