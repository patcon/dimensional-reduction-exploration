import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DigitPicker } from './components/DigitPicker'
import { DigitPreview } from './components/DigitPreview'
import { ForceSliders } from './components/ForceSliders'
import { MidiPanel } from './components/MidiPanel'
import { OptimiserPanel } from './components/OptimiserPanel'
import { Scatter } from './components/Scatter'
import { ScheduleGraph } from './components/ScheduleGraph'
import { Section, Segmented } from './components/controls'
import { PlaySection, TransportBar, ViewSection } from './components/Transport'
import { Engine } from './engine'
import { DEFAULT_SCALE, spanning, toMultiplier, toU, type ForceScale } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DEFAULT_OPTIMISER, OptimiserBank, type OptimiserSettings } from './optimisers'
import { pacmapWeights, phaseOf, scheduleLength, Trail } from './schedule'
import { PAIR_TYPES, type Dim, type Pairs, type PairType, type Weights } from './types'
import { useData, useDigits, type PacmapData, type SampleSize } from './useData'
import { useLoopClock } from './useLoopClock'
import type { Zero } from './midi'
import { useMidi } from './useMidi'

/** How far a control must move before the kicking Adam forgets its state. */
const KICK_THRESHOLD = 0.02

const mapValues = <A, B>(r: Record<PairType, A>, f: (a: A, type: PairType) => B): Record<PairType, B> =>
  ({ nb: f(r.nb, 'nb'), mn: f(r.mn, 'mn'), fp: f(r.fp, 'fp') })

/** Every partner of digit `i` in each pair type, whichever end of the pair it's at, as both ends feel its force. */
function partnersOf(pairs: Pairs, i: number) {
  return mapValues(pairs, (flat) => {
    const partners: number[] = []
    for (let k = 0; k < flat.length; k += 2) {
      if (flat[k] === i) partners.push(flat[k + 1])
      else if (flat[k + 1] === i) partners.push(flat[k])
    }
    return Uint32Array.from(partners)
  })
}

interface PlaygroundProps {
  data: PacmapData
  size: SampleSize
  /** The size `data` is, which lags `size` while it loads. */
  dataSize: SampleSize
  /** Switching size swaps `data` once it has loaded, starting over on the new digits. */
  onSize: (size: SampleSize) => void
  /** Whether `size` is still loading (`data` is the previous size's until it arrives). */
  loading: boolean
  loadError?: string
}

function Playground({ data, size, dataSize, onSize, loading, loadError }: PlaygroundProps) {
  const { meta } = data
  const [dim, setDim] = useState<Dim>(3)
  const [autoRotate, setAutoRotate] = useState(true)
  // The clicked digit, and the one hovered (by the mouse, or a held press), previewed in the plot's corner.
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  // Which digit labels are drawn; hiding one lets go of it if it was picked.
  const [digitsShown, setDigitsShown] = useState(() => Array<boolean>(10).fill(true))
  const pixels = useDigits(dataSize)
  // Other digits, so whatever was picked is gone.
  const [pickedIn, setPickedIn] = useState(data)
  if (pickedIn !== data) {
    setPickedIn(data)
    setSelected(null)
    setHovered(null)
  }
  if (selected !== null && !digitsShown[meta.labels[selected]]) setSelected(null)
  if (hovered !== null && !digitsShown[meta.labels[hovered]]) setHovered(null)
  const previewed = hovered ?? selected
  const edges = useMemo(() => (selected === null ? null : partnersOf(data.pairs, selected)), [data.pairs, selected])
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
  // Each force's slider has its own range.
  const [scale, setScale] = useState<Record<PairType, ForceScale>>({ nb: DEFAULT_SCALE, mn: DEFAULT_SCALE, fp: DEFAULT_SCALE })
  const [spring, setSpring] = useState<Record<PairType, boolean>>({ nb: false, mn: false, fp: false })
  const [split, setSplit] = useState<Record<PairType, boolean>>({ nb: true, mn: true, fp: true })
  // Opens on autopilot, paused at the start: press Play to watch PaCMAP's own run.
  const [autopilot, setAutopilot] = useState(true)

  const getWeights = useCallback(
    (playhead: number): Weights =>
      autopilot ? pacmapWeights(playhead, meta.schedule) : mapValues(store.get(), (u, type) => toMultiplier(u, scale[type])),
    [autopilot, meta.schedule, store, scale],
  )
  // What's been played this loop, for the schedule graph; cleared as the loop wraps.
  const trail = useMemo(() => new Trail(length), [length])
  const onStep = useCallback((playhead: number, w: Weights) => trail.record(playhead, w), [trail])
  // Autopilot plays PaCMAP's schedule once and stops; manual play loops.
  const clock = useLoopClock(engine, length, getWeights, !autopilot, onStep, true)
  // The Reset button: back to the start, stopped there until Start simulation.
  const reset = () => {
    trail.clear()
    clock.reset(true)
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
    ? mapValues(pacmapWeights(clock.playhead, meta.schedule), (w, type) => toU(w, scale[type]))
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
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border p-3">
        <TransportBar
          status={clock.status}
          playhead={clock.playhead}
          schedule={meta.schedule}
          length={length}
          phase={phaseOf(clock.playhead, meta.schedule)}
          steps={clock.steps}
          autopilot={autopilot}
          onPause={clock.pause}
          onResume={clock.resume}
          onReset={reset}
          loading={loading}
          loadError={loadError}
          size={size}
        />
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <Scatter
          Y={clock.display}
          dim={dim}
          labels={meta.labels}
          shown={digitsShown}
          version={clock.version}
          autoRotate={autoRotate}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={setHovered}
          edges={edges}
          weights={liveWeights}
          corner={
            <DigitPreview
              pixels={pixels}
              index={previewed}
              label={previewed === null ? null : meta.labels[previewed]}
              hovering={previewed !== selected}
            />
          }
        >
          <DigitPicker shown={digitsShown} onShown={setDigitsShown} />
        </Scatter>
        <div className="flex h-[60vh] flex-col gap-3 rounded-lg border p-3">
          <Section title="Forces" description="Up attracts, down repels; PaCMAP's values are marked beside each.">
            <Segmented
              options={['manual', 'autopilot'] as const}
              value={autopilot ? 'autopilot' : 'manual'}
              onChange={(v) => (v === 'autopilot' ? setAutopilot(true) : takeOver())}
            />
          </Section>
          <ForceSliders
            values={shown}
            scale={scale}
            onScale={(type, s) => setScale((prev) => ({ ...prev, [type]: s }))}
            spring={spring}
            onSpring={(type, s) => setSpring((prev) => ({ ...prev, [type]: s }))}
            split={split}
            onSplit={(type, s) => setSplit((prev) => ({ ...prev, [type]: s }))}
            faderZero={faderZero}
            onGrab={takeOver}
            onChange={(type, u) => store.set(type, u)}
          />
        </div>
      </div>
      <div className="grid gap-6 rounded-lg border p-3 md:grid-cols-2">
        <PlaySection rate={clock.rate} onRate={clock.setRate} interpolate={clock.interpolate} onInterpolate={clock.setInterpolate} />
        <ViewSection dim={dim} onDim={setDim} autoRotate={autoRotate} onAutoRotate={setAutoRotate} size={size} onSize={onSize} />
      </div>
      <div className="rounded-lg border p-3">
        <ScheduleGraph
          schedule={meta.schedule}
          scale={spanning(PAIR_TYPES.map((type) => scale[type]))}
          playhead={clock.playhead}
          current={liveWeights}
          trail={trail}
        />
      </div>
      <div className="rounded-lg border p-3">
        <OptimiserPanel settings={optimiser} onChange={setOptimiser} />
      </div>
      <div className="rounded-lg border p-3">
        <MidiPanel midi={midi} />
      </div>
    </div>
  )
}

export default function App() {
  const [size, setSize] = useState<SampleSize>('20k')
  const { data, dataSize, error, loading } = useData(size)

  return (
    <main className="mx-auto max-w-300 px-4 py-6">
      <header className="mb-3">
        <h1 className="mb-2 text-2xl font-semibold">Playable PaCMAP (mobile)</h1>
        <p className="max-w-[70ch] text-muted-foreground">
          PaCMAP's optimisation, live in the browser on {data ? data.meta.nSamples.toLocaleString() : '20,000'} MNIST
          digits. The neighbour, mid-near and far pairs are fixed; the forces on them are yours to play. A loop runs
          over PaCMAP's 450-iteration schedule; autopilot plays PaCMAP's own forces along it.
        </p>
      </header>
      {data ? (
        <Playground data={data} size={size} dataSize={dataSize!} onSize={setSize} loading={loading} loadError={error} />
      ) : (
        <p className="p-12 text-muted-foreground">{error ?? 'Loading…'}</p>
      )}
    </main>
  )
}
