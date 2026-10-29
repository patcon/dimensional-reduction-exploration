import { use, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { GradientContext, gradientCss, rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import { accentOf, shadeDigit } from '../digitImage'
import { SIDE, valenceAt, type Traces } from '../signal'

/**
 * A digit, read as it plays: the clustering window is tinted, everything outside it is dimmed and the pixel being
 * read is marked. Clicking a pixel, or dragging across them, moves the playhead to where it's read, unless `onPress`
 * is given, which clicking calls instead.
 */
export function DigitImage({
  pixels,
  poolRow,
  against = null,
  traces,
  playhead,
  windowPixels,
  onPress,
  pressLabel,
  className,
  style,
}: {
  pixels: Uint8Array
  /** The digit, or null for none: just the clustering window, on a blank square. */
  poolRow: number | null
  /** The speaker's row, to show the digit's agreement with it rather than the digit itself, or null. */
  against?: number | null
  traces: Traces
  playhead: Playhead
  windowPixels: number
  onPress?: () => void
  /** What clicking does, with `onPress`. */
  pressLabel?: string
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gradient = use(GradientContext)
  /** While pressed: whether playback was going, to carry on once released (as the scrubber does). */
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null)

  const release = () => {
    if (scrubbing.current?.wasPlaying) playhead.setPlaying(true)
    scrubbing.current = null
  }
  /** Moves the playhead to the pixel under the pointer, unless it's one left out of the reading. */
  const seekTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const col = Math.min(SIDE - 1, Math.max(0, Math.floor((e.nativeEvent.offsetX / canvas.clientWidth) * SIDE)))
    const row = Math.min(SIDE - 1, Math.max(0, Math.floor((e.nativeEvent.offsetY / canvas.clientHeight) * SIDE)))
    const moment = traces.momentOf[row * SIDE + col]
    if (moment >= 0) playhead.seek(moment)
  }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    const accent = accentOf(canvas)
    const draw = () => {
      shadeDigit(img, pixels, poolRow, traces, playhead, windowPixels, accent, gradient, against)
      ctx.putImageData(img, 0, 0)
    }
    draw()
    return playhead.onFrame(draw)
  }, [pixels, poolRow, against, traces, playhead, windowPixels, gradient])

  if (onPress)
    return (
      <canvas
        ref={ref}
        className={cn('digit-image cursor-pointer!', className)}
        style={style}
        width={SIDE}
        height={SIDE}
        role="button"
        aria-label={pressLabel}
        title={pressLabel}
        onClick={onPress}
      />
    )

  return (
    <canvas
      ref={ref}
      className={cn('digit-image', className)}
      style={style}
      width={SIDE}
      height={SIDE}
      title="Click or drag to move the playhead to where a pixel is read"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        scrubbing.current = { wasPlaying: playhead.playing }
        playhead.setPlaying(false)
        seekTo(e)
      }}
      onPointerMove={(e) => {
        if (scrubbing.current) seekTo(e)
      }}
      onPointerUp={release}
      onPointerCancel={release}
    />
  )
}

/** The followed digit as it plays (see DigitImage) and, beside it, the valence it's reacting with right now. */
export function DigitPreview({
  pixels,
  poolRow,
  participant,
  label,
  groupName,
  groupColor,
  traces,
  playhead,
  windowPixels,
  following,
  heard = false,
  liveColor = null,
}: {
  pixels: Uint8Array
  poolRow: number
  participant: number
  label: number
  groupName: string
  groupColor: RGB
  traces: Traces
  playhead: Playhead
  windowPixels: number
  /** Whether this is the followed digit (rather than one hovered for a moment). */
  following: boolean
  /** Whether its valence is against a speaker, rather than its own ink. */
  heard?: boolean
  /** For a participant (rather than a digit), their colour. */
  liveColor?: RGB | null
}) {
  const meterRef = useRef<HTMLDivElement>(null)
  const gradient = use(GradientContext)
  const readoutRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const draw = () => {
      const valence = valenceAt(traces, participant, playhead.moment)
      meterRef.current!.style.left = `${((valence + 1) / 2) * 100}%`
      readoutRef.current!.textContent = `${valence >= 0 ? '+' : '−'}${Math.abs(valence).toFixed(2)}`
    }
    draw()
    return playhead.onFrame(draw)
  }, [participant, traces, playhead])

  return (
    <div className="digit-preview">
      <DigitImage
        pixels={pixels}
        poolRow={poolRow}
        traces={traces}
        playhead={playhead}
        windowPixels={windowPixels}
        style={liveColor ? { borderColor: rgbCss(liveColor) } : undefined}
      />
      <div className="digit-info">
        <div>
          <strong>{following ? 'Following' : 'Hovering'}</strong>{' '}
          {label < 0 ? (
            <>
              a <strong>participant</strong> <span className="swatch" style={{ background: rgbCss(liveColor ?? [255, 255, 255]) }} />
            </>
          ) : (
            <>
              a <strong>{label}</strong>
            </>
          )}
        </div>
        <div className="muted">
          group <span className="swatch" style={{ background: rgbCss(groupColor) }} /> {groupName}
        </div>
        <div className="valence-meter" aria-label="Valence now">
          <span className="valence-end">−1</span>
          <div className="valence-track" style={{ background: gradientCss(gradient) }}>
            <div className="valence-zero" />
            <div className="valence-mark" ref={meterRef} />
          </div>
          <span className="valence-end">+1</span>
        </div>
        <div className="muted">
          valence{heard && ' against the speaker'} <span ref={readoutRef} className="num" />
        </div>
      </div>
    </div>
  )
}
