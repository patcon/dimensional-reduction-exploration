import type { Dim } from '../types'
import type { ClockStatus } from '../useLoopClock'
import { SAMPLE_SIZES, type SampleSize } from '../useData'

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
  dim: Dim
  /** Switching dimension starts over from that dimension's initial layout. */
  onDim: (dim: Dim) => void
  autoRotate: boolean
  onAutoRotate: (on: boolean) => void
  /** How many digits; switching starts over on the new ones once they've loaded. */
  size: SampleSize
  onSize: (size: SampleSize) => void
  loading: boolean
  loadError?: string
}

/** The play/pause button's labels; the first, before anything has run, is drawn bold. */
const PLAY_LABELS = ['Start simulation', 'Resume', 'Pause']

/** 2D/3D, sample size, play/pause, reset, speed, autopilot and smoothing, with where the loop is up to. */
export function Transport(p: Props) {
  const stopped = p.status === 'paused' || p.status === 'ended'
  const start = stopped && p.steps === 0
  const playLabel = start ? PLAY_LABELS[0] : stopped ? PLAY_LABELS[1] : PLAY_LABELS[2]
  return (
    <div className="toolbar">
      <div className="segmented" role="group" aria-label="Dimensions" title="Switching starts over from the initial layout">
        {([2, 3] as const).map((dim) => (
          <button key={dim} type="button" className={p.dim === dim ? 'on' : ''} onClick={() => p.dim !== dim && p.onDim(dim)}>
            {dim}D
          </button>
        ))}
      </div>
      <label className="spin" title="Spin the 3D layout (drag it to turn it yourself, double-click to reset the view)">
        <input
          type="checkbox"
          checked={p.autoRotate}
          disabled={p.dim !== 3}
          onChange={(e) => p.onAutoRotate(e.target.checked)}
        />{' '}
        auto-rotate
      </label>
      <div className="segmented" role="group" aria-label="Digits" title="How many MNIST digits (switching starts over)">
        {SAMPLE_SIZES.map((size) => (
          <button key={size} type="button" className={p.size === size ? 'on' : ''} onClick={() => p.onSize(size)}>
            {size}
          </button>
        ))}
      </div>
      {/* The loop's own controls on a line of their own. */}
      <div className="toolbar-break" />
      <div className="segmented" role="group" aria-label="Forces from">
        <button type="button" className={p.autopilot ? '' : 'on'} onClick={() => p.onAutopilot(false)}>
          Manual
        </button>
        <button type="button" className={p.autopilot ? 'on' : ''} onClick={() => p.onAutopilot(true)}>
          Autopilot
        </button>
      </div>
      <button
        type="button"
        className={start ? 'start' : ''}
        onClick={stopped ? p.onResume : p.onPause}
        // Resuming a finished autopilot run would only replay it; that's what Reset is for.
        disabled={stopped ? p.status === 'ended' && p.autopilot : p.status === 'idle'}
      >
        {/* Every label stacked in one cell, only this one shown, so the button never changes width. */}
        <span className="play-labels">
          {PLAY_LABELS.map((label) => (
            <span key={label} className={label === playLabel ? '' : 'hidden'} aria-hidden={label !== playLabel}>
              {label}
            </span>
          ))}
        </span>
      </button>
      <button type="button" onClick={p.onReset} disabled={p.steps === 0}>
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
        {p.loadError ? (
          <strong>{p.loadError}</strong>
        ) : p.loading ? (
          <strong>Loading {p.size} digits…</strong>
        ) : p.status === 'idle' ? (
          <strong>Move a control to start</strong>
        ) : p.status === 'paused' && p.steps === 0 ? (
          <strong>Press Start simulation to begin</strong>
        ) : (
          <>
            iteration {p.playhead} / {p.length} · phase {p.phase} · {p.steps} steps total
            {p.status === 'paused' && ' · paused'}
            {p.status === 'ended' &&
              (p.autopilot ? ' · autopilot finished: Reset, then Start simulation, to replay, or switch to Manual to carry on' : ' · ended')}
          </>
        )}
      </span>
    </div>
  )
}
