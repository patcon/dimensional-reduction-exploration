import { useEffect, useRef } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import { N_PIXELS, SIDE, valenceAt, type Traces } from '../signal'

/**
 * The followed digit, read as it plays: pixels already read show in full, those still to come
 * are dimmed, the trail's reach is tinted and the pixel being read is marked; beside it, the
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
    const accent = getComputedStyle(canvas).color.match(/\d+/g)!.map(Number)
    const draw = () => {
      const now = playhead.moment
      const head = Math.round(now)
      for (let p = 0; p < N_PIXELS; p++) {
        const v = pixels[poolRow * N_PIXELS + p]
        const m = traces.momentOf[p]
        // Skipped (blank everywhere) or still to come: dim. In the trail: tinted. The head: the accent.
        let rgb = [v, v, v]
        if (m < 0 || m > now) rgb = rgb.map((c) => c * 0.22 + 10)
        else if (m >= now - trailPixels) rgb = rgb.map((c, i) => c * 0.7 + accent[i] * 0.3)
        if (m === head) rgb = accent
        img.data.set([rgb[0], rgb[1], rgb[2], 255], p * 4)
      }
      ctx.putImageData(img, 0, 0)
      const valence = valenceAt(traces, participant, now)
      meterRef.current!.style.left = `${((valence + 1) / 2) * 100}%`
      readoutRef.current!.textContent = `${valence >= 0 ? '+' : '−'}${Math.abs(valence).toFixed(2)}`
    }
    draw()
    return playhead.onFrame(draw)
  }, [pixels, poolRow, participant, traces, playhead, trailPixels])

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
