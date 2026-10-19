import { useEffect, useRef } from 'react'
import type { Playhead } from '../playhead'
import { SIDE, type Traces } from '../signal'

// Speed slider: logarithmic, 1–120 pixels per second.
const SPEED_MIN = 1
const SPEED_MAX = 120
const toSpeed = (u: number) => Math.round(SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** u * 10) / 10
const fromSpeed = (s: number) => Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)

/** Play/pause, the scrubber (as wide as the matrix below it), speed, looping and how far trails reach. */
export function Transport({
  playhead,
  traces,
  trailPixels,
  onTrailPixels,
}: {
  playhead: Playhead
  traces: Traces
  trailPixels: number
  onTrailPixels: (pixels: number) => void
}) {
  const scrubRef = useRef<HTMLInputElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null)

  useEffect(() => {
    const update = () => {
      if (!scrubbing.current) scrubRef.current!.value = String(playhead.moment)
      const t = Math.min(traces.length - 1, Math.round(playhead.moment))
      const p = traces.pixelAt[t]
      readoutRef.current!.textContent = `pixel ${t + 1} of ${traces.length} · row ${Math.floor(p / SIDE) + 1}, column ${(p % SIDE) + 1} · ${(
        playhead.moment / playhead.speed
      ).toFixed(0)}s of ${((traces.length - 1) / playhead.speed).toFixed(0)}s`
    }
    update()
    return playhead.onFrame(update)
  }, [playhead, traces, playhead.speed])

  return (
    <div className="transport">
      <div className="toolbar">
        <button
          className={playhead.playing ? '' : 'start'}
          onClick={() => playhead.setPlaying(!playhead.playing)}
          aria-label={playhead.playing ? 'Pause' : 'Play'}
        >
          <span className="play-labels">
            <span className={playhead.playing ? 'hidden' : ''}>▶ Play</span>
            <span className={playhead.playing ? '' : 'hidden'}>❚❚ Pause</span>
          </span>
        </button>
        <button onClick={() => playhead.seek(0)}>⏮ Start</button>
        <label className="slider">
          speed
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={fromSpeed(playhead.speed)}
            onChange={(e) => playhead.setSpeed(toSpeed(Number(e.target.value)))}
          />
          <span className="num">{playhead.speed} px/s</span>
        </label>
        <label className="slider">
          trail
          <input type="range" min={SIDE / 4} max={SIDE * 8} step={1} value={trailPixels} onChange={(e) => onTrailPixels(Number(e.target.value))} />
          <span className="num">{trailPixels} px</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={playhead.loop} onChange={(e) => playhead.setLoop(e.target.checked)} /> loop
        </label>
        <span className="readout" ref={readoutRef} />
      </div>
      <input
        ref={scrubRef}
        className="scrubber"
        type="range"
        min={0}
        max={traces.length - 1}
        step="any"
        aria-label="Moment"
        onPointerDown={() => {
          scrubbing.current = { wasPlaying: playhead.playing }
          playhead.setPlaying(false)
        }}
        onPointerUp={() => {
          if (scrubbing.current?.wasPlaying) playhead.setPlaying(true)
          scrubbing.current = null
        }}
        onChange={(e) => playhead.seek(Number(e.target.value))}
      />
    </div>
  )
}
