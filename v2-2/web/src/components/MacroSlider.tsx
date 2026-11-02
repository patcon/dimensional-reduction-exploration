import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { MACRO_INFO, macroMarks, type MacroMode } from '../macro'

const pct = (f: number) => `${f * 100}%`
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

interface Props {
  mode: MacroMode
  /** 0 at the top (PaCMAP's start, global) to 1 at the bottom (its end, local). */
  s: number
  /** What the position means in this mode (an iteration, say), shown above the track. */
  readout: string
  /** Where the playhead has got to along the track, for the clock (B), whose playhead trails the slider. */
  follower?: number
  /** Called as a drag or key press starts, before the first onChange. */
  onGrab: () => void
  onChange: (s: number) => void
}

/** The one slider that plays all three forces, top to bottom along the mode's path. */
export function MacroSlider({ mode, s, readout, follower, onGrab, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const sAt = (e: PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect()
    return clamp01((e.clientY - r.top) / r.height)
  }
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onGrab()
    onChange(sAt(e))
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(sAt(e))
  }
  // Down the track is on through the run, so the down arrow moves the slider down.
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.005
    const next: Record<string, number> = {
      ArrowDown: s + step, ArrowRight: s + step, ArrowUp: s - step, ArrowLeft: s - step,
      PageDown: s + 0.1, PageUp: s - 0.1, Home: 0, End: 1,
    }
    if (!(e.key in next)) return
    e.preventDefault()
    onGrab()
    onChange(clamp01(next[e.key]))
  }

  return (
    <div className="force macro">
      <div className="force-label">{MACRO_INFO[mode].name}</div>
      <div className="force-value">{readout}</div>
      <span className="text-[11px] text-muted-foreground">global</span>
      <div
        ref={trackRef}
        className="force-track"
        role="slider"
        tabIndex={0}
        aria-label={`All forces: ${MACRO_INFO[mode].name}`}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(s.toFixed(3))}
        aria-valuetext={readout}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="force-fill macro-fill" style={{ top: 0, height: pct(s) }} />
        {macroMarks(mode).map((m) => (
          <div key={m} className="force-mark" style={{ top: pct(m) }} aria-hidden />
        ))}
        {follower !== undefined && <div className="macro-follower" style={{ top: pct(follower) }} aria-hidden />}
        <div className="force-thumb macro-thumb" style={{ top: pct(s) }} />
      </div>
      <span className="text-[11px] text-muted-foreground">local</span>
    </div>
  )
}
