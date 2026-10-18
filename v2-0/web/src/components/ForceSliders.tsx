import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { formatMultiplier, toMultiplier, toU, type ForceScale } from '../forceScale'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import type { ControlValues } from '../inputStore'

/** The multipliers PaCMAP's schedule uses for each force, marked on its slider as targets. */
const PACMAP_MARKS: Record<PairType, number[]> = { nb: [1, 2, 3], mn: [3, 1000], fp: [-1] }

/** u in [-1, 1] as a CSS top offset: +1 at the top, 0 in the middle. */
const topOf = (u: number) => `${((1 - u) / 2) * 100}%`

interface SliderProps {
  type: PairType
  u: number
  scale: ForceScale
  spring: boolean
  onSpring: (spring: boolean) => void
  /** Called as a drag or key press starts, before the first onChange. */
  onGrab: () => void
  onChange: (u: number) => void
}

/**
 * One bipolar vertical slider: up attracts, down repels, the centre band is no force.
 * Spring sliders return to 0 when let go, like a pitch-bend wheel; latch sliders stay put,
 * like a fader. Keys always latch: arrows nudge (shift for bigger steps), 0 zeroes.
 */
function ForceSlider({ type, u, scale, spring, onSpring, onGrab, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const color = FORCE_COLORS[type]
  const m = toMultiplier(u, scale)

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
    <div className="force">
      <div className="force-label" style={{ color }}>
        {FORCE_LABELS[type]}
      </div>
      <div className="force-value">{formatMultiplier(m)}</div>
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
        {PACMAP_MARKS[type].map((w) => (
          <div key={w} className="force-mark" style={{ top: topOf(toU(w, scale)) }}>
            <span>{formatMultiplier(w)}</span>
          </div>
        ))}
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
  onGrab: () => void
  onChange: (type: PairType, u: number) => void
}

/** The three forces side by side, with the scale's range below. */
export function ForceSliders({ values, scale, onScale, spring, onSpring, onGrab, onChange }: Props) {
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
