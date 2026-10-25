import { RotateCcw, Shuffle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DIGIT_COLORS } from '../palette'
import type { SettingsEditor } from '../presets'
import { N_DIGITS, type Grouping } from '../selection'
import { N_PIXELS, READING_LABELS, type ReadingKey } from '../signal'
import { ELEMENTS, GEO_MODES, VIEW_LABELS, type ViewMode } from '../vizSettings'
import { Field, Section, Segmented, Slider, Toggle } from './controls'
import { Button } from './ui/button'
import { Slider as SliderBase } from './ui/slider'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const fixed = (places: number) => (v: number) => v.toFixed(places)

/**
 * Which digit labels take part, one toggle each, and a button to choose them all. `compact`, it's small and
 * dark to sit over the visualiser, with "*" for all, or once all are chosen, "∅" to clear them for picking afresh.
 */
export function DigitPicker({ digits, onDigits, compact = false }: { digits: number[]; onDigits: (digits: number[]) => void; compact?: boolean }) {
  // At least one label stays chosen.
  const setDigits = (values: string[]) => values.length && onDigits(values.map(Number).sort((a, b) => a - b))
  const all = () => onDigits(Array.from({ length: N_DIGITS }, (_, d) => d))
  const allChosen = digits.length === N_DIGITS
  return (
    <div className={cn('flex flex-wrap items-center', compact ? 'gap-1' : 'gap-2')}>
      <ToggleGroup
        type="multiple"
        value={digits.map(String)}
        onValueChange={setDigits}
        aria-label="Digit labels"
        className={cn(compact && 'border-white/20 bg-black/50 shadow-none')}
      >
        {Array.from({ length: N_DIGITS }, (_, d) => (
          <ToggleGroupItem
            key={d}
            value={String(d)}
            className={cn(
              'num data-[state=on]:shadow-[inset_0_-3px_0_var(--digit)]',
              compact
                ? 'h-7 min-w-[1.375rem] border-white/20 px-1 data-[state=off]:text-white/55 hover:bg-white/15 hover:text-white data-[state=on]:bg-white/90 data-[state=on]:text-black'
                : 'min-w-7 px-1.5 data-[state=off]:text-muted-foreground',
            )}
            style={{ '--digit': DIGIT_COLORS[d] } as React.CSSProperties}
          >
            {d}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {compact ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 min-w-6 bg-black/50 px-1.5 text-white/80 hover:bg-black/70 hover:text-white"
          onClick={allChosen ? () => onDigits([]) : all}
          aria-label={allChosen ? 'No digits' : 'All digits'}
          title={allChosen ? 'No digits' : 'All digits'}
        >
          {allChosen ? '∅' : '*'}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={all}>
          all
        </Button>
      )}
    </div>
  )
}

/** Which digits take part, and how many of them. */
export function SampleSection({ settings, set, available, shownCount, maxCount }: SettingsEditor & {
  /** Digits of the chosen labels in the pool. */
  available: number
  shownCount: number
  maxCount: number
}) {
  return (
    <Section title="Digits" description="Each digit is one participant; pick which labels take part, and how many of them.">
      <DigitPicker digits={settings.digits} onDigits={(v) => set('digits', v)} />
      <Slider label="sample" value={shownCount} min={2} max={maxCount} onChange={(v) => set('count', v)} format={(v) => `${v} of ${available}`} />
      <div>
        <Button variant="outline" size="sm" onClick={() => set('seed', settings.seed + 1)} title="Pick another sample of these digits">
          <Shuffle /> Reshuffle
        </Button>
      </div>
    </Section>
  )
}

/** How each digit's pixels are read out as valence. */
export function ReadingSection({ settings, patch }: SettingsEditor) {
  const { signal } = settings
  return (
    <Section title="Reading" description="How a digit's pixels, read in order, become its valence over time.">
      <Field label="pixel order" stacked>
        <Segmented options={Object.keys(READING_LABELS) as ReadingKey[]} value={signal.reading} onChange={(v) => patch('signal', { reading: v })} labels={READING_LABELS} />
      </Field>
      <Toggle label="skip pixels blank in every digit" checked={signal.skipBlank} onChange={(on) => patch('signal', { skipBlank: on })} />
      <Field label="smoothing">
        <Segmented options={['blur', 'lag'] as const} value={signal.smoothing} onChange={(v) => patch('signal', { smoothing: v })} />
      </Field>
      <Slider
        label="amount"
        value={signal.smoothingPixels}
        min={0}
        max={8}
        step={0.25}
        onChange={(v) => patch('signal', { smoothingPixels: v })}
        format={(v) => `${v} px`}
      />
      <Field label="valence">
        <Segmented
          options={['ink', 'ink-only'] as const}
          value={signal.mapping}
          onChange={(v) => patch('signal', { mapping: v })}
          labels={{ ink: 'paper −1, ink +1', 'ink-only': 'paper 0, ink +1' }}
        />
      </Field>
    </Section>
  )
}

/** How digits are grouped (by label or Leiden cluster), and the order their chords sit in. */
export function GroupingSection({ settings, set, grouping }: SettingsEditor & { grouping: Grouping }) {
  const { groupBy, resolution, neighbours, clusterOver, clusterRate, windowPixels, order } = settings
  return (
    <Section title="Grouping">
      <Field label="group by">
        <Segmented options={['digit', 'leiden'] as const} value={groupBy} onChange={(v) => set('groupBy', v)} labels={{ digit: 'Label', leiden: 'Leiden' }} />
      </Field>
      {groupBy === 'leiden' && (
        <>
          <Slider label="resolution" value={resolution} min={0.1} max={3} step={0.1} onChange={(v) => set('resolution', v)} format={fixed(1)} />
          <Slider label="neighbours" value={neighbours} min={3} max={30} onChange={(v) => set('neighbours', v)} />
          <Field label="cluster over">
            <Segmented options={['full', 'window'] as const} value={clusterOver} onChange={(v) => set('clusterOver', v)} labels={{ full: 'full digit', window: 'window' }} />
          </Field>
          {clusterOver === 'window' && (
            <Slider
              label="re-cluster"
              title="How often to re-cluster over the window while playing"
              value={clusterRate}
              min={0.25}
              max={10}
              step={0.25}
              onChange={(v) => set('clusterRate', v)}
              format={(v) => `${v} /s`}
            />
          )}
          <p className="num text-xs text-muted-foreground">
            {grouping.groups.length} clusters · modularity {grouping.modularity?.toFixed(2)}
          </p>
        </>
      )}
      <Slider
        label="window"
        title="The stretch of each digit's reading, back from the playhead, that clustering over a window compares and the digit images shade"
        value={windowPixels}
        min={8}
        max={N_PIXELS}
        step={4}
        onChange={(v) => set('windowPixels', v)}
        format={(v) => `${v} px`}
      />
      <Field label="chord order">
        <Segmented options={['random', 'grouped'] as const} value={order} onChange={(v) => set('order', v)} />
      </Field>
    </Section>
  )
}

/** The visualiser's view and geometry. Choosing the view already shown resets the camera. */
export function ViewSection({ settings, set, onView }: SettingsEditor & { onView: (view: ViewMode) => void }) {
  return (
    <Section title="View" description="Drag to orbit (3d) or pan, pinch or scroll to zoom, tap a digit to follow it.">
      <Field label="view" stacked>
        <Segmented options={['2d', '2d-ts', '3d'] as const} value={settings.view} onChange={onView} labels={VIEW_LABELS} />
      </Field>
      <Field label="geometry" stacked>
        <Segmented options={GEO_MODES} value={settings.geometry} onChange={(v) => set('geometry', v)} />
      </Field>
      <div>
        <Button variant="outline" size="sm" onClick={() => onView(settings.view)}>
          <RotateCcw /> Reset camera
        </Button>
      </div>
    </Section>
  )
}

/** What each element is coloured by, its opacity, and the sizes of cursors, chords and traces. */
export function StyleSection({ settings, patch }: SettingsEditor) {
  const { style } = settings
  return (
    <Section title="Style">
      <div className="grid grid-cols-[3.5rem_auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <span />
        <span className="text-xs text-muted-foreground">colour by</span>
        <span className="text-xs text-muted-foreground">opacity</span>
        {ELEMENTS.map((el) => (
          <div key={el} className="contents">
            <span className="text-muted-foreground">{el}</span>
            <Segmented options={['valence', 'group'] as const} value={style.colorBy[el]} onChange={(by) => patch('style', { colorBy: { ...style.colorBy, [el]: by } })} />
            <div className="flex items-center gap-2">
              <SliderBase
                aria-label={`${el} opacity`}
                value={[style.opacity[el]]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) => patch('style', { opacity: { ...style.opacity, [el]: v } })}
              />
              <span className="num w-8 text-right text-xs">{style.opacity[el].toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      <Slider label="cursor size" value={style.cursorSize} min={2} max={30} onChange={(v) => patch('style', { cursorSize: v })} />
      <Slider label="chord width" value={style.chordWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { chordWidth: v })} format={(v) => `${v} px`} />
      <Slider label="trace width" value={style.traceWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { traceWidth: v })} />
      <Toggle label="ring the followed digit" checked={style.focusRing} onChange={(on) => patch('style', { focusRing: on })} />
    </Section>
  )
}

/** The particle geometry's forces, and a button to scatter the particles afresh. */
export function ParticleSection({ settings, patch, onScatter }: SettingsEditor & { onScatter: () => void }) {
  const { particles } = settings
  return (
    <Section title="Particles" description="Groups pull together; the centre pulls ink in and pushes paper out, by each digit's valence now.">
      <Slider label="within groups" value={particles.cohesion} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { cohesion: v })} format={fixed(2)} />
      <Slider label="between groups" value={particles.separation} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { separation: v })} format={fixed(2)} />
      <Slider label="centre" value={particles.centreForce} min={0} max={6} step={0.1} onChange={(v) => patch('particles', { centreForce: v })} format={fixed(1)} />
      <Slider label="spread" value={particles.spread} min={0.2} max={1.5} step={0.05} onChange={(v) => patch('particles', { spread: v })} format={fixed(2)} />
      <Slider label="reach" value={particles.radius} min={10} max={150} onChange={(v) => patch('particles', { radius: v })} format={fixed(0)} />
      <Slider label="damping" value={particles.damping} min={0.5} max={0.99} step={0.01} onChange={(v) => patch('particles', { damping: v })} format={fixed(2)} />
      <Toggle label="ink repels from centre" checked={particles.reverseCentre} onChange={(on) => patch('particles', { reverseCentre: on })} />
      <div>
        <Button variant="outline" size="sm" onClick={onScatter}>
          <Sparkles /> Scatter
        </Button>
      </div>
    </Section>
  )
}
