import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ForceSliders } from './components/ForceSliders'
import { MidiPanel } from './components/MidiPanel'
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
import { PAIR_TYPES, type Dim, type PairType, type Weights } from './types'
import { useData, type PacmapData, type SampleSize } from './useData'
import { useLoopClock } from './useLoopClock'
import type { Zero } from './midi'
import { useMidi } from './useMidi'

/** How far a control must move before the kicking Adam forgets its state. */
const KICK_THRESHOLD = 0.02

const mapValues = <A, B>(r: Record<PairType, A>, f: (a: A, type: PairType) => B): Record<PairType, B> =>
  ({ nb: f(r.nb, 'nb'), mn: f(r.mn, 'mn'), fp: f(r.fp, 'fp') })

interface PlaygroundProps {
  data: PacmapData
  size: SampleSize
  /** Switching size swaps `data` once it has loaded, starting over on the new digits. */
  onSize: (size: SampleSize) => void
  /** Whether `size` is still loading (`data` is the previous size's until it arrives). */
  loading: boolean
  loadError?: string
}

function Playground({ data, size, onSize, loading, loadError }: PlaygroundProps) {
  const { meta } = data
  const [dim, setDim] = useState<Dim>(3)
  const [autoRotate, setAutoRotate] = useState(true)
  const optimisers = useMemo(() => new OptimiserBank(data.init[dim].length, meta.adam, dim), [data, meta.adam, dim])
  const engine = useMemo(
    () => new Engine(data.pairs, data.init[dim], optimisers.configure(DEFAULT_OPTIMISER), dim),
    [data, optimisers, dim],
  )
  const length = scheduleLength(meta.schedule)

  const [optimiser, setOptimiser] = useState<OptimiserSettings>(DEFAULT_OPTIMISER)
  useEffect(() => {
    engine.setSpeed(optimiser.speed[optimiser.kind])
    const next = optimisers.configure(optimiser)
    if (engine.optimiser !== next) engine.setOptimiser(next)
  }, [optimiser, optimisers, engine])

  const store = useMemo(() => new InputStore(), [])
  const controls = useControlValues(store)
  const [scale, setScale] = useState<ForceScale>(DEFAULT_SCALE)
  const [spring, setSpring] = useState<Record<PairType, boolean>>({ nb: false, mn: false, fp: false })
  const [split, setSplit] = useState<Record<PairType, boolean>>({ nb: true, mn: true, fp: true })
  // Opens on autopilot, paused at the start: press Play to watch PaCMAP's own run.
  const [autopilot, setAutopilot] = useState(true)

  const getWeights = useCallback(
    (playhead: number): Weights =>
      autopilot ? pacmapWeights(playhead, meta.schedule) : mapValues(store.get(), (u) => toMultiplier(u, scale)),
    [autopilot, meta.schedule, store, scale],
  )
  // What's been played this loop, for the schedule graph; cleared as the loop wraps.
  const trail = useMemo(() => new Trail(length), [length])
  const onStep = useCallback((playhead: number, w: Weights) => trail.record(playhead, w), [trail])
  // Autopilot plays PaCMAP's schedule once and stops; manual play loops.
  const clock = useLoopClock(engine, length, getWeights, !autopilot, onStep, true)
  const reset = () => {
    trail.clear()
    clock.reset()
  }
  // A new engine (another dimension or sample size) starts from its own initial layout, so the
  // loop starts over too: in an effect, once the old engine's clock has stopped stepping.
  const lastEngine = useRef(engine)
  const resetClock = clock.reset
  useEffect(() => {
    if (engine === lastEngine.current) return
    lastEngine.current = engine
    trail.clear()
    resetClock()
  }, [engine, trail, resetClock])

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
  // Leaving autopilot, by grabbing a slider or pressing Manual, keeps its forces where they are.
  const takeOver = () => {
    if (!autopilot) return
    store.setAll(shown)
    setAutopilot(false)
  }

  // A bound force behaves like its slider (including taking over from autopilot); speed drives
  // the current optimiser's speed on the speed slider's 0.1x-10x log scale.
  const midi = useMidi((target, u) => {
    if (target === 'speed')
      setOptimiser((o) => ({ ...o, speed: { ...o.speed, [o.kind]: Number((10 ** u).toPrecision(2)) } }))
    else {
      takeOver()
      store.set(target, u)
    }
  })
  // Each slider follows how its MIDI control behaves whenever that changes (a layout applied, a
  // control learnt, its 0 point moved): pitch bend springs back, and a control with 0 at the
  // bottom draws its slider unsplit. In between, spring and split are yours to change.
  const modes = mapValues(midi.zeros, (zero, type) => `${midi.bindings[type]?.kind ?? 'none'}:${zero}`)
  const [seenModes, setSeenModes] = useState<Record<PairType, string> | null>(null)
  const changed = PAIR_TYPES.filter((type) => seenModes?.[type] !== modes[type])
  if (changed.length) {
    setSeenModes(modes)
    const pick = <T,>(prev: Record<PairType, T>, f: (type: PairType) => T) =>
      mapValues(prev, (v, type) => (changed.includes(type) ? f(type) : v))
    setSpring((prev) => pick(prev, (type) => midi.bindings[type]?.kind === 'pitchbend'))
    setSplit((prev) => pick(prev, (type) => midi.zeros[type] === 'centre'))
  }

  // Forces played from a fader (a CC) show where that fader sits, as MIDI Surf shows it.
  const faderZero = Object.fromEntries(
    PAIR_TYPES.map((type) => [type, midi.bindings[type]?.kind === 'cc' ? midi.zeros[type] : null]),
  ) as Record<PairType, Zero | null>

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
        onAutopilot={(on) => (on ? setAutopilot(true) : takeOver())}
        interpolate={clock.interpolate}
        onInterpolate={clock.setInterpolate}
        dim={dim}
        onDim={setDim}
        size={size}
        onSize={onSize}
        loading={loading}
        loadError={loadError}
        autoRotate={autoRotate}
        onAutoRotate={setAutoRotate}
      />
      <div className="stage">
        <Scatter Y={clock.display} dim={dim} labels={meta.labels} version={clock.version} autoRotate={autoRotate}>
          <ul className="legend">
            {DIGIT_COLORS.map((color, digit) => (
              <li key={digit}>
                <span className="swatch" style={{ background: color }} /> {digit}
              </li>
            ))}
          </ul>
        </Scatter>
        <ForceSliders
          values={shown}
          scale={scale}
          onScale={setScale}
          spring={spring}
          onSpring={(type, s) => setSpring((prev) => ({ ...prev, [type]: s }))}
          split={split}
          onSplit={(type, s) => setSplit((prev) => ({ ...prev, [type]: s }))}
          faderZero={faderZero}
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
      <MidiPanel midi={midi} />
    </div>
  )
}

export default function App() {
  const [size, setSize] = useState<SampleSize>('20k')
  const { data, error, loading } = useData(size)

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
      {data ? (
        <Playground data={data} size={size} onSize={setSize} loading={loading} loadError={error} />
      ) : (
        <p className="status">{error ?? 'Loading…'}</p>
      )}
    </main>
  )
}
