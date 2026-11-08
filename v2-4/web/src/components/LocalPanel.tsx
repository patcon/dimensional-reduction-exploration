import { Shuffle, Undo2 } from 'lucide-react'
import { farLong, farShort, LOW_SHARE, share, type FarState } from '../far'
import { BRUSH_RATIO_RANGE, clampBrushRatio, type LocalSettings } from '../settings'
import { cn } from '@/lib/utils'
import { Section, Slider, Toggle } from './controls'
import { Button } from './ui/button'

/** Redraws the far pairs now: on the forces tab above the far-pair slider, and in the local tab. */
export function ResampleButton({ onResample, far, compact, disabled }: { onResample: () => void; far: FarState; compact?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Button variant="outline" size="sm" className={cn(compact && 'h-7 px-2 text-xs')} onClick={onResample} disabled={disabled}>
        <Shuffle /> resample
      </Button>
      {compact && (
        <span className={cn('num text-[11px] text-muted-foreground', far.last && share(far.last) < LOW_SHARE && 'text-destructive')} title={farLong(far)}>
          {farShort(far)}
        </span>
      )}
    </div>
  )
}

interface Props {
  settings: LocalSettings
  onSettings: (s: LocalSettings) => void
  far: FarState
  onResample: () => void
  onRestore: () => void
  /** Off autopilot, redraw every settings.resampleEvery steps. */
  autoResample: boolean
  onAutoResample: (on: boolean) => void
  /** LocalMAP's neighbour boost; under autopilot, as autopilot has it. */
  boost: boolean
  onBoost: (on: boolean) => void
}


/** Threshold slider: 1 to 100 on a log scale. */
const toExp = (thres: number) => Math.log10(thres)
const fromExp = (e: number) => Number((10 ** e).toPrecision(2))

/** LocalMAP's additions to PaCMAP, each played on its own. */
export function LocalPanel({ settings, onSettings, far, onResample, onRestore, autoResample, onAutoResample, boost, onBoost }: Props) {
  const set = <K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) => onSettings({ ...settings, [key]: value })
  return (
    <div className="flex flex-col gap-8">
      <p className="text-xs text-muted-foreground">
        LocalMAP is PaCMAP with two additions in its last phase: every 10 iterations it redraws each digit's far pairs from the
        digits near it on the map that aren't its neighbours, pushing apart clusters that touch; and it pulls close neighbours
        harder. Autopilot, on the forces tab, plays either.
      </p>
      <Section title="Far pairs" description={farLong(far)}>
        <div className="flex flex-wrap items-start gap-2">
          <ResampleButton onResample={onResample} far={far} />
          <Button variant="outline" size="sm" onClick={onRestore} disabled={far.global}>
            <Undo2 /> restore global
          </Button>
        </div>
        {far.last && share(far.last) < LOW_SHARE && (
          <p className="text-xs text-destructive">
            Few found a partner near enough: the threshold may be small for how spread out the map is.
          </p>
        )}
        <Toggle
          label={`resample every ${settings.resampleEvery} steps`}
          checked={autoResample}
          onChange={onAutoResample}
          note="Off autopilot. LocalMAP's own redraws come every 10."
        />
        <Slider label="every" value={settings.resampleEvery} min={1} max={50} onChange={(v) => set('resampleEvery', v)} format={(v) => `${v} steps`} />
        <Slider
          label="threshold"
          value={toExp(settings.thres)}
          min={0}
          max={2}
          step={0.01}
          onChange={(e) => set('thres', fromExp(e))}
          format={() => String(settings.thres)}
          title="How near a far pair's partner must be, on the map, to be drawn. LocalMAP's is 10."
        />
        <Slider
          label="brush"
          value={settings.brushRatio}
          min={BRUSH_RATIO_RANGE[0]}
          max={BRUSH_RATIO_RANGE[1]}
          step={0.01}
          onChange={(r) => set('brushRatio', clampBrushRatio(r))}
          format={(r) => `${Math.round(r * 100)}%`}
          title="The brush's radius, as a share of the threshold: it paints the digits inside it, each drawing far partners from within the threshold of it. With the brush on, the wheel sets this too."
        />
      </Section>
      <Section title="Neighbours" description="LocalMAP's boost scales each neighbour pair's pull by (threshold / 2) / √(1 + distance²): five times as hard where they touch, at its threshold of 10, fading as they part.">
        <Toggle label="boost close neighbours" checked={boost} onChange={onBoost} />
      </Section>
    </div>
  )
}
