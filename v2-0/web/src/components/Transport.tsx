import type { ClockStatus } from '../useLoopClock'

interface Props {
  status: ClockStatus
  playhead: number
  length: number
  phase: 1 | 2 | 3
  steps: number
  rate: number
  onRate: (rate: number) => void
  onPause: () => void
  onResume: () => void
  onReset: () => void
  autopilot: boolean
  onAutopilot: (on: boolean) => void
  interpolate: boolean
  onInterpolate: (on: boolean) => void
}

/** Play/pause, reset, speed, autopilot and smoothing, with where the loop is up to. */
export function Transport(p: Props) {
  return (
    <div className="toolbar">
      <div className="segmented" role="group" aria-label="Forces from">
        <button type="button" className={p.autopilot ? '' : 'on'} onClick={() => p.onAutopilot(false)}>
          Manual
        </button>
        <button type="button" className={p.autopilot ? 'on' : ''} onClick={() => p.onAutopilot(true)}>
          Autopilot
        </button>
      </div>
      <button type="button" onClick={p.status === 'paused' ? p.onResume : p.onPause} disabled={p.status === 'idle'}>
        {p.status === 'paused' ? 'Resume' : 'Pause'}
      </button>
      <button type="button" onClick={p.onReset} disabled={p.status === 'idle' && p.steps === 0}>
        Reset
      </button>
      <label className="rate">
        <input type="range" min={1} max={60} value={p.rate} onChange={(e) => p.onRate(Number(e.target.value))} />
        {p.rate} it/s
      </label>
      <label className="smooth" title="Glide between steps (drawn at 30 fps, one step behind)">
        <input type="checkbox" checked={p.interpolate} onChange={(e) => p.onInterpolate(e.target.checked)} /> smooth
      </label>
      <span className="readout">
        {p.status === 'idle' ? (
          <strong>Move a control to start</strong>
        ) : (
          <>
            iteration {p.playhead} / {p.length} · phase {p.phase} · {p.steps} steps total
            {p.status === 'paused' && ' · paused'}
          </>
        )}
      </span>
    </div>
  )
}
