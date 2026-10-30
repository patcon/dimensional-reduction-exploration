import { Shuffle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { unlockAudio } from '../audio'
import { DIGIT_COLORS, rgbCss } from '../palette'
import { CHORD_NAMES, chordSize, TONE_NAMES, type MusicWalk } from '../music'
import type { Playhead } from '../playhead'
import type { SettingsEditor } from '../presets'
import { N_DIGITS } from '../selection'
import type { Traces } from '../signal'
import { Section, Slider, Toggle } from './controls'
import { DigitImage } from './DigitPreview'
import { Button } from './ui/button'

/** Small groups' resolution runs on a log scale, slider 0–1. */
const FINE_RANGE = [0.5, 20]
const toFine = (u: number) => Math.round(FINE_RANGE[0] * Math.pow(FINE_RANGE[1] / FINE_RANGE[0], u) * 100) / 100
const fromFine = (r: number) => Math.log(r / FINE_RANGE[0]) / Math.log(FINE_RANGE[1] / FINE_RANGE[0])
const percent = (v: number) => `${Math.round(v * 100)}%`
/** Noise, in the broad groups' bars. */
const NOISE_COLOR = 'var(--muted-foreground)'

/** The walk's music: what the walker is on and playing, the broad groups it's harmonised by, and their settings. */
export function MusicPanel({ settings, set, patch, walk, pixels, rows, labels, traces, playhead, windowPixels }: SettingsEditor & {
  walk: MusicWalk
  pixels: Uint8Array
  /** The visualiser's rows, digits and participants. */
  rows: number[]
  labels: number[]
  traces: Traces
  playhead: Playhead
  windowPixels: number
}) {
  const { window: w, node, tone } = useSyncExternalStore(walk.subscribe, walk.getSnapshot)
  const music = settings.music
  const on = settings.musicOn
  const current = w && w.rows === rows ? w : null
  const tones = chordSize(current?.broadCount ?? 0)
  const here = current && node !== null && node < rows.length ? node : null

  // Each broad group's digits, by label (participants as their own), and noise last.
  const contents = current
    ? [...Array.from({ length: current.broadCount }, (_, c) => c), -1].flatMap((c) => {
        const counts = new Array<number>(N_DIGITS + 1).fill(0)
        current.broad.forEach((g, i) => g === c && counts[labels[rows[i]] < 0 ? N_DIGITS : labels[rows[i]]]++)
        const size = counts.reduce((a, b) => a + b, 0)
        return size ? [{ group: c, counts, size }] : []
      })
    : []
  const largest = Math.max(1, ...contents.map((g) => g.size))

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Music"
        description="A walker steps at random through the digits' nearest neighbours, as they are over the window, ringed in white on the visualiser. Broad groups set the chord, and the bass follows the walker's; small groups set the melody. Tap a digit to move the walker to it."
      >
        <Toggle label="music" checked={on} onChange={(v) => {
            unlockAudio()
            set('musicOn', v)
          }} note="on this screen only; plays while paused too" />
        {on && (
          <div className="flex items-center gap-3">
            <DigitImage
              pixels={pixels}
              poolRow={here === null ? null : rows[here]}
              traces={traces}
              playhead={playhead}
              windowPixels={windowPixels}
              className="size-14 rounded-sm"
            />
            <p className="text-sm text-muted-foreground">
              {!current ? (
                'Finding the window’s groups…'
              ) : !current.rows.length ? (
                'No digits or participants: keeping time with a metronome.'
              ) : current.broadCount === 0 ? (
                'Every digit is left as noise, so there are no groups to harmonise: keeping time with a metronome.'
              ) : here === null ? (
                'The walk starts with the first press on the page.'
              ) : (
                <>
                  On {labels[rows[here]] < 0 ? 'a participant' : <>a <strong className="text-foreground">{labels[rows[here]]}</strong></>}
                  {current.broad[here] < 0 ? (
                    <>, left as <strong className="text-foreground">noise</strong>: the bass drops out and the melody plays softly</>
                  ) : (
                    <>, in broad group <strong className="text-foreground">{current.broad[here] + 1}</strong></>
                  )}
                  , small group {current.fine[here] + 1} of {current.fineCount}.
                </>
              )}
            </p>
          </div>
        )}
      </Section>

      {on && current && (
        <Section title="Harmony" description="One chord tone per broad group: the walker's is louder, and the bass plays it.">
          <div className="flex items-baseline gap-2">
            <strong className="num text-3xl leading-none">{current.broadCount}</strong>
            <span className="text-sm text-muted-foreground">
              broad group{current.broadCount === 1 ? '' : 's'}: {current.broadCount ? CHORD_NAMES[tones - 1] : 'a metronome, no chord'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Chord tones">
            {TONE_NAMES.slice(0, current.broadCount ? tones : 0).map((name, i) => (
              <span
                key={name}
                className={cn(
                  'num min-w-8 rounded-md border px-1.5 py-0.5 text-center text-xs text-muted-foreground',
                  here !== null && current.broad[here] >= 0 && current.broad[here] % TONE_NAMES.length === i && 'border-foreground text-foreground',
                  i === tone && 'bg-foreground text-background',
                )}
              >
                {name}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {contents.map(({ group, counts, size }) => (
              <div key={group} className="grid grid-cols-[3.5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
                <span className="num">
                  {group < 0 ? 'noise' : group + 1} · {size}
                </span>
                <div className="flex h-3.5 overflow-hidden rounded-sm" style={{ width: `${Math.max(6, (100 * size) / largest)}%` }}>
                  {counts.map((count, d) =>
                    count ? (
                      <span
                        key={d}
                        className="h-full text-center text-[10px] leading-3.5 text-white"
                        style={{ width: `${(100 * count) / size}%`, background: group < 0 ? NOISE_COLOR : d < N_DIGITS ? DIGIT_COLORS[d] : rgbCss([235, 235, 235]) }}
                        title={`${d < N_DIGITS ? `digit ${d}` : 'participants'}: ${count}`}
                      >
                        {count / size > 0.12 && d < N_DIGITS ? d : ''}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="self-start" onClick={() => walk.jumpGroup()}>
            <Shuffle /> jump to another group
          </Button>
        </Section>
      )}

      <Section
        title="Broad groups: HDBSCAN on UMAP"
        description="The window is embedded by UMAP, then HDBSCAN finds its dense regions, deciding how many groups there are itself and leaving stragglers as noise."
      >
        <Slider label="min group size" value={music.minClusterSize} min={2} max={60} onChange={(v) => patch('music', { minClusterSize: v })} title="The smallest group worth calling a broad group" />
        <Slider label="min samples" value={music.minSamples} min={1} max={30} onChange={(v) => patch('music', { minSamples: v })} title="How conservative it is: higher leaves more digits as noise" />
        <Toggle label="allow one group" checked={music.allowSingle} onChange={(v) => patch('music', { allowSingle: v })} note="otherwise it always splits, or leaves everything as noise" />
      </Section>

      <Section title="Small groups: the melody" description="Leiden at a high resolution on the same neighbours; each small group is given a note of the chord.">
        <Slider label="neighbours" value={music.neighbours} min={2} max={50} onChange={(v) => patch('music', { neighbours: v })} title="For the walk, the small groups and UMAP alike" />
        <Slider label="resolution" value={fromFine(music.fineResolution)} min={0} max={1} step={0.001} onChange={(u) => patch('music', { fineResolution: toFine(u) })} format={() => music.fineResolution.toFixed(2)} />
        <Slider label="steps / s" value={music.stepsPerSecond} min={2} max={16} onChange={(v) => patch('music', { stepsPerSecond: v })} />
        <Toggle label="swing" checked={music.swing} onChange={(v) => patch('music', { swing: v })} />
      </Section>

      <Section title="Mix">
        <Slider label="chord" value={music.chord} min={0} max={1} step={0.01} onChange={(v) => patch('music', { chord: v })} format={percent} />
        <Slider label="bass" value={music.bass} min={0} max={1} step={0.01} onChange={(v) => patch('music', { bass: v })} format={percent} />
        <Slider label="melody" value={music.melody} min={0} max={1} step={0.01} onChange={(v) => patch('music', { melody: v })} format={percent} />
      </Section>
    </div>
  )
}
