/** The drawer's tabs: the crowd, how it's grouped, the phones in the room, the view, and the sound. */

import { ArrowDownToLine, ArrowUpToLine, Paintbrush, QrCode, RotateCcw, Shuffle, Users } from 'lucide-react'
import { useState } from 'react'
import { NSLOT } from '../analysis'
import { PATTERNS, SLOT, START_PATTERNS, SUB } from '../crowd'
import type { CrowdEngine, Snapshot } from '../engine'
import { CHORD_NAMES, DEGREE_NAMES, PAD_NOTE_NAMES, PROG_NAMES, RHYTHM_ON, VOICE_NAMES } from '../music'
import { GRADIENT_LABELS, gradientCss, OTHER_COLOR, participantRGB, patternColor, rgbCss, slotColor } from '../palette'
import { DETECTIONS, GRADIENTS, type Calibration } from '../protocol'
import type { Participant } from '../live'
import { COLOR_BY_LABELS, VIEW_LABELS, type ColorBy, type Patch, type Settings, type ViewMode } from '../settings'
import { ViewIcon } from './ViewIcons'
import { Field, Section, Segmented, Slider, Toggle } from './controls'
import { Timeline } from './Timeline'
import { Button } from './ui/button'

export interface Editor {
  settings: Settings
  patch: Patch
}

const ms = (s: number) => `${Math.round(s * 1000)} ms`
const pct = (v: number) => `${Math.round(v * 100)}%`

const Swatch = ({ color }: { color: string }) => <span className="swatch shrink-0" style={{ background: color }} />

/** The synthetic crowd: how many, how they play, and giving phones new patterns. */
export function CrowdTab({ settings, patch, engine, snapshot, focus, onRestart }: Editor & {
  engine: CrowdEngine
  snapshot: Snapshot
  focus: number | null
  onRestart: (shuffle: boolean) => void
}) {
  const crowd = settings.crowd
  const set = (changes: Partial<Settings['crowd']>) => patch({ crowd: { ...crowd, ...changes } })
  const a = snapshot.analysis
  const focusSlot = focus === null || !a ? -1 : (a.slots[focus] ?? -1)
  const group = focusSlot < 0 ? [] : [...a!.slots.keys()].filter((i) => a!.slots[i] === focusSlot)
  const assign = (who: number[], pattern: number) => engine.assign(who, pattern)
  return (
    <div className="flex flex-col gap-6">
      <Section title="Crowd" description="Simulated phones, flipped to the beat, in three sections to start: Slow, Fast and 1-e-&. Live phones join them.">
        <Slider label="phones" value={crowd.count} min={3} max={150} onChange={(count) => set({ count })} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onRestart(false)} title="Start over, with three clean blocks of seats">
            <RotateCcw /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRestart(true)} title="Start over, with each phone dealt to a section at random (equal sizes)">
            <Shuffle /> Reset shuffled
          </Button>
          <Button variant="outline" size="sm" onClick={() => engine.moveTenth()} title="A tenth of the phones move to the next section's pattern at the next bar">
            <Users /> Move 10%
          </Button>
        </div>
      </Section>
      <Section
        title="Patterns"
        description="One bar is 2 s, four ½-second steps counted 1 e & a. Tap a phone on the graph, then give its group (or just it) a pattern: they switch at the next step, so nothing played is rewritten."
      >
        <ul className="flex flex-col gap-1 text-sm">
          {PATTERNS.map((p, g) => (
            <li key={p.name} className="flex items-center gap-2">
              <Swatch color={rgbCss(patternColor(g))} />
              <span className="w-12 font-medium">{p.name}</span>
              <span className="num w-16 text-xs">{p.mask.map((m, k) => (m ? SUB[k] : '·')).join(' ')}</span>
              <span className="text-xs text-muted-foreground">{p.desc}{g >= START_PATTERNS && ' · chosen only'}</span>
            </li>
          ))}
        </ul>
        {focus === null ? (
          <p className="text-xs text-muted-foreground">Tap a phone on the graph to choose its group.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Field label={focusSlot >= 0 ? `its group (${group.length})` : 'its group'}>
              {PATTERNS.map((p, g) => (
                <Button key={p.name} variant="outline" size="sm" disabled={!group.length} onClick={() => assign(group, g)}>
                  <Swatch color={rgbCss(patternColor(g))} /> {p.name}
                </Button>
              ))}
            </Field>
            <Field label="just this phone">
              {PATTERNS.map((p, g) => (
                <Button key={p.name} variant="outline" size="sm" disabled={snapshot.phones[focus]?.live} onClick={() => assign([focus], g)}>
                  <Swatch color={rgbCss(patternColor(g))} /> {p.name}
                </Button>
              ))}
            </Field>
            {snapshot.phones[focus]?.live && <p className="text-xs text-muted-foreground">This one’s a live phone: it plays what its person plays.</p>}
          </div>
        )}
      </Section>
      <Section title="How they play">
        <Slider label="timing jitter" value={crowd.jitter} min={0} max={0.15} step={0.005} onChange={(jitter) => set({ jitter })} format={(v) => `σ ${ms(v)}`} />
        <Slider label="lag spread" value={crowd.lagSpread} min={0} max={0.15} step={0.005} onChange={(lagSpread) => set({ lagSpread })} format={(v) => `σ ${ms(v)}`} />
        <Slider label="sensor noise" value={crowd.noise} min={0} max={0.5} step={0.01} onChange={(noise) => set({ noise })} format={(v) => `σ ${v.toFixed(2)}`} />
        <Slider label="missed flips" value={crowd.miss} min={0} max={0.1} step={0.005} onChange={(miss) => set({ miss })} format={(v) => `${(v * 100).toFixed(1)}%`} />
        <Slider
          label="facing sync"
          value={crowd.sync}
          min={0}
          max={1}
          step={0.05}
          onChange={(sync) => set({ sync })}
          format={(v) => (v === 0 ? 'random' : v === 1 ? 'aligned' : pct(v))}
          title="How many keep to their section's agreed facing, rather than starting face up or down at random"
        />
      </Section>
    </div>
  )
}

/** What's been found, and how: Leiden's settings and the similarity it runs on. */
export function GroupsTab({ settings, patch, snapshot, engine }: Editor & { snapshot: Snapshot; engine: CrowdEngine }) {
  const A = settings.analysis
  const set = (changes: Partial<Settings['analysis']>) => patch({ analysis: { ...A, ...changes } })
  const a = snapshot.analysis
  const rows = a ? groupRows(a.slots, snapshot, engine) : []
  return (
    <div className="flex flex-col gap-6">
      <Section title="Found" description="Every half second, Leiden groups the phones on their last 4 bars (8 s).">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="groups" value={a ? String(a.k) : '–'} />
          <Stat label="match (ARI)" value={a && !Number.isNaN(a.ari) ? a.ari.toFixed(2) : '–'} />
          <Stat label="took" value={a ? `${Math.round(a.ms)} ms` : '–'} />
        </div>
        <Spark values={snapshot.ariHistory} />
        <table className="num w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="font-normal">group</th><th className="font-normal">size</th><th className="font-normal">made of</th></tr>
          </thead>
          <tbody>
            {rows.map(({ slot, members, mix }) => (
              <tr key={slot} className="border-t">
                <td className="py-1"><Swatch color={rgbCss(slot < NSLOT ? slotColor(slot) : OTHER_COLOR)} /> {slot < NSLOT ? `G${slot + 1}` : 'other'}</td>
                <td>{members}</td>
                <td>
                  <div className="flex h-2.5 min-w-24 overflow-hidden rounded-sm">
                    {mix.map(([p, c]) => (
                      <i key={p} style={{ flex: c, background: p >= 0 ? rgbCss(patternColor(p)) : '#fff' }} title={p >= 0 ? PATTERNS[p].name : 'live'} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Leiden">
        <Field label="quality">
          <Segmented
            options={['cpm', 'mod'] as const}
            labels={{ cpm: 'CPM', mod: 'modularity' }}
            value={A.quality}
            onChange={(quality) => set({ quality, gamma: quality === 'mod' ? 1 : A.graph === 'knn' ? 0.15 : 0.4 })}
          />
        </Field>
        <Slider label="resolution γ" value={A.gamma} min={0} max={1.5} step={0.01} onChange={(gamma) => set({ gamma })} format={(v) => v.toFixed(2)} />
        <Field label="graph">
          <Segmented
            options={['full', 'knn'] as const}
            labels={{ full: 'all pairs', knn: 'k nearest' }}
            value={A.graph}
            onChange={(graph) => set({ graph, gamma: A.quality === 'mod' ? 1 : graph === 'knn' ? 0.15 : 0.4 })}
          />
        </Field>
        <Slider label="k" value={A.k} min={3} max={40} onChange={(k) => set({ k })} disabled={A.graph !== 'knn'} />
        <Toggle label="Warm start from the last window" checked={A.warm} onChange={(warm) => set({ warm })} />
        <p className="text-xs text-muted-foreground">
          On every pair, CPM’s γ works roughly as a similarity cut-off: groups hold while their average similarity is above it. On a kNN graph it’s
          an edge density, so much lower (about 0.1–0.25). Modularity’s γ = 1 is its standard.
        </p>
      </Section>
      <Section title="Similarity">
        <Toggle
          label="Require +1/−1 alignment"
          checked={A.align}
          onChange={(align) => set({ align })}
          note="On, a phone face up and one face down are opposites (r). Off, only the rhythm counts, whichever way up (|r|)."
        />
        <Slider label="lag tolerance" value={A.lagTol} min={0} max={0.3} step={0.05} onChange={(lagTol) => set({ lagTol })} format={(v) => `±${ms(v)}`} />
      </Section>
    </div>
  )
}

function groupRows(slots: Int32Array, snapshot: Snapshot, engine: CrowdEngine) {
  const by = new Map<number, Map<number, number>>()
  slots.forEach((s, i) => {
    const key = Math.min(s, NSLOT)
    if (!by.has(key)) by.set(key, new Map())
    const p = snapshot.phones[i]?.live ? -1 : engine.pattern(i)
    by.get(key)!.set(p, (by.get(key)!.get(p) ?? 0) + 1)
  })
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, mix]) => ({ slot, members: [...mix.values()].reduce((x, y) => x + y, 0), mix: [...mix].sort((a, b) => a[0] - b[0]) }))
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted px-2 py-1.5">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
    </div>
  )
}

/** ARI over the last two minutes. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 240, h = 36
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 2 - Math.max(0, Math.min(1, v)) * (h - 4)).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full text-highlight" preserveAspectRatio="none" aria-label="Match to the true patterns (ARI) over time">
      <line x1={0} x2={w} y1={2} y2={2} className="stroke-border" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const DETECTION_HOW = {
  flip: 'Face up for +1, face down for −1, edge on between',
  invert: 'Upright for +1, upside down for −1, on its side between',
  spin: 'As a steering wheel, screen to you: upright for +1, upside down for −1, landscape between',
} as const

/** The phones in the room: how they read, calibrating them all at once, and joining. */
export function PhonesTab({ settings, patch, roster, connected, onCalibrate, onJoin }: Editor & {
  roster: Participant[]
  connected: boolean
  onCalibrate: (set: Calibration) => void
  onJoin: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <Section title="In the room" description={connected ? undefined : 'Not connected to the room: reconnecting…'}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onJoin}>
            <QrCode /> Join with a phone
          </Button>
          <span className="text-sm text-muted-foreground">
            {roster.length} live phone{roster.length === 1 ? '' : 's'}
          </span>
          {roster.map((p) => (
            <span key={p.id} className="size-3 rounded-full" style={{ background: rgbCss(participantRGB(p.slot)), outline: p.touching ? '2px solid white' : undefined }} />
          ))}
        </div>
      </Section>
      <Section title="Reading" description="How phones are turned to read +1 and −1. The same for everyone in the room.">
        <Field label="detection" stacked>
          <Segmented options={DETECTIONS} value={settings.detection} onChange={(detection) => patch({ detection })} />
        </Field>
        <p className="text-xs text-muted-foreground">{DETECTION_HOW[settings.detection]}.</p>
        <Field label="calibrate" stacked>
          <Button variant="outline" size="sm" onClick={() => onCalibrate('high')} title="Every phone takes where it's turned now as +1">
            <ArrowUpToLine /> Set high
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCalibrate('low')} title="Every phone takes where it's turned now as −1">
            <ArrowDownToLine /> Set low
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCalibrate('reset')} title="Every phone goes back to the detection's own range">
            <RotateCcw /> Reset
          </Button>
        </Field>
        <p className="text-xs text-muted-foreground">
          Have everyone hold their phone where they mean −1 to be, then set low; where +1 is, then set high. Any turn works, held any way. A phone
          then reads how much nearer it is to its high than its low, so it runs smoothly from −1 to +1 however it’s turned between them. Each phone
          keeps its own, for each detection.
        </p>
      </Section>
      <Section title="Colours">
        <Field label="gradient" stacked>
          <Segmented
            options={GRADIENTS}
            value={settings.gradient}
            onChange={(gradient) => patch({ gradient })}
            labels={GRADIENT_LABELS}
            icons={Object.fromEntries(GRADIENTS.map((g) => [g, <span key={g} className="h-3 w-5 shrink-0 rounded-sm ring-1 ring-border" style={{ background: gradientCss(g) }} />]))}
            className="flex-wrap"
          />
        </Field>
      </Section>
    </div>
  )
}

const COLOR_OPTIONS: ColorBy[] = ['valence', 'group', 'pattern']
const VIEWS: ViewMode[] = ['2d', '2d-ts', '3d']

/** The graph: its view, what's coloured how, trails, and the layout's forces. */
export function ViewTab({ settings, patch }: Editor) {
  const view = settings.view, layout = settings.layout
  const set = (changes: Partial<Settings['view']>) => patch({ view: { ...view, ...changes } })
  const setLayout = (changes: Partial<Settings['layout']>) => patch({ layout: { ...layout, ...changes } })
  return (
    <div className="flex flex-col gap-6">
      <Section title="View">
        <Segmented options={VIEWS} value={view.mode} onChange={(mode) => set({ mode })} labels={VIEW_LABELS} icons={Object.fromEntries(VIEWS.map((v) => [v, <ViewIcon key={v} view={v} />]))} className="flex-wrap" />
        <Field label="dots">
          <Segmented options={COLOR_OPTIONS} value={view.dots} onChange={(dots) => set({ dots })} labels={COLOR_BY_LABELS} className="flex-wrap" />
        </Field>
        <Field label="trails">
          <Segmented options={COLOR_OPTIONS} value={view.trails} onChange={(trails) => set({ trails })} labels={COLOR_BY_LABELS} className="flex-wrap" />
        </Field>
        <Toggle label="Rings in each dot's group colour" checked={view.rings} onChange={(rings) => set({ rings })} note="Or its true pattern's, while dots are coloured by group." />
        <Toggle label="Circle round the graph" checked={view.circle} onChange={(circle) => set({ circle })} note="And its copies receding behind it, in 3d." />
        <Toggle label="Edges" checked={view.edges} onChange={(edges) => set({ edges })} note="The graph Leiden groups on: k nearest, or every pair at least as alike as γ." />
        <Slider label="trail length" value={view.trailSeconds} min={2} max={24} step={1} onChange={(trailSeconds) => set({ trailSeconds })} format={(v) => `${v} s`} />
        <Slider label="trail width" value={view.trailWidth} min={0.5} max={10} step={0.5} onChange={(trailWidth) => set({ trailWidth })} />
        <Slider label="dot size" value={view.dotSize} min={4} max={30} onChange={(dotSize) => set({ dotSize })} />
      </Section>
      <Section title="Layout" description="Every pair pulls together as much as it's alike, and pushes apart a little.">
        <Slider label="pull" value={layout.pull} min={0} max={1} step={0.05} onChange={(pull) => setLayout({ pull })} format={(v) => v.toFixed(2)} />
        <Slider label="push" value={layout.push} min={0} max={4} step={0.1} onChange={(push) => setLayout({ push })} format={(v) => v.toFixed(1)} />
        <Slider label="pull from" value={layout.floor} min={0} max={0.8} step={0.05} onChange={(floor) => setLayout({ floor })} format={(v) => `r ${v.toFixed(2)}`} title="Pairs less alike than this don't pull at all" />
        <Slider label="settle" value={layout.ease} min={0.01} max={0.3} step={0.01} onChange={(ease) => setLayout({ ease })} format={(v) => v.toFixed(2)} title="How quickly pulls follow each new window" />
      </Section>
    </div>
  )
}

/** The ensemble, and how it sounds. */
export function SoundTab({ settings, patch, snapshot }: Editor & { snapshot: Snapshot }) {
  const list = snapshot.ensemble
  const chord = settings.soundMode === 'chord'
  const minSize = Math.max(1, Math.round(settings.minGroupShare * snapshot.phones.length))
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Ensemble"
        description={chord ? `${list.length} group${list.length === 1 ? '' : 's'} → ${CHORD_NAMES[list.length]}` : `${list.length} voice${list.length === 1 ? '' : 's'} over ${PROG_NAMES.join(' · ')}, a chord a bar`}
      >
        <table className="num w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="font-normal">group</th><th className="font-normal">size</th><th className="font-normal">sound</th><th className="font-normal">rhythm</th></tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.slot} className="border-t">
                <td className="py-1"><Swatch color={rgbCss(slotColor(e.slot))} /> G{e.slot + 1}</td>
                <td>{e.members.length}</td>
                <td className="text-xs">{chord ? `${DEGREE_NAMES[e.voice]} · ${PAD_NOTE_NAMES[e.voice]}` : `${VOICE_NAMES[e.voice]} · the ${DEGREE_NAMES[e.voice]}`}</td>
                <td className="font-mono text-xs">
                  {e.rhythm.map((r, q) => (
                    <span key={q} className={r >= RHYTHM_ON ? '' : 'text-muted-foreground'} title={`${SUB[q]}: ${r.toFixed(2)}`}>
                      {r >= RHYTHM_ON ? SUB[q] : '·'}{' '}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={4} className="py-1 text-muted-foreground">No groups big enough yet</td></tr>
            )}
          </tbody>
        </table>
      </Section>
      <Section title="Sound" description="Sound and the metronome are this screen's own; the rest is shared.">
        <Toggle label="Sound" checked={settings.soundOn} onChange={(soundOn) => patch({ soundOn })} />
        <Toggle label="Metronome" checked={settings.metronome} onChange={(metronome) => patch({ metronome })} note="A click each step, accented on the bar's 1." />
        <Field label="groups are">
          <Segmented options={['chord', 'voices'] as const} labels={{ chord: 'chord tones', voices: 'instrument voices' }} value={settings.soundMode} onChange={(soundMode) => patch({ soundMode })} />
        </Field>
        <p className="text-xs text-muted-foreground">
          {chord
            ? 'Each group adds a sustained tone as it arrives, with a chime: root, fifth, third, seventh, ninth.'
            : 'Each group is an instrument (bass, pluck, keys, bell, lead) playing its chord tone on the steps where its phones were seen flipping.'}{' '}
          If a group goes, those after it move up one place.
        </p>
        <Slider label="volume" value={settings.volume} min={0} max={1} step={0.05} onChange={(volume) => patch({ volume })} format={pct} />
        <Slider
          label="smallest group"
          value={settings.minGroupShare}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(minGroupShare) => patch({ minGroupShare })}
          format={(v) => `${pct(v)} · ${minSize}`}
          title="Groups smaller than this make no sound"
        />
      </Section>
    </div>
  )
}

/**
 * Painting, as "Phone-flip crowd" had it: select phones (rows of the timeline, a detected group, or taps on the graph
 * while this tab is open) and give them a pattern. They switch at the next step after what's been worked out, so
 * nothing already played is rewritten, and the window takes up to 4 bars to catch up: meanwhile they're a mix of two
 * patterns, and tend to drift off as a group of their own, or sit in "other".
 */
export function PaintTab({ settings, engine, snapshot, focus, selected, onSelect, onClear }: Editor & {
  engine: CrowdEngine
  snapshot: Snapshot
  focus: number | null
  selected: Set<number>
  onSelect: (phones: number[], on: boolean) => void
  onClear: () => void
}) {
  const [said, setSaid] = useState<string | null>(null)
  const a = snapshot.analysis
  const bySlot = new Map<number, number[]>()
  if (a) a.slots.forEach((slot, i) => { const k = Math.min(slot, NSLOT); if (!bySlot.has(k)) bySlot.set(k, []); bySlot.get(k)!.push(i) })
  const groups = [...bySlot].sort((x, y) => x[0] - y[0])
  const nLive = [...selected].filter((i) => snapshot.phones[i]?.live).length
  const paint = (pattern: number) => {
    const { from, moved } = engine.assign([...selected], pattern)
    const step = Math.round(from / SLOT)
    setSaid(
      moved
        ? `${moved} phone${moved === 1 ? '' : 's'} switch to ${PATTERNS[pattern].name} from bar ${Math.floor(step / 4) + 1} · ${SUB[step % 4]}. Nothing already played changes.`
        : `They’re all ${PATTERNS[pattern].name} already.`,
    )
  }
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Paint"
        description="Select phones, then give them a pattern: they switch at the next step, as if pointing at part of the room and saying “now do this one”. The window takes up to 4 bars to catch up."
      >
        <Field label="select">
          {groups.map(([slot, members]) => (
            <Button key={slot} variant="outline" size="sm" onClick={() => onSelect(members, !members.every((i) => selected.has(i)))} title="Select (or deselect) this detected group">
              <Swatch color={rgbCss(slot < NSLOT ? slotColor(slot) : OTHER_COLOR)} /> {slot < NSLOT ? `G${slot + 1}` : 'other'} · {members.length}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => onSelect([...snapshot.phones.keys()], true)}>All</Button>
          <Button variant="outline" size="sm" onClick={onClear} disabled={!selected.size}>None</Button>
        </Field>
        <Field label={`paint ${selected.size}`}>
          {PATTERNS.map((p, g) => (
            <Button key={p.name} size="sm" variant="outline" disabled={selected.size === nLive} onClick={() => paint(g)} title={`${p.desc}: ${p.mask.map((m, k) => (m ? SUB[k] : '·')).join(' ')}`}>
              <Paintbrush style={{ color: rgbCss(patternColor(g)) }} /> {p.name}
            </Button>
          ))}
        </Field>
        <p className="min-h-4 text-xs text-muted-foreground">
          {said ?? 'Drag over rows of the timeline (or, by touch, tap a first row then a last), pick a group above, or tap phones on the graph.'}
          {nLive > 0 && ` ${nLive} selected ${nLive === 1 ? 'is a live phone' : 'are live phones'}: they play what their people play.`}
        </p>
        <Timeline engine={engine} gradient={settings.gradient} focus={focus} selected={selected} onSelect={onSelect} />
      </Section>
    </div>
  )
}
