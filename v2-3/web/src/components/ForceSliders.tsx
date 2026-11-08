import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatMultiplier, toMultiplier, toU, type ForceScale } from '../forceScale'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import type { ControlValues } from '../inputStore'
import { faderPercent, PACMAP_SIGNS, type Zero } from '../midi'
import { Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Toggle } from './controls'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'

/** The multipliers PaCMAP's schedule uses for each force, marked on its slider as targets. */
const PACMAP_MARKS: Record<PairType, number[]> = { nb: [1, 2, 3], mn: [3, 1000], fp: [-1] }

/** A fader position as MIDI Surf shows it. */
const percentLabel = (u: number, zero: Zero) => `${Math.round(faderPercent(u, zero))}%`

/**
 * Where u in [-1, 1] sits on a track, as a fraction from the top. Split: +1 at the top, 0 in
 * the middle, -1 at the bottom. Not split: the strength alone, 0 at the bottom.
 */
const posOf = (u: number, split: boolean) => (split ? (1 - u) / 2 : 1 - Math.min(1, Math.abs(u)))
const pct = (f: number) => `${f * 100}%`
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

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
  /** Set when this force is played from a fader: its position shows as that fader's percentage. */
  faderZero: Zero | null
  /** Whether to keep room for the sign button under the track, so sliders line up when any is unsplit. */
  signRow: boolean
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
function ForceSlider({ type, u, scale, onScale, spring, onSpring, split, onSplit, faderZero, signRow, onGrab, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  // Not split, the sign is kept even at no force (as -0), or as last chosen here, starting as PaCMAP's.
  const [chosenSign, setChosenSign] = useState<1 | -1>(PACMAP_SIGNS[type])
  const [optionsOpen, setOptionsOpen] = useState(false)
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

  // On a fader, no force is marked too, as it's not at the centre of a bottom-zero fader.
  const marks = faderZero ? [0, ...PACMAP_MARKS[type]] : PACMAP_MARKS[type]

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
    <div className="force">
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
        {/* PaCMAP's values, as lines across the track, unlabelled: the readout above gives the value. */}
        {marks.map((w) => (
          <div key={w} className="force-mark" style={{ top: pct(posOf(toU(w, scale), split)) }} aria-hidden />
        ))}
        <div className="force-thumb" style={{ top: pct(posOf(u, split)), borderColor: color }} />
      </div>
      {/* Split, the sign keeps its space while another slider shows one, so they line up. */}
      {signRow && (
        <Button
          variant="outline"
          size="sm"
          className={cn('h-7 w-17 px-0 text-xs', split && 'invisible')}
          onClick={flipSign}
          disabled={split}
          aria-label={`${FORCE_LABELS[type]} sign: ${sign > 0 ? 'attract' : 'repel'}`}
        >
          {sign > 0 ? '+ attract' : '− repel'}
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" onClick={() => setOptionsOpen(true)} aria-label={`${FORCE_LABELS[type]} slider options`}>
        <Settings2 />
      </Button>
      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle style={{ color }}>{FORCE_LABELS[type]} slider</SheetTitle>
            <SheetDescription>How this force's slider reads and behaves.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <Toggle label="spring back to 0 when let go" checked={spring} onChange={onSpring} />
            <Toggle
              label="split: up attracts, down repels"
              checked={split}
              onChange={onSplit}
              note="Off, the slider is the strength alone, from 0 at the bottom, with a sign button under it."
            />
            <Toggle
              label="logarithmic"
              checked={scale.log}
              onChange={(log) => onScale({ ...scale, log })}
              note="From min to max, so one slider reaches both 1 and 1000. Off, even steps of force (best with a smaller max)."
            />
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">The weakest and strongest force it reaches (either sign)</span>
              <div className="flex gap-4">
                {(['min', 'max'] as const).map((key) => (
                  <label key={key} className="flex items-center gap-2">
                    {key}
                    <input
                      className="num h-9 w-24 rounded-md border bg-background px-2 shadow-xs"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      defaultValue={scale[key]}
                      onChange={(e) => setRange(key, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
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

/** The three forces side by side, each with its options behind a button below it. */
export function ForceSliders({ values, scale, onScale, spring, onSpring, split, onSplit, faderZero, onGrab, onChange }: Props) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1 text-sm" aria-label="Forces">
      <div className="flex min-h-0 flex-1 justify-center gap-3">
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
            signRow={!PAIR_TYPES.every((t) => split[t])}
            onGrab={onGrab}
            onChange={(u) => onChange(type, u)}
          />
        ))}
      </div>
    </section>
  )
}
