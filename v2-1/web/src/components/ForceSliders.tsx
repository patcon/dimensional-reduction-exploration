import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatMultiplier, toMultiplier, toU, type ForceScale } from '../forceScale'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import type { ControlValues } from '../inputStore'
import { faderPercent, PACMAP_SIGNS, type Zero } from '../midi'

/** The multipliers PaCMAP's schedule uses for each force, marked on its slider as targets. */
const PACMAP_MARKS: Record<PairType, number[]> = { nb: [1, 2, 3], mn: [3, 1000], fp: [-1] }

/** A mark's weight, which is always a whole number: +1, +1000, −1. */
const weightLabel = (w: number) => (w === 0 ? '0' : `${w > 0 ? '+' : '−'}${Math.abs(w)}`)

/** A fader position as MIDI Surf shows it. */
const percentLabel = (u: number, zero: Zero) => `${Math.round(faderPercent(u, zero))}%`

/**
 * Where u in [-1, 1] sits on a track, as a fraction from the top. Split: +1 at the top, 0 in
 * the middle, -1 at the bottom. Not split: the strength alone, 0 at the bottom.
 */
const posOf = (u: number, split: boolean) => (split ? (1 - u) / 2 : 1 - Math.min(1, Math.abs(u)))
const pct = (f: number) => `${f * 100}%`
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

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
  /** This force's own range. */
  scale: ForceScale
  onScale: (scale: ForceScale) => void
  spring: boolean
  onSpring: (spring: boolean) => void
  /** Up attracts and down repels (split), or the track is the strength alone with a sign button. */
  split: boolean
  onSplit: (split: boolean) => void
  /** Set when this force is played from a fader: label positions as that fader's percentage. */
  faderZero: Zero | null
  /** Called as a drag or key press starts, before the first onChange. */
  onGrab: () => void
  onChange: (u: number) => void
}

/**
 * One vertical slider. Split: up attracts, down repels, the centre band is no force. Not split:
 * like a fader that starts at the bottom, it sets the strength, and a button sets the sign.
 * Spring sliders return to 0 when let go, like a pitch-bend wheel; latch sliders stay put,
 * like a fader. Keys always latch: arrows nudge (shift for bigger steps), 0 zeroes.
 */
function ForceSlider({ type, u, scale, onScale, spring, onSpring, split, onSplit, faderZero, onGrab, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const track = trackRef.current!
    const observer = new ResizeObserver(() => setHeight(track.clientHeight))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])
  // Not split, the sign is kept even at no force (as -0), or as last chosen here, starting as PaCMAP's.
  const [chosenSign, setChosenSign] = useState<1 | -1>(PACMAP_SIGNS[type])
  const sign = u > 0 ? 1 : u < 0 || Object.is(u, -0) ? -1 : chosenSign
  const color = FORCE_COLORS[type]
  const m = toMultiplier(u, scale)
  /** A position along the track (0 at the bottom, 1 at the top) as u. */
  const fromTravel = (t: number) => (split ? clamp01(t) * 2 - 1 : sign * clamp01(t))
  const travel = split ? (u + 1) / 2 : Math.abs(u)
  const setRange = (key: 'min' | 'max', value: number) => {
    if (!(value > 0)) return
    const next = { ...scale, [key]: value }
    if (next.min < next.max) onScale(next)
  }
  const flipSign = () => {
    onGrab()
    setChosenSign(sign > 0 ? -1 : 1)
    onChange(-u || (sign > 0 ? -0 : 0))
  }

  // On a fader, each mark also gives where to put the fader, as MIDI Surf shows it; no force is
  // marked too, as it's not at the centre of a bottom-zero fader.
  const marks = (faderZero ? [0, ...PACMAP_MARKS[type]] : PACMAP_MARKS[type])
    .map((w) => ({ w, u: toU(w, scale) }))
    .map((mark) => ({ ...mark, y: posOf(mark.u, split) * height }))
    .sort((a, b) => a.y - b.y)
  const labelYs = spread(marks.map((mark) => mark.y), height)

  const uAt = (e: PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect()
    return fromTravel(1 - (e.clientY - r.top) / r.height)
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
    if (spring) onChange(split || sign > 0 ? 0 : -0)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    // In travel along the track, which is half as far per unit of u when split.
    const step = (e.shiftKey ? 0.1 : 0.01) / (split ? 2 : 1)
    const page = 0.1 / (split ? 2 : 1)
    const zero = split ? 0.5 : 0
    const next: Record<string, number> = {
      ArrowUp: travel + step, ArrowRight: travel + step, ArrowDown: travel - step, ArrowLeft: travel - step,
      PageUp: travel + page, PageDown: travel - page, Home: 1, End: 0, '0': zero, Delete: zero, Backspace: zero,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    onGrab()
    onChange(fromTravel(next[e.key]))
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
        <div
          className="force-deadzone"
          style={split ? { top: pct(posOf(scale.deadzone, true)), bottom: pct(posOf(scale.deadzone, true)) } : { top: pct(posOf(scale.deadzone, false)), bottom: 0 }}
        />
        <div
          className="force-fill"
          style={
            split
              ? { background: color, top: pct(posOf(Math.max(u, 0), true)), bottom: pct(posOf(-Math.min(u, 0), true)) }
              : { background: color, top: pct(posOf(u, false)), bottom: 0 }
          }
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
                {/* Not split, the track is the strength alone, so its marks take the current sign. */}
                <span className="force-mark-weight">{weightLabel(split ? mark.w : sign * Math.abs(mark.w))}</span>
                {faderZero && <span className="force-percent">{percentLabel(mark.u, faderZero)}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="force-thumb" style={{ top: pct(posOf(u, split)), borderColor: color }} />
      </div>
      <button
        type="button"
        className={`force-sign${split ? ' hidden' : ''}`}
        onClick={flipSign}
        disabled={split}
        aria-label={`${FORCE_LABELS[type]} sign: ${sign > 0 ? 'attract' : 'repel'}`}
      >
        {sign > 0 ? '+ attract' : '− repel'}
      </button>
      <div className="force-options">
        <label>
          <input type="checkbox" checked={spring} onChange={(e) => onSpring(e.target.checked)} /> spring
        </label>
        <label title="Up attracts, down repels. Untick to make the slider the strength alone, with a sign button.">
          <input type="checkbox" checked={split} onChange={(e) => onSplit(e.target.checked)} /> split
        </label>
        <label title="Logarithmic from min to max, so one slider reaches both 1 and 1000. Untick for even steps of force.">
          <input type="checkbox" checked={scale.log} onChange={(e) => onScale({ ...scale, log: e.target.checked })} /> logarithmic
        </label>
      </div>
      <div className="force-range" title="The weakest and strongest force this slider reaches (either sign)">
        <label>
          min <input type="number" step="any" defaultValue={scale.min} onChange={(e) => setRange('min', Number(e.target.value))} />
        </label>
        <label>
          max <input type="number" step="any" defaultValue={scale.max} onChange={(e) => setRange('max', Number(e.target.value))} />
        </label>
      </div>
    </div>
  )
}

interface Props {
  values: ControlValues
  scale: Record<PairType, ForceScale>
  onScale: (type: PairType, scale: ForceScale) => void
  spring: Record<PairType, boolean>
  onSpring: (type: PairType, spring: boolean) => void
  split: Record<PairType, boolean>
  onSplit: (type: PairType, split: boolean) => void
  faderZero: Record<PairType, Zero | null>
  onGrab: () => void
  onChange: (type: PairType, u: number) => void
}

/** The three forces side by side, each with its own range below it. */
export function ForceSliders({ values, scale, onScale, spring, onSpring, split, onSplit, faderZero, onGrab, onChange }: Props) {
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
            scale={scale[type]}
            onScale={(s) => onScale(type, s)}
            spring={spring[type]}
            onSpring={(s) => onSpring(type, s)}
            split={split[type]}
            onSplit={(s) => onSplit(type, s)}
            faderZero={faderZero[type]}
            onGrab={onGrab}
            onChange={(u) => onChange(type, u)}
          />
        ))}
      </div>
    </section>
  )
}
