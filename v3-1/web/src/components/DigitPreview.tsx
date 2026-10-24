import { useEffect, useRef } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import { accentOf, shadeDigit } from '../digitImage'
import { SIDE, valenceAt, type Traces } from '../signal'

/**
 * The followed digit, read as it plays: the trail's window is tinted, everything outside it is
 * dimmed and the pixel being read is marked; beside it, the
 * valence it's reacting with right now.
 */
export function DigitPreview({
  pixels,
  poolRow,
  participant,
  label,
  groupName,
  groupColor,
  traces,
  playhead,
  trailPixels,
  following,
}: {
  pixels: Uint8Array
  poolRow: number
  participant: number
  label: number
  groupName: string
  groupColor: RGB
  traces: Traces
  playhead: Playhead
  trailPixels: number
  /** Whether this is the followed digit (rather than one hovered for a moment). */
  following: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    const accent = accentOf(canvas)
    const draw = () => {
      shadeDigit(img, pixels, poolRow, traces, playhead, trailPixels, accent)
      ctx.putImageData(img, 0, 0)
      const valence = valenceAt(traces, participant, playhead.moment)
      meterRef.current!.style.left = `${((valence + 1) / 2) * 100}%`
      readoutRef.current!.textContent = `${valence >= 0 ? '+' : '−'}${Math.abs(valence).toFixed(2)}`
    }
    draw()
    return playhead.onFrame(draw)
  }, [pixels, poolRow, participant, traces, playhead, playhead.loop, trailPixels])

  return (
    <div className="digit-preview">
      <canvas ref={ref} width={SIDE} height={SIDE} />
      <div className="digit-info">
        <div>
          <strong>{following ? 'Following' : 'Hovering'}</strong> a <strong>{label}</strong>
        </div>
        <div className="muted">
          group <span className="swatch" style={{ background: rgbCss(groupColor) }} /> {groupName}
        </div>
        <div className="valence-meter" aria-label="Valence now">
          <span className="valence-end">−1</span>
          <div className="valence-track">
            <div className="valence-zero" />
            <div className="valence-mark" ref={meterRef} />
          </div>
          <span className="valence-end">+1</span>
        </div>
        <div className="muted">
          valence <span ref={readoutRef} className="num" />
        </div>
      </div>
    </div>
  )
}
