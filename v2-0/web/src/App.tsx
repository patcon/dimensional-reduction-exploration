import { useEffect, useMemo, useState } from 'react'
import { Scatter } from './components/Scatter'
import { Engine } from './engine'
import { DIGIT_COLORS } from './palette'
import { pacmapWeights, phaseOf, scheduleLength } from './schedule'
import { useData, type PacmapData } from './useData'

/** Time to spend stepping per animation frame while autopilot runs flat out. */
const FRAME_BUDGET_MS = 12

function Playground({ data }: { data: PacmapData }) {
  const { meta } = data
  const engine = useMemo(() => new Engine(data.pairs, data.init, meta.adam), [data, meta.adam])
  const total = scheduleLength(meta.schedule)

  const [running, setRunning] = useState(false)
  const [version, setVersion] = useState(0)
  const [msPerIter, setMsPerIter] = useState(0)

  // Autopilot: PaCMAP's own schedule, as fast as the frame budget allows, until the schedule ends.
  useEffect(() => {
    if (!running) return
    let frame = 0
    const tick = () => {
      const start = performance.now()
      let stepped = 0
      let ms = 0
      while (engine.steps < total && performance.now() - start < FRAME_BUDGET_MS) {
        engine.step(pacmapWeights(engine.steps, meta.schedule))
        stepped++
      }
      if (stepped) {
        ms = (performance.now() - start) / stepped
        setMsPerIter(ms)
      }
      setVersion((v) => v + 1)
      if (engine.steps < total) frame = requestAnimationFrame(tick)
      else {
        console.log(`autopilot: ${total} iterations, ~${ms.toFixed(1)} ms each in the last frame`)
        setRunning(false)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, engine, total, meta.schedule])

  const reset = () => {
    setRunning(false)
    engine.reset()
    setVersion((v) => v + 1)
  }

  const iter = engine.steps
  const done = iter >= total

  return (
    <div className="playground">
      <div className="toolbar">
        <button type="button" onClick={() => (done ? reset() : setRunning((r) => !r))}>
          {running ? 'Pause' : done ? 'Reset' : iter ? 'Resume autopilot' : 'Autopilot'}
        </button>
        <button type="button" onClick={reset} disabled={!iter}>
          Reset
        </button>
        <span className="readout">
          iteration {iter} / {total} · phase {phaseOf(Math.min(iter, total - 1), meta.schedule)}
          {msPerIter > 0 && ` · ${msPerIter.toFixed(1)} ms/iteration`}
        </span>
        <ul className="legend">
          {DIGIT_COLORS.map((color, digit) => (
            <li key={digit}>
              <span className="swatch" style={{ background: color }} /> {digit}
            </li>
          ))}
        </ul>
      </div>
      <Scatter Y={engine.Y} labels={meta.labels} version={version} />
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
          digits. The neighbour, mid-near and far pairs are fixed; the forces on them are yours to play. For now,
          autopilot replays PaCMAP's own schedule.
        </p>
      </header>
      {error ? <p className="status">{error}</p> : data ? <Playground data={data} /> : <p className="status">Loading…</p>}
    </main>
  )
}
