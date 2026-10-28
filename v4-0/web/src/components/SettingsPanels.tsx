import { Blend, RotateCcw, Shuffle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { DIGIT_COLORS } from '../palette'
import type { SettingsEditor } from '../presets'
import { N_DIGITS, type Grouping } from '../selection'
import { N_PIXELS, READING_LABELS, type ReadingKey } from '../signal'
import { ELEMENTS, GEO_MODES, VIEW_LABELS, type Element, type ViewMode } from '../vizSettings'
import { Field, Section, Segmented, Slider, Toggle } from './controls'
import { Button } from './ui/button'
import { GeometryIcon } from './GeometryIcons'
import { ViewIcon } from './ViewIcons'
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

const VIEWS = ['2d', '2d-ts', '3d'] as const
/** Each view's icon, as on the view button over the visualiser. */
const VIEW_ICONS = { '2d': <ViewIcon view="2d" />, '2d-ts': <ViewIcon view="2d-ts" />, '3d': <ViewIcon view="3d" /> }
/** Each geometry's icon, as on the geometry button over the visualiser. */
const GEO_ICONS = Object.fromEntries(GEO_MODES.map((g) => [g, <GeometryIcon key={g} geometry={g} />]))

/** The visualiser's view and geometry. Choosing the view already shown resets the camera. */
export function ViewSection({ settings, set, onView }: SettingsEditor & { onView: (view: ViewMode) => void }) {
  return (
    <Section title="View" description="Drag to orbit (3d) or pan, pinch or scroll to zoom, tap a digit to follow it.">
      <Field label="view" stacked>
        <Segmented options={VIEWS} value={settings.view} onChange={onView} labels={VIEW_LABELS} icons={VIEW_ICONS} />
      </Field>
      <Field label="geometry" stacked>
        <Segmented options={GEO_MODES} value={settings.geometry} onChange={(v) => set('geometry', v)} icons={GEO_ICONS} />
      </Field>
      <div>
        <Button variant="outline" size="sm" onClick={() => onView(settings.view)}>
          <RotateCcw /> Reset camera
        </Button>
      </div>
    </Section>
  )
}

/** Size, as three circles growing left to right, drawn as lucide's icons are (24 units, 2-unit strokes, round caps). */
function SizeIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <circle cx="2" cy="15" r="1" />
      <circle cx="8.75" cy="13.75" r="2.25" />
      <circle cx="18.25" cy="12.25" r="3.75" />
    </svg>
  )
}

/** Each element's size setting, where it has one: its key in the style, and its range (its step also sets the decimal places shown). */
const SIZES: Partial<Record<Element, { key: 'cursorSize' | 'chordWidth' | 'traceWidth'; label: string; min: number; max: number; step: number }>> = {
  cursor: { key: 'cursorSize', label: 'cursor size', min: 2, max: 30, step: 1 },
  chord: { key: 'chordWidth', label: 'chord width', min: 0.5, max: 10, step: 0.5 },
  trace: { key: 'traceWidth', label: 'trace width', min: 0.5, max: 10, step: 0.5 },
}

/**
 * A row per element: what it's coloured by (a button that switches between the two), its opacity and its size. The
 * readouts on the right all show opacity or all show size, whichever kind of slider was touched last, as the icon
 * at the column's top says. Rows for what isn't drawn now are greyed out: the trace and fill in the time slice, which
 * has no depth, and the chord and fill in the particle geometry.
 */
export function StyleSection({ settings, patch }: SettingsEditor) {
  const { style } = settings
  const [shown, setShown] = useState<'opacity' | 'size'>('opacity')
  const hidden = new Set<Element>([...(settings.view === '2d' ? ['trace', 'fill'] as const : []), ...(settings.geometry === 'particle' ? ['chord', 'fill'] as const : [])])
  return (
    <Section title="Style">
      <div className="grid grid-cols-[3rem_auto_1fr_1fr_2.5rem] items-center gap-x-2.5 gap-y-2 text-sm">
        <span />
        <span className="text-xs text-muted-foreground">colour by</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Blend className="size-3.5" aria-hidden /> opacity
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <SizeIcon className="size-3.5" aria-hidden /> size
        </span>
        <span className="flex justify-end text-muted-foreground" title={`Showing ${shown}`}>
          {shown === 'size' ? <SizeIcon className="size-3.5" aria-label="showing size" /> : <Blend className="size-3.5" aria-label="showing opacity" />}
        </span>
        {ELEMENTS.map((el) => {
          const size = SIZES[el]
          const off = hidden.has(el)
          return (
            <div key={el} className="contents" title={off ? `No ${el} is drawn in this view` : undefined}>
              {/* The button and sliders dim themselves when disabled; the label and readout dim to match. */}
              <span className={cn('text-muted-foreground', off && 'opacity-50')}>{el}</span>
              {/* One button, showing what it's coloured by now; a press switches to the other. */}
              <Button
                variant="outline"
                size="sm"
                className="w-18"
                disabled={off}
                aria-label={`${el} coloured by ${style.colorBy[el]}; switch to ${style.colorBy[el] === 'valence' ? 'group' : 'valence'}`}
                onClick={() => patch('style', { colorBy: { ...style.colorBy, [el]: style.colorBy[el] === 'valence' ? 'group' : 'valence' } })}
              >
                {style.colorBy[el]}
              </Button>
              <SliderBase
                aria-label={`${el} opacity`}
                value={[style.opacity[el]]}
                min={0}
                max={1}
                step={0.05}
                disabled={off}
                onPointerDown={() => setShown('opacity')}
                onFocus={() => setShown('opacity')}
                onValueChange={([v]) => patch('style', { opacity: { ...style.opacity, [el]: v } })}
              />
              {size ? (
                <SliderBase
                  aria-label={size.label}
                  value={[style[size.key]]}
                  min={size.min}
                  max={size.max}
                  step={size.step}
                  disabled={off}
                  onPointerDown={() => setShown('size')}
                  onFocus={() => setShown('size')}
                  onValueChange={([v]) => patch('style', { [size.key]: v })}
                />
              ) : (
                <span />
              )}
              <span className={cn('num text-right text-xs', off && 'opacity-50')}>
                {shown === 'opacity' ? style.opacity[el].toFixed(2) : size ? style[size.key].toFixed(size.step < 1 ? 1 : 0) : <span className="text-muted-foreground">–</span>}
              </span>
            </div>
          )
        })}
      </div>
      <Toggle label="ring the followed digit" checked={style.focusRing} onChange={(on) => patch('style', { focusRing: on })} />
    </Section>
  )
}

/** The particle geometry's forces, and a button to scatter the particles afresh. The centre only pulls with a speaker there. */
export function ParticleSection({ settings, patch, onScatter }: SettingsEditor & { onScatter: () => void }) {
  const { particles, speaker } = settings
  const unheard = speaker === null ? 'With no speaker, nothing at the centre pulls.' : undefined
  const byNeighbours = particles.forces === 'neighbours'
  return (
    <Section
      title="Particles"
      description={
        (byNeighbours
          ? 'Each digit is pulled towards the digits it counts among its nearest neighbours, which needn\'t count it back.'
          : 'Groups pull together.') +
        ' With a speaker, it sits at the centre, pulling in the digits agreeing with it now and pushing out those disagreeing.'
      }
    >
      <Field label="forces">
        <Segmented options={['groups', 'neighbours'] as const} value={particles.forces} onChange={(v) => patch('particles', { forces: v })} />
      </Field>
      <Slider
        label={byNeighbours ? 'neighbours' : 'within groups'}
        value={particles.cohesion}
        min={-1}
        max={1}
        step={0.05}
        onChange={(v) => patch('particles', { cohesion: v })}
        format={fixed(2)}
      />
      <Slider
        label={byNeighbours ? 'others' : 'between groups'}
        value={particles.separation}
        min={-1}
        max={1}
        step={0.05}
        onChange={(v) => patch('particles', { separation: v })}
        format={fixed(2)}
      />
      {byNeighbours && (
        <Toggle
          label="one-way neighbours"
          checked={particles.oneWay}
          onChange={(on) => patch('particles', { oneWay: on })}
          note={particles.oneWay ? undefined : 'Symmetrised as Leiden sees them, so forces are equal both ways.'}
        />
      )}
      <Slider label="speaker" value={particles.centreForce} min={0} max={6} step={0.1} onChange={(v) => patch('particles', { centreForce: v })} format={fixed(1)} title={unheard} />
      <Slider label="spread" value={particles.spread} min={0.2} max={1.5} step={0.05} onChange={(v) => patch('particles', { spread: v })} format={fixed(2)} />
      <Slider label="reach" value={particles.radius} min={10} max={150} onChange={(v) => patch('particles', { radius: v })} format={fixed(0)} />
      <Slider label="damping" value={particles.damping} min={0.5} max={0.99} step={0.01} onChange={(v) => patch('particles', { damping: v })} format={fixed(2)} />
      <Toggle
        label="agreement repels from speaker"
        checked={particles.reverseCentre}
        onChange={(on) => patch('particles', { reverseCentre: on })}
        disabled={speaker === null}
        note={unheard}
      />
      <div>
        <Button variant="outline" size="sm" onClick={onScatter}>
          <Sparkles /> Scatter
        </Button>
      </div>
    </Section>
  )
}
