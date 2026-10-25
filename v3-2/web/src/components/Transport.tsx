import { ChevronDown, ChevronUp, Pause, Play, SkipBack } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { Playhead } from '../playhead'
import { SIDE, type Traces } from '../signal'
import { Section, Slider, Toggle } from './controls'
import { Button } from './ui/button'
import { useSteadyRelease } from '../useSteadyRelease'
import { canWakeLock } from '../useWakeLock'

// Speed slider: logarithmic, 0.25–60 pixels per second.
const SPEED_MIN = 0.25
const SPEED_MAX = 60
const toSpeed = (u: number) => Number((SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** u).toPrecision(2))
const fromSpeed = (s: number) => Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** Play/pause, back to the start, the scrubber and the time; and a button to open or close the drawer it sits on. */
export function TransportBar({ playhead, traces, open, onOpen }: {
  playhead: Playhead
  traces: Traces
  /** Whether the drawer below is open. */
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const scrubRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubbing = useRef<{ wasPlaying: boolean } | null>(null)
  const steady = useSteadyRelease<number>()

  useEffect(() => {
    const update = () => {
      if (!scrubbing.current) scrubRef.current!.value = String(playhead.moment)
      timeRef.current!.textContent = `${clock(playhead.moment / playhead.speed)} / ${clock((traces.length - 1) / playhead.speed)}`
    }
    update()
    return playhead.onFrame(update)
  }, [playhead, traces, playhead.speed])

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="icon"
        className={cn('rounded-full', !playhead.playing && 'bg-go text-on-go hover:bg-go-hover')}
        onClick={() => playhead.setPlaying(!playhead.playing)}
        aria-label={playhead.playing ? 'Pause' : 'Play'}
      >
        {playhead.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => playhead.restart()} aria-label="Back to the start">
        <SkipBack />
      </Button>
      <input
        ref={scrubRef}
        className="h-8 min-w-0 flex-1 accent-highlight"
        type="range"
        min={0}
        max={traces.length - 1}
        step="any"
        aria-label="Moment"
        onPointerDown={(e) => {
          scrubbing.current = { wasPlaying: playhead.playing }
          steady.onPointerDown(e, playhead.moment)
          playhead.setPlaying(false)
        }}
        onPointerMove={steady.onPointerMove}
        onPointerUp={(e) => {
          const settled = steady.release(e)
          if (settled !== null) {
            playhead.seek(settled)
            scrubRef.current!.value = String(settled)
          }
          if (scrubbing.current?.wasPlaying) playhead.setPlaying(true)
          scrubbing.current = null
        }}
        onChange={(e) => {
          steady.noteValue(Number(e.target.value))
          playhead.seek(Number(e.target.value))
        }}
      />
      <span ref={timeRef} className="num shrink-0 text-xs text-muted-foreground" />
      <Button variant="ghost" size="icon-sm" onClick={() => onOpen(!open)} aria-label={open ? 'Hide settings' : 'Show settings'} aria-expanded={open}>
        {open ? <ChevronDown /> : <ChevronUp />}
      </Button>
    </div>
  )
}

/** Speed, how far trails reach, looping, keeping the screen awake, and where the playhead is in the digit's pixels. */
export function PlaybackSection({ playhead, traces, speed, onSpeed, loop, onLoop, trailSeconds, onTrailSeconds, wakeLock, onWakeLock }: {
  playhead: Playhead
  traces: Traces
  speed: number
  onSpeed: (speed: number) => void
  loop: boolean
  onLoop: (loop: boolean) => void
  trailSeconds: number
  onTrailSeconds: (seconds: number) => void
  wakeLock: boolean
  onWakeLock: (on: boolean) => void
}) {
  const readoutRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const update = () => {
      const t = Math.min(traces.length - 1, Math.round(playhead.moment))
      const p = traces.pixelAt[t]
      readoutRef.current!.textContent = `pixel ${t + 1} of ${traces.length} · row ${Math.floor(p / SIDE) + 1}, column ${(p % SIDE) + 1}`
    }
    update()
    return playhead.onFrame(update)
  }, [playhead, traces])

  return (
    <Section title="Playback" description="Each pixel read is one moment; trails cover the last few seconds and fade out with age.">
      <Slider label="speed" value={fromSpeed(speed)} min={0} max={1} step={0.001} onChange={(u) => onSpeed(toSpeed(u))} format={() => `${speed} px/s`} />
      <Slider label="trail" value={trailSeconds} min={5} max={300} step={5} onChange={onTrailSeconds} format={(v) => `${v} s`} />
      <Toggle label="loop" checked={loop} onChange={onLoop} />
      <Toggle
        label="keep screen awake"
        checked={canWakeLock && wakeLock}
        onChange={onWakeLock}
        disabled={!canWakeLock}
        note={canWakeLock ? undefined : window.isSecureContext ? 'not supported here' : 'requires https'}
      />
      <p ref={readoutRef} className="num text-xs text-muted-foreground" />
    </Section>
  )
}
