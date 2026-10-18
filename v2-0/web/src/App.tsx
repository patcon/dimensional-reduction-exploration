import { useCallback, useMemo, useState } from 'react'
import { ForceSliders } from './components/ForceSliders'
import { Scatter } from './components/Scatter'
import { Transport } from './components/Transport'
import { Engine } from './engine'
import { DEFAULT_SCALE, toMultiplier, toU, type ForceScale } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DIGIT_COLORS } from './palette'
import { pacmapWeights, phaseOf, scheduleLength } from './schedule'
import type { PairType, Weights } from './types'
import { useData, type PacmapData } from './useData'
import { useLoopClock } from './useLoopClock'

const mapValues = <A, B>(r: Record<PairType, A>, f: (a: A) => B): Record<PairType, B> =>
  ({ nb: f(r.nb), mn: f(r.mn), fp: f(r.fp) })

function Playground({ data }: { data: PacmapData }) {
  const { meta } = data
  const engine = useMemo(() => new Engine(data.pairs, data.init, meta.adam), [data, meta.adam])
  const length = scheduleLength(meta.schedule)

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
  const clock = useLoopClock(engine, length, getWeights)

  // Under autopilot the sliders follow PaCMAP's forces; grabbing one takes over from exactly there.
  const shown: ControlValues = autopilot
    ? mapValues(pacmapWeights(clock.playhead, meta.schedule), (w) => toU(w, scale))
    : controls
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
        onReset={clock.reset}
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
