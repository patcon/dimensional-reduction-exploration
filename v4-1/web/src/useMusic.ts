import { useEffect, useMemo, useRef } from 'react'
import { unlockOnInteraction } from './audio'
import { MusicWalk } from './music'
import type { Playhead } from './playhead'
import { windowFeatures } from './selection'
import type { Traces } from './signal'
import type { MusicSettings, WindowMusic } from './windowMusic'
import type { WindowRequest } from './windowMusic.worker'

/**
 * The window's music, worked out in a worker. One request at a time: asked again while it's busy, the newest waits
 * (replacing any older still waiting), so it never falls behind the playhead.
 */
class WindowAnalyser {
  private worker = new Worker(new URL('./windowMusic.worker.ts', import.meta.url), { type: 'module' })
  private busy: { rows: number[]; onResult: (w: WindowMusic) => void } | null = null
  private waiting: { request: Omit<WindowRequest, 'id'>; onResult: (w: WindowMusic) => void } | null = null
  private id = 0

  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: number; result: WindowMusic }>) => {
      const done = this.busy
      this.busy = null
      // Its rows as asked for, the same array, so the walk can tell when they've changed.
      if (done) done.onResult({ ...e.data.result, rows: done.rows })
      const next = this.waiting
      this.waiting = null
      if (next) this.request(next.request, next.onResult)
    }
  }

  request(request: Omit<WindowRequest, 'id'>, onResult: (w: WindowMusic) => void) {
    if (this.busy) {
      this.waiting = { request, onResult }
      return
    }
    this.busy = { rows: request.rows, onResult }
    this.worker.postMessage({ ...request, id: ++this.id } satisfies WindowRequest, [request.features.buffer])
  }

  close() {
    this.worker.terminate()
  }
}

/**
 * While `on`, the walk's music: the window's broad and small groups worked out again `clusterRate` times a second as
 * the playhead moves (or, pinned, over the pinned window; participants drawing, even while it holds still), and the
 * walker stepping through them, playing or paused. Following a digit moves the walker to it.
 */
export function useMusic({ on, settings, seed, playhead, traces, rows, windowPixels, clusterRate, drawing, slotOf, followed }: {
  on: boolean
  settings: MusicSettings
  seed: number
  playhead: Playhead
  traces: Traces
  /** The visualiser's rows, digits and participants, as `traces` reads them. */
  rows: number[]
  windowPixels: number
  clusterRate: number
  /** Whether participants are drawing, so the window changes even while it holds still. */
  drawing: boolean
  /** Chords' positions, to pan each digit's notes by. */
  slotOf: Int32Array
  followed: number | null
}) {
  const walk = useMemo(() => new MusicWalk(), [])
  const latest = useRef({ settings, slotOf })
  useEffect(() => {
    latest.current = { settings, slotOf }
  })

  useEffect(() => (on ? unlockOnInteraction() : undefined), [on])

  const analyser = useRef<WindowAnalyser | null>(null)
  useEffect(() => {
    if (!on) return
    const a = new WindowAnalyser()
    analyser.current = a
    return () => {
      a.close()
      analyser.current = null
    }
  }, [on])

  const pin = playhead.pin
  const { neighbours, minClusterSize, minSamples, allowSingle, fineResolution } = settings
  useEffect(() => {
    if (!on) return
    const analyse = (moment: number, span: number, wrap: boolean) => {
      const { features, dim } = windowFeatures(traces, moment, span, wrap)
      const current = latest.current.settings
      analyser.current?.request({ rows, features, dim, settings: current, seed }, (w) => walk.setWindow(w, latest.current.settings))
    }
    if (pin) {
      const runPinned = () => analyse(pin.to, pin.to - pin.from, false)
      runPinned()
      if (!drawing) return
      const id = setInterval(runPinned, 1000 / clusterRate)
      return () => clearInterval(id)
    }
    let lastMoment = NaN
    const run = () => {
      if (playhead.moment === lastMoment && !drawing) return
      lastMoment = playhead.moment
      analyse(playhead.moment, windowPixels, playhead.wraps)
    }
    run()
    const id = setInterval(run, 1000 / clusterRate)
    return () => clearInterval(id)
    // The settings are read when it runs, but only those that change the groups run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, walk, traces, rows, playhead, pin, windowPixels, clusterRate, drawing, seed, neighbours, minClusterSize, minSamples, allowSingle, fineResolution])

  useEffect(() => {
    if (!on) return
    let id: ReturnType<typeof setTimeout>
    const tick = () => {
      const { settings, slotOf } = latest.current
      const n = slotOf.length
      // Panned by the chord's position, left to right.
      const pan = (i: number) => (n > 1 ? (slotOf[i] / (n - 1)) * 1.4 - 0.7 : 0)
      id = setTimeout(tick, walk.step(settings, pan))
    }
    tick()
    return () => {
      clearTimeout(id)
      walk.stop()
    }
  }, [on, walk, playhead])

  useEffect(() => {
    if (on && followed !== null) walk.jumpTo(followed)
  }, [on, walk, followed])

  return walk
}
