import { useCallback, useEffect, useMemo, useState } from 'react'
import { ForceSliders } from './components/ForceSliders'
import { OptimiserPanel } from './components/OptimiserPanel'
import { Scatter } from './components/Scatter'
import { ScheduleGraph } from './components/ScheduleGraph'
import { Transport } from './components/Transport'
import { Engine } from './engine'
import { DEFAULT_SCALE, toMultiplier, toU, type ForceScale } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DEFAULT_OPTIMISER, OptimiserBank, type OptimiserSettings } from './optimisers'
import { DIGIT_COLORS } from './palette'
import { pacmapWeights, phaseOf, scheduleLength, Trail } from './schedule'
import { PAIR_TYPES, type PairType, type Weights } from './types'
import { useData, type PacmapData } from './useData'
import { useLoopClock } from './useLoopClock'

/** How far a control must move before the kicking Adam forgets its state. */
const KICK_THRESHOLD = 0.02

const mapValues = <A, B>(r: Record<PairType, A>, f: (a: A) => B): Record<PairType, B> =>
  ({ nb: f(r.nb), mn: f(r.mn), fp: f(r.fp) })

function Playground({ data }: { data: PacmapData }) {
  const { meta } = data
  const optimisers = useMemo(() => new OptimiserBank(data.init.length, meta.adam), [data, meta.adam])
  const engine = useMemo(
    () => new Engine(data.pairs, data.init, optimisers.configure(DEFAULT_OPTIMISER)),
    [data, optimisers],
  )
  const length = scheduleLength(meta.schedule)

  const [optimiser, setOptimiser] = useState<OptimiserSettings>(DEFAULT_OPTIMISER)
  useEffect(() => {
    engine.setSpeed(optimiser.speed)
    const next = optimisers.configure(optimiser)
    if (engine.optimiser !== next) engine.setOptimiser(next)
  }, [optimiser, optimisers, engine])

  const store = useMemo(() => new InputStore(), [])
  const controls = useControlValues(store)
  const [scale, setScale] = useState<ForceScale>(DEFAULT_SCALE)
  const [spring, setSpring] = useState<Record<PairType, boolean>>({ nb: false, mn: false, fp: false })
  const [autopilot, setAutopilot] = useState(false)

  const getWeights = useCallback(
    (playhead: number): Weights =>
      autopilot ? pacmapWeights(playhead, meta.schedule) : mapValues(store.get(), (u) => toMultiplier(u, scale)),
    [autopilot, meta.schedule, store, scale],
  )
  // What's been played this loop, for the schedule graph; cleared as the loop wraps.
  const trail = useMemo(() => new Trail(length), [length])
  const onStep = useCallback((playhead: number, w: Weights) => trail.record(playhead, w), [trail])
  const clock = useLoopClock(engine, length, getWeights, onStep)
  const reset = () => {
    trail.clear()
    clock.reset()
  }

  // Tell the optimiser when a control has moved far enough (only the kicking Adam listens).
  useEffect(() => {
    let last = store.get()
    return store.subscribe(() => {
      const now = store.get()
      if (PAIR_TYPES.some((type) => Math.abs(now[type] - last[type]) >= KICK_THRESHOLD)) {
        last = now
        engine.optimiser.onControlChange?.()
      }
    })
  }, [store, engine])

  // Under autopilot the sliders follow PaCMAP's forces; grabbing one takes over from exactly there.
  const shown: ControlValues = autopilot
    ? mapValues(pacmapWeights(clock.playhead, meta.schedule), (w) => toU(w, scale))
    : controls
  const liveWeights = getWeights(clock.playhead)
  const takeOver = () => {
    if (!autopilot) return
    store.setAll(shown)
    setAutopilot(false)
  }

  return (
    <div className="playground">
      <Transport
        status={clock.status}
        playhead={clock.playhead}
        length={length}
        phase={phaseOf(clock.playhead, meta.schedule)}
        steps={clock.steps}
        rate={clock.rate}
        onRate={clock.setRate}
        onPause={clock.pause}
        onResume={clock.resume}
        onReset={reset}
        autopilot={autopilot}
        onAutopilot={setAutopilot}
      />
      <div className="stage">
        <Scatter Y={engine.Y} labels={meta.labels} version={clock.version} />
        <ForceSliders
          values={shown}
          scale={scale}
          onScale={setScale}
          spring={spring}
          onSpring={(type, s) => setSpring((prev) => ({ ...prev, [type]: s }))}
          onGrab={takeOver}
          onChange={(type, u) => store.set(type, u)}
        />
      </div>
      <ScheduleGraph
        schedule={meta.schedule}
        scale={scale}
        playhead={clock.playhead}
        current={liveWeights}
        trail={trail}
      />
      <OptimiserPanel settings={optimiser} onChange={setOptimiser} />
      <ul className="legend">
        {DIGIT_COLORS.map((color, digit) => (
          <li key={digit}>
            <span className="swatch" style={{ background: color }} /> {digit}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function App() {
  const { data, error } = useData()

  return (
    <main>
      <header className="page-header">
        <h1>Playable PaCMAP</h1>
        <p>
          PaCMAP's optimisation, live in the browser on {data ? data.meta.nSamples.toLocaleString() : '20,000'} MNIST
          digits. The neighbour, mid-near and far pairs are fixed; the forces on them are yours to play. A loop runs
          over PaCMAP's 450-iteration schedule; autopilot plays PaCMAP's own forces along it.
        </p>
      </header>
      {error ? <p className="status">{error}</p> : data ? <Playground data={data} /> : <p className="status">Loading…</p>}
    </main>
  )
}
