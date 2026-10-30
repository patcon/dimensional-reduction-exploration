import { Shuffle } from 'lucide-react'
import { useMemo } from 'react'
import { adjustedRand, type MapMusic } from '../analysis'
import { CHORD_NAMES, chordSize, TONE_NAMES, type MusicWalk, type WalkSnapshot } from '../music'
import { broadColor, DIGIT_COLORS, rgbCss } from '../palette'
import { MAX_TARGET, METHOD_LABELS, N_DIGITS, targetOf, type Method, type Settings } from '../settings'
import { Section, Segmented, Slider, Toggle } from './controls'
import { DigitThumb } from './DigitThumb'
import { HarmonyStrip } from './HarmonyStrip'
import { Button } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export interface SettingsEditor {
  settings: Settings
  patch: (changes: Partial<Settings>) => void
}

/** Log-scale sliders, 0–1: small groups' resolution, and Leiden's broad groups' set by hand. */
const logScale = (lo: number, hi: number) => ({
  to: (u: number) => Number((lo * Math.pow(hi / lo, u)).toPrecision(3)),
  from: (r: number) => Math.log(r / lo) / Math.log(hi / lo),
})
const FINE = logScale(0.5, 20)
const BROAD = logScale(0.01, 3)
const percent = (v: number) => `${Math.round(v * 100)}%`
/** Noise, in the broad groups' bars. */
const NOISE_CSS = 'var(--muted-foreground)'
const METHODS: Method[] = ['hdbscan', 'leiden']

/** Each broad group's digits, by label, largest group first and noise last. */
function contentsOf(music: MapMusic, labels: number[]) {
  return [...Array.from({ length: music.broadCount }, (_, c) => c), -1].flatMap((group) => {
    const counts = Array.from({ length: N_DIGITS }, () => 0)
    music.broad.forEach((g, i) => g === group && counts[labels[music.rows[i]]]++)
    const size = counts.reduce((a, b) => a + b, 0)
    return size ? [{ group, counts, size }] : []
  })
}

/** A broad group's name, by the digits that make up most of it: "mostly 7s and 9s". */
function nameOf(counts: number[], size: number) {
  const most = counts
    .map((count, d) => ({ count, d }))
    .sort((a, b) => b.count - a.count)
    .filter(({ count }) => count / size > 0.18)
    .slice(0, 2)
    .map(({ d }) => `${d}s`)
  return most.length ? `mostly ${most.join(' and ')}` : 'mixed'
}

/** The digits on the map, by label, as along the top of v4: a toggle each, and all or none. */
export function DigitPicker({ digits, onDigits }: { digits: number[]; onDigits: (digits: number[]) => void }) {
  const allChosen = digits.length === N_DIGITS
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToggleGroup
        type="multiple"
        value={digits.map(String)}
        onValueChange={(values) => onDigits(values.map(Number).sort((a, b) => a - b))}
        aria-label="Digit labels"
        className="border-white/20 bg-black/50 shadow-none"
      >
        {Array.from({ length: N_DIGITS }, (_, d) => (
          <ToggleGroupItem
            key={d}
            value={String(d)}
            className="num h-7 min-w-[1.375rem] border-white/20 px-1 hover:bg-white/15 hover:text-white data-[state=off]:text-white/55 data-[state=on]:bg-white/90 data-[state=on]:text-black data-[state=on]:shadow-[inset_0_-3px_0_var(--digit)]"
            style={{ '--digit': DIGIT_COLORS[d] } as React.CSSProperties}
          >
            {d}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 min-w-6 bg-black/50 px-1.5 text-white/80 hover:bg-black/70 hover:text-white"
        onClick={() => onDigits(allChosen ? [] : Array.from({ length: N_DIGITS }, (_, d) => d))}
        aria-label={allChosen ? 'No digits' : 'All digits'}
        title={allChosen ? 'No digits' : 'All digits'}
      >
        {allChosen ? '∅' : '*'}
      </Button>
    </div>
  )
}

/** What the walker is on, in words. */
export function nowText({ music, node, dwell }: WalkSnapshot, labels: number[], method: Method) {
  if (!music) return 'Grouping the digits…'
  if (!music.rows.length) return 'No digits on the map: keeping time with a metronome. Pick a digit to bring the music back.'
  if (music.broadCount === 0) return 'Every digit is left as noise, so there are no groups to harmonise: keeping time with a metronome.'
  if (node === null || node >= music.rows.length) return 'Press play to start the walk, then tap the map to move it.'
  const label = labels[music.rows[node]]
  const group = music.broad[node]
  const small = `small group ${music.fine[node] + 1} of ${music.fineCount}`
  if (group < 0) return `On a ${label} that ${METHOD_LABELS[method].split(' ')[0]} left as noise, so the bass drops out and the melody plays softly; ${small}.`
  if (music.broadCount === 1) return `On a ${label}. Everything is one broad group, so the chord and bass stay on the root; ${small}.`
  return `On a ${label}, in broad group ${group + 1} of ${music.broadCount}, whose chord tone is ${TONE_NAMES[group % TONE_NAMES.length]}; ${small}, ${dwell} step${dwell === 1 ? '' : 's'} in.`
}

/** The chord's qualities, for as many broad groups. */
function qualities(groups: number) {
  const n = chordSize(groups)
  return [
    ['Harmony', CHORD_NAMES[n - 1]],
    ['Timbre', n === 1 ? 'pure sine, no chorus' : n === 2 ? 'soft triangle, slight chorus' : `sawtooth, filter at ${Math.round(500 + 180 * n)} Hz, ${n > 5 ? 'thick' : 'light'} chorus`],
    ['Space', n === 1 ? 'mono, centred, dry' : `${n} voices spread left to right, more reverb`],
    ['Pulse', n === 1 ? 'one slow breath every 4 s' : `voices swell 1 to ${n} times per 4 s, against each other`],
  ]
}

/** What the walker is on and playing, and the chord. */
export function MusicTab({ snapshot, walk, pixels, labels, method }: { snapshot: WalkSnapshot; walk: MusicWalk; pixels: Uint8Array; labels: number[]; method: Method }) {
  const { music, node } = snapshot
  const here = music && node !== null && node < music.rows.length ? node : null
  const count = music?.broadCount ?? 0
  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Now"
        description="A walker steps at random through the digits' nearest neighbours, ringed in white on the map. Broad groups set the chord, and the bass follows the walker's; small groups set the melody. Tap the map to move the walker."
      >
        <div className="flex items-center gap-3">
          <DigitThumb pixels={pixels} row={here === null ? null : music!.rows[here]} className="size-14 shrink-0 rounded-sm" />
          <p className="text-sm text-muted-foreground">{nowText(snapshot, labels, method)}</p>
        </div>
      </Section>
      <Section title="Harmony" description="One chord tone per broad group: the walker's is louder, and the bass plays it.">
        <div className="flex items-baseline gap-2">
          <strong className="num text-3xl leading-none">{count}</strong>
          <span className="text-sm text-muted-foreground">
            broad group{count === 1 ? '' : 's'}: {count ? CHORD_NAMES[chordSize(count) - 1] : 'a metronome, no chord'}
          </span>
        </div>
        <HarmonyStrip walk={walk} />
        {count > 0 && (
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-sm">
            {qualities(count).map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </div>
  )
}

/** What finds the broad groups, how they match the true digits, and what each contains. */
export function GroupsTab({ settings, patch, music, labels, touring, onTour, onJumpGroup }: SettingsEditor & {
  music: MapMusic | null
  labels: number[]
  /** The count-up, while it runs: how many groups now, and up to. */
  touring: { at: number; max: number } | null
  onTour: () => void
  onJumpGroup: () => void
}) {
  const { method } = settings
  const current = music && music.rows.length ? music : null
  const contents = useMemo(() => (current ? contentsOf(current, labels) : []), [current, labels])
  const largest = Math.max(1, ...contents.map((g) => g.size))
  const stats = useMemo(() => {
    if (!current) return null
    const kept = [...current.broad.keys()].filter((i) => current.broad[i] >= 0)
    const noise = current.rows.length - kept.length
    const ari =
      settings.digits.length > 1 && kept.length
        ? adjustedRand(
            kept.map((i) => current.broad[i]),
            kept.map((i) => labels[current.rows[i]]),
          )
        : null
    return { noise: noise / current.rows.length, ari }
  }, [current, labels, settings.digits.length])
  const target = targetOf(settings)

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Broad groups"
        description={
          method === 'hdbscan'
            ? 'HDBSCAN finds dense regions in a 10-D UMAP of the digits, deciding how many groups there are itself and leaving stragglers as noise.'
            : 'Leiden splits the nearest-neighbour graph by modularity, into as many groups as asked for, or at a resolution you set.'
        }
      >
        <Segmented options={METHODS} value={method} onChange={(m) => patch({ method: m })} labels={METHOD_LABELS} />
        {method === 'hdbscan' ? (
          <>
            <Slider label="min group size" value={settings.hdbscan.minClusterSize} min={10} max={150} onChange={(v) => patch({ hdbscan: { ...settings.hdbscan, minClusterSize: v } })} title="The smallest group worth calling a broad group" />
            <Slider label="min samples" value={settings.hdbscan.minSamples} min={2} max={40} onChange={(v) => patch({ hdbscan: { ...settings.hdbscan, minSamples: v } })} title="How conservative it is: higher leaves more digits as noise" />
            <Toggle label="allow one group" checked={settings.hdbscan.allowSingle} onChange={(v) => patch({ hdbscan: { ...settings.hdbscan, allowSingle: v } })} note="otherwise it always splits, or leaves everything as noise" />
          </>
        ) : (
          <>
            <Toggle label="as many as digits chosen" checked={settings.matchDigits} onChange={(v) => patch({ matchDigits: v, resolution: null })} />
            <Slider
              label="groups wanted"
              value={settings.resolution !== null && music ? Math.min(MAX_TARGET, music.broadCount) : target}
              min={1}
              max={MAX_TARGET}
              onChange={(v) => patch({ target: v, matchDigits: false, resolution: null })}
            />
            <Slider
              label="resolution γ"
              value={BROAD.from(settings.resolution ?? music?.resolution ?? 1)}
              min={0}
              max={1}
              step={0.001}
              onChange={(u) => patch({ resolution: BROAD.to(u), matchDigits: false })}
              format={() => (settings.resolution ?? music?.resolution ?? 1).toPrecision(3)}
            />
            <p className="text-xs text-muted-foreground">
              {!music || music.resolution === null
                ? ' '
                : settings.resolution !== null
                  ? `γ = ${music.resolution.toPrecision(3)} gives ${music.broadCount} broad group${music.broadCount === 1 ? '' : 's'}. Move “groups wanted” to find γ again.`
                  : `Asked for ${target}; Leiden found ${music.broadCount} at γ = ${music.resolution.toPrecision(3)}.${music.broadCount !== target ? ' This is the closest it gets on this graph.' : ''}`}
            </p>
            <Button variant="outline" size="sm" className="self-start" onClick={onTour} aria-pressed={touring !== null}>
              {touring ? `Stop count-up (${touring.at} of ${touring.max})` : 'Count up from 1 group'}
            </Button>
          </>
        )}
      </Section>

      <Section title="How they match the digits">
        <div className="grid grid-cols-3 gap-2">
          {[
            [music?.broadCount ?? '–', 'broad groups'],
            [stats ? `${Math.round(stats.noise * 100)}%` : '–', 'left as noise'],
            [stats?.ari != null ? stats.ari.toFixed(2) : '–', 'match to true digits (ARI)'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-md border px-3 py-2">
              <div className="num text-xl font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="What each contains" description="Bar segments are true digits; grey is noise.">
        <div className="flex flex-col gap-1">
          {contents.map(({ group, counts, size }) => (
            <div key={group} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
              <span className="num flex items-center gap-1 truncate" title={group < 0 ? 'noise' : nameOf(counts, size)}>
                <span className="swatch shrink-0" style={{ background: group < 0 ? NOISE_CSS : rgbCss(broadColor(group)) }} />
                {group < 0 ? 'noise' : nameOf(counts, size)} · {size}
              </span>
              <div className="flex h-3.5 overflow-hidden rounded-sm" style={{ width: `${Math.max(6, (100 * size) / largest)}%` }}>
                {counts.map((count, d) =>
                  count ? (
                    <span
                      key={d}
                      className="h-full text-center text-[10px] leading-3.5 text-white"
                      style={{ width: `${(100 * count) / size}%`, background: group < 0 ? NOISE_CSS : DIGIT_COLORS[d] }}
                      title={`digit ${d}: ${count}`}
                    >
                      {count / size > 0.12 ? d : ''}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          ))}
          {!current && <p className="text-xs text-muted-foreground">No digits on the map.</p>}
        </div>
        <Button variant="outline" size="sm" className="self-start" onClick={onJumpGroup} disabled={!current}>
          <Shuffle /> jump to another group
        </Button>
      </Section>
    </div>
  )
}

/** The small groups that set the melody, and the walk's time. */
export function MelodyTab({ settings, patch, music }: SettingsEditor & { music: MapMusic | null }) {
  return (
    <Section
      title="Small groups: the melody"
      description={`Leiden at a high resolution on the same neighbours, whichever finds the broad groups; each small group is given a note of the chord, so with one broad group the melody can only play the root.${music?.rows.length ? ` ${music.fineCount} small groups now.` : ''}`}
    >
      <Slider label="resolution" value={FINE.from(settings.fineResolution)} min={0} max={1} step={0.001} onChange={(u) => patch({ fineResolution: FINE.to(u) })} format={() => settings.fineResolution.toPrecision(3)} />
      <Slider label="steps / s" value={settings.stepsPerSecond} min={2} max={16} onChange={(v) => patch({ stepsPerSecond: v })} />
      <Toggle label="swing" checked={settings.swing} onChange={(v) => patch({ swing: v })} />
    </Section>
  )
}

export function MixTab({ settings, patch }: SettingsEditor) {
  return (
    <Section title="Mix">
      <Slider label="chord" value={settings.chord} min={0} max={1} step={0.01} onChange={(v) => patch({ chord: v })} format={percent} />
      <Slider label="bass" value={settings.bass} min={0} max={1} step={0.01} onChange={(v) => patch({ bass: v })} format={percent} />
      <Slider label="melody" value={settings.melody} min={0} max={1} step={0.01} onChange={(v) => patch({ melody: v })} format={percent} />
    </Section>
  )
}
