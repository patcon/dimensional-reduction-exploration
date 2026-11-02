import { Pause, Play, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Dim, Schedule } from '../types'
import type { ClockStatus } from '../useLoopClock'
import { SAMPLE_SIZES, type SampleSize } from '../useData'
import { canWakeLock } from '../useWakeLock'
import { Field, Section, Segmented, Slider, Toggle } from './controls'
import { Button } from './ui/button'

interface BarProps {
  status: ClockStatus
  playhead: number
  schedule: Schedule
  length: number
  phase: 1 | 2 | 3
  steps: number
  autopilot: boolean
  onPause: () => void
  onResume: () => void
  onReset: () => void
  loading: boolean
  loadError?: string
  size: SampleSize
  /** At the bar's end (the drawer's open button, say). */
  children?: ReactNode
}

/** Play/pause, reset, and where the loop is up to in PaCMAP's schedule, phase by phase. */
export function TransportBar(p: BarProps) {
  const stopped = p.status === 'paused' || p.status === 'ended'
  const start = stopped && p.steps === 0
  const [p1, p2] = p.schedule.phases
  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="icon"
        className={cn('rounded-full', stopped && 'bg-go text-on-go hover:bg-go-hover')}
        onClick={stopped ? p.onResume : p.onPause}
        // Resuming a finished autopilot run would only replay it; that's what reset is for.
        disabled={stopped ? p.status === 'ended' && p.autopilot : p.status === 'idle'}
        aria-label={start ? 'Start simulation' : stopped ? 'Resume' : 'Pause'}
      >
        {stopped || p.status === 'idle' ? <Play className="fill-current" /> : <Pause className="fill-current" />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={p.onReset} disabled={p.steps === 0} aria-label="Reset to the initial layout">
        <RotateCcw />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The schedule's three phases, filled as far as the playhead. */}
        <div className="flex h-1.5 gap-0.5" aria-hidden>
          {[
            [0, p1],
            [p1, p1 + p2],
            [p1 + p2, p.length],
          ].map(([a, b]) => (
            <div key={a} className="relative overflow-hidden rounded-full bg-muted" style={{ flex: b - a }}>
              <div className="absolute inset-y-0 left-0 bg-highlight" style={{ width: `${(Math.min(Math.max(p.playhead - a, 0), b - a) / (b - a)) * 100}%` }} />
            </div>
          ))}
        </div>
        <span className="num truncate text-xs text-muted-foreground">
          {p.loadError ? (
            <strong>{p.loadError}</strong>
          ) : p.loading ? (
            <strong>Loading {p.size} digits…</strong>
          ) : p.status === 'idle' ? (
            <strong>Move a force to start</strong>
          ) : start ? (
            <strong>Press play to watch PaCMAP's own run</strong>
          ) : p.status === 'ended' && p.autopilot ? (
            <strong>Autopilot finished: reset to replay, or go manual to carry on</strong>
          ) : (
            <>
              iteration {p.playhead} / {p.length} · phase {p.phase} · {p.steps} steps
              {p.status === 'paused' && ' · paused'}
            </>
          )}
        </span>
      </div>
      {p.children}
    </div>
  )
}

/** How fast the loop steps, whether it glides between steps, and keeping the screen awake. */
export function PlaySection({ rate, onRate, interpolate, onInterpolate, wakeLock, onWakeLock }: {
  rate: number
  onRate: (rate: number) => void
  interpolate: boolean
  onInterpolate: (on: boolean) => void
  wakeLock: boolean
  onWakeLock: (on: boolean) => void
}) {
  return (
    <Section title="Playback" description="Each step is one iteration of PaCMAP's 450-iteration schedule, which loops in manual.">
      <Slider label="rate" value={rate} min={1} max={60} onChange={onRate} format={(v) => `${v} it/s`} />
      <Toggle label="smooth: glide between steps (one step behind)" checked={interpolate} onChange={onInterpolate} />
      <Toggle
        label="keep screen awake"
        checked={canWakeLock && wakeLock}
        onChange={onWakeLock}
        disabled={!canWakeLock}
        note={canWakeLock ? undefined : window.isSecureContext ? 'not supported here' : 'requires https'}
      />
    </Section>
  )
}

/** 2D or 3D, spinning in 3D, and how many digits. */
export function ViewSection(p: {
  dim: Dim
  /** Switching dimension starts over from that dimension's initial layout. */
  onDim: (dim: Dim) => void
  autoRotate: boolean
  onAutoRotate: (on: boolean) => void
  /** How many digits; switching starts over on the new ones once they've loaded. */
  size: SampleSize
  onSize: (size: SampleSize) => void
}) {
  return (
    <Section title="Layout" description="Switching dimension or digits starts over from the initial layout.">
      <Field label="dimensions">
        <Segmented
          options={['2', '3'] as const}
          value={String(p.dim) as '2' | '3'}
          onChange={(d) => Number(d) !== p.dim && p.onDim(Number(d) as Dim)}
          labels={{ 2: '2D', 3: '3D' }}
        />
      </Field>
      <Field label="digits" title="How many MNIST digits, each its own random sample">
        <Segmented options={SAMPLE_SIZES} value={p.size} onChange={(size) => size !== p.size && p.onSize(size)} />
      </Field>
      <Toggle label="auto-rotate" checked={p.autoRotate} onChange={p.onAutoRotate} disabled={p.dim !== 3} note={p.dim !== 3 ? 'in 3D only' : undefined} />
    </Section>
  )
}
