import { useCallback, useMemo, useState } from 'react'
import { Scatter } from './components/Scatter'
import { Transport } from './components/Transport'
import { Engine } from './engine'
import { DIGIT_COLORS } from './palette'
import { pacmapWeights, phaseOf, scheduleLength } from './schedule'
import type { Weights } from './types'
import { useData, type PacmapData } from './useData'
import { useLoopClock } from './useLoopClock'

const NO_FORCES: Weights = { nb: 0, mn: 0, fp: 0 }

function Playground({ data }: { data: PacmapData }) {
  const { meta } = data
  const engine = useMemo(() => new Engine(data.pairs, data.init, meta.adam), [data, meta.adam])
  const length = scheduleLength(meta.schedule)

  const [autopilot, setAutopilot] = useState(false)
  // Manual forces arrive with the on-screen and MIDI controls; until then manual mode stays idle.
  const getWeights = useCallback(
    (playhead: number) => (autopilot ? pacmapWeights(playhead, meta.schedule) : NO_FORCES),
    [autopilot, meta.schedule],
  )
  const clock = useLoopClock(engine, length, getWeights)

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
      <Scatter Y={engine.Y} labels={meta.labels} version={clock.version} />
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
