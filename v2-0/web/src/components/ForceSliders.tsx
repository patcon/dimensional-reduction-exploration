import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatMultiplier, toMultiplier, toU, type ForceScale } from '../forceScale'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import type { ControlValues } from '../inputStore'
import { faderPercent, type Zero } from '../midi'

/** The multipliers PaCMAP's schedule uses for each force, marked on its slider as targets. */
const PACMAP_MARKS: Record<PairType, number[]> = { nb: [1, 2, 3], mn: [3, 1000], fp: [-1] }

/** A mark's weight, which is always a whole number: +1, +1000, −1. */
const weightLabel = (w: number) => (w === 0 ? '0' : `${w > 0 ? '+' : '−'}${Math.abs(w)}`)

/** A fader position as MIDI Surf shows it. */
const percentLabel = (u: number, zero: Zero) => `${Math.round(faderPercent(u, zero))}%`

/** u in [-1, 1] as a CSS top offset: +1 at the top, 0 in the middle. */
const topOf = (u: number) => `${((1 - u) / 2) * 100}%`

/** Mark labels' line height, the least they're kept apart (px), and the leader's run. */
const LABEL_GAP = 13
const LEADER = 10

/**
 * Where to put each mark's label on a track this tall: at its mark, unless that's too close to
 * the one above, then pushed down (and back up if that runs off the end). ys are top to bottom.
 */
function spread(ys: number[], height: number) {
  const out = [...ys]
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + LABEL_GAP)
  out[out.length - 1] = Math.min(out[out.length - 1], height - LABEL_GAP / 2)
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - LABEL_GAP)
  return out
}

interface SliderProps {
  type: PairType
  u: number
  scale: ForceScale
  spring: boolean
  onSpring: (spring: boolean) => void
  /** Set when this force is played from a fader: label positions as that fader's percentage. */
  faderZero: Zero | null
  /** Called as a drag or key press starts, before the first onChange. */
  onGrab: () => void
  onChange: (u: number) => void
}

/**
 * One bipolar vertical slider: up attracts, down repels, the centre band is no force.
 * Spring sliders return to 0 when let go, like a pitch-bend wheel; latch sliders stay put,
 * like a fader. Keys always latch: arrows nudge (shift for bigger steps), 0 zeroes.
 */
function ForceSlider({ type, u, scale, spring, onSpring, faderZero, onGrab, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const track = trackRef.current!
    const observer = new ResizeObserver(() => setHeight(track.clientHeight))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])
  const color = FORCE_COLORS[type]
  const m = toMultiplier(u, scale)

  // On a fader, each mark also gives where to put the fader, as MIDI Surf shows it; no force is
  // marked too, as it's not at the centre of a bottom-zero fader.
  const marks = (faderZero ? [0, ...PACMAP_MARKS[type]] : PACMAP_MARKS[type])
    .map((w) => ({ w, u: toU(w, scale) }))
    .sort((a, b) => b.u - a.u)
    .map((mark) => ({ ...mark, y: ((1 - mark.u) / 2) * height }))
  const labelYs = spread(marks.map((mark) => mark.y), height)

  const uAt = (e: PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect()
    return 1 - (2 * (e.clientY - r.top)) / r.height
  }
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onGrab()
    onChange(uAt(e))
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(uAt(e))
  }
  const onPointerUp = () => {
    if (spring) onChange(0)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const next: Record<string, number> = {
      ArrowUp: u + step, ArrowRight: u + step, ArrowDown: u - step, ArrowLeft: u - step,
      PageUp: u + 0.1, PageDown: u - 0.1, Home: 1, End: -1, '0': 0, Delete: 0, Backspace: 0,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    onGrab()
    onChange(next[e.key])
  }

  return (
    <div className={faderZero ? 'force on-fader' : 'force'}>
      <div className="force-label" style={{ color }}>
        {FORCE_LABELS[type]}
      </div>
      <div className="force-value">
        {formatMultiplier(m)}
        {faderZero && <span className="force-percent">fader {percentLabel(u, faderZero)}</span>}
      </div>
      <div
        ref={trackRef}
        className="force-track"
        role="slider"
        tabIndex={0}
        aria-label={`${FORCE_LABELS[type]} force`}
        aria-orientation="vertical"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(u.toFixed(3))}
        aria-valuetext={formatMultiplier(m)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange(0)}
      >
        <div className="force-deadzone" style={{ top: topOf(scale.deadzone), bottom: topOf(scale.deadzone) }} />
        <div
          className="force-fill"
          style={{ background: color, top: topOf(Math.max(u, 0)), bottom: topOf(-Math.min(u, 0)) }}
        />
        {height > 0 && (
          <div className={faderZero ? 'force-marks with-percent' : 'force-marks'} aria-hidden="true">
            <svg width={LEADER} height={height}>
              {marks.map((mark, i) => (
                <path key={mark.w} d={`M0 ${mark.y + 0.5}H3L${LEADER - 3} ${labelYs[i] + 0.5}H${LEADER}`} />
              ))}
            </svg>
            {marks.map((mark, i) => (
              <div key={mark.w} className="force-mark" style={{ top: labelYs[i] }}>
                <span className="force-mark-weight">{weightLabel(mark.w)}</span>
                {faderZero && <span className="force-percent">{percentLabel(mark.u, faderZero)}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="force-thumb" style={{ top: topOf(u), borderColor: color }} />
      </div>
      <label className="force-spring">
        <input type="checkbox" checked={spring} onChange={(e) => onSpring(e.target.checked)} /> spring
      </label>
    </div>
  )
}

interface Props {
  values: ControlValues
  scale: ForceScale
  onScale: (scale: ForceScale) => void
  spring: Record<PairType, boolean>
  onSpring: (type: PairType, spring: boolean) => void
  faderZero: Record<PairType, Zero | null>
  onGrab: () => void
  onChange: (type: PairType, u: number) => void
}

/** The three forces side by side, with the scale's range below. */
export function ForceSliders({ values, scale, onScale, spring, onSpring, faderZero, onGrab, onChange }: Props) {
  const setRange = (key: 'min' | 'max', value: number) => {
    if (!(value > 0)) return
    const next = { ...scale, [key]: value }
    if (next.min < next.max) onScale(next)
  }
  return (
    <section className="forces" aria-label="Forces">
      <div className="force-ends">
        <span>attract</span>
        <span>repel</span>
      </div>
      <div className="force-sliders">
        {PAIR_TYPES.map((type) => (
          <ForceSlider
            key={type}
            type={type}
            u={values[type]}
            scale={scale}
            spring={spring[type]}
            onSpring={(s) => onSpring(type, s)}
            faderZero={faderZero[type]}
            onGrab={onGrab}
            onChange={(u) => onChange(type, u)}
          />
        ))}
      </div>
      <div className="force-range">
        <label>
          min <input type="number" step="any" defaultValue={scale.min} onChange={(e) => setRange('min', Number(e.target.value))} />
        </label>
        <label>
          max <input type="number" step="any" defaultValue={scale.max} onChange={(e) => setRange('max', Number(e.target.value))} />
        </label>
      </div>
    </section>
  )
}
