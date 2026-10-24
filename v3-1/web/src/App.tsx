import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChordViz } from './components/ChordViz'
import { Segmented, Slider } from './components/controls'
import { DigitPreview } from './components/DigitPreview'
import { GroupLegend } from './components/GroupLegend'
import { Matrix } from './components/Matrix'
import { Presets } from './components/Presets'
import { Transport } from './components/Transport'
import { DIGIT_COLORS, groupColors } from './palette'
import { usePlayhead } from './playhead'
import { DEFAULT_SETTINGS, type Settings } from './presets'
import {
  chordSlots,
  groupParticipants,
  N_DIGITS,
  pcsOf,
  pickRows,
  windowFeatures,
  type Grouping,
} from './selection'
import { buildTraces, READING_LABELS, type ReadingKey } from './signal'
import { useData, type PoolData } from './useData'
import { ELEMENTS, GEO_MODES, MAX_CHORDS, VIEW_LABELS } from './vizSettings'

/** Moments sampled across the trail's window when clustering over it. */
const WINDOW_SAMPLES = 32

/** Settings that are objects of their own, changed a field at a time. */
type Nested = 'signal' | 'style' | 'particles'

function Explorer({ data }: { data: PoolData }) {
  const { meta, pixels, pcs } = data
  const labels = meta.rows.label

  // Every setting, as presets save and load them; the playhead follows its speed and looping.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }))
  const patch = <K extends Nested>(key: K, fields: Partial<Settings[K]>) => setSettings((s) => ({ ...s, [key]: { ...s[key], ...fields } }))
  const { count, seed, groupBy, resolution, neighbours, clusterOver, clusterRate, order, signal, view, geometry, style, trailSeconds, particles, focus } = settings
  const digits = useMemo(() => new Set(settings.digits), [settings.digits])
  const setFocus = (i: number) => set('focus', i)

  const [particleReset, setParticleReset] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = usePlayhead()
  useEffect(() => playhead.setSpeed(settings.speed), [playhead, settings.speed])
  useEffect(() => playhead.setLoop(settings.loop), [playhead, settings.loop])
  const trailPixels = trailSeconds * settings.speed

  const available = useMemo(() => labels.filter((l) => digits.has(l)).length, [labels, digits])
  const maxCount = Math.min(MAX_CHORDS, available)
  const shownCount = Math.min(count, maxCount)
  const rows = useMemo(() => pickRows(labels, digits, shownCount, seed), [labels, digits, shownCount, seed])
  const points = useMemo(() => pcsOf(pcs, meta.nPcs, rows), [pcs, meta.nPcs, rows])
  const rowLabels = useMemo(() => rows.map((r) => labels[r]), [rows, labels])
  const fullGrouping = useMemo(
    () => groupParticipants(rowLabels, points, meta.nPcs, groupBy, { resolution, neighbours, seed }),
    [rowLabels, points, meta.nPcs, groupBy, resolution, neighbours, seed],
  )
  const traces = useMemo(() => buildTraces(pixels, rows, signal), [pixels, rows, signal])
  useEffect(() => playhead.setLength(traces.length), [playhead, traces.length])
  useEffect(() => playhead.resetLaps(), [playhead, traces])

  // Clustering over the trail's window: re-run `clusterRate` times a second while the playhead moves, each run
  // starting from the last one's clusters (or the full clustering's, at first) and keeping their ids.
  const windowed = groupBy === 'leiden' && clusterOver === 'window'
  const [windowGrouping, setWindowGrouping] = useState<{ rows: number[]; grouping: Grouping } | null>(null)
  const lastWindow = useRef<{ rows: number[]; grouping: Grouping } | null>(null)
  useEffect(() => {
    if (!windowed) return
    let lastMoment = NaN
    const run = () => {
      if (playhead.moment === lastMoment) return
      lastMoment = playhead.moment
      const previous = lastWindow.current?.rows === rows ? lastWindow.current.grouping : fullGrouping
      const features = windowFeatures(traces, playhead.moment, trailPixels, WINDOW_SAMPLES, playhead.wraps)
      const grouping = groupParticipants(rowLabels, features, WINDOW_SAMPLES, 'leiden', { resolution, neighbours, seed }, previous)
      lastWindow.current = { rows, grouping }
      setWindowGrouping(lastWindow.current)
    }
    run()
    const id = setInterval(run, 1000 / clusterRate)
    return () => clearInterval(id)
  }, [windowed, clusterRate, rows, rowLabels, traces, playhead, trailPixels, resolution, neighbours, seed, fullGrouping])
  const grouping = windowed && windowGrouping?.rows === rows ? windowGrouping.grouping : fullGrouping

  const colors = useMemo(() => groupColors(grouping), [grouping])
  const slotOf = useMemo(() => chordSlots(grouping, points, meta.nPcs, order), [grouping, points, meta.nPcs, order])

  const followed = focus !== null && focus < rows.length ? focus : rows.length ? 0 : null
  const shown = hover ?? followed
  const toggleDigit = (d: number) => {
    const next = new Set(digits)
    if (next.has(d) && next.size > 1) next.delete(d)
    else next.add(d)
    set('digits', [...next].sort((a, b) => a - b))
  }
  const fixed = (places: number) => (v: number) => v.toFixed(places)

  return (
    <main>
      <header className="page-header">
        <h1>Valence particles from MNIST</h1>
        <p>
          A valence visualisation, fed with stand-in data: each digit's pixels, read in order, are one participant's
          valence over time (paper −1, ink +1). Pick digits and a sample size, colour them by label or Leiden cluster,
          and play.
        </p>
      </header>

      <div className="controls">
        <Presets settings={settings} onLoad={setSettings} />

        <div className="toolbar">
          <span className="control-label">Digits</span>
          <span className="segmented digits">
            {Array.from({ length: N_DIGITS }, (_, d) => (
              <button
                key={d}
                className={digits.has(d) ? 'on' : ''}
                style={{ '--digit': DIGIT_COLORS[d] } as React.CSSProperties}
                onClick={() => toggleDigit(d)}
                aria-pressed={digits.has(d)}
              >
                {d}
              </button>
            ))}
          </span>
          <button onClick={() => set('digits', Array.from({ length: N_DIGITS }, (_, d) => d))}>all</button>
          <Slider label="sample" value={shownCount} min={2} max={maxCount} onChange={(v) => set('count', v)} format={(v) => `${v} of ${available}`} />
          <button onClick={() => set('seed', seed + 1)} title="Pick another sample of these digits">
            ⟳ Reshuffle
          </button>
        </div>

        <div className="toolbar">
          <span className="control-label">Color by</span>
          <Segmented options={['digit', 'leiden'] as const} value={groupBy} onChange={(v) => set('groupBy', v)} labels={{ digit: 'Label', leiden: 'Leiden' }} />
          {groupBy === 'leiden' && (
            <>
              <Slider label="resolution" value={resolution} min={0.1} max={3} step={0.1} onChange={(v) => set('resolution', v)} format={fixed(1)} />
              <Slider label="neighbours" value={neighbours} min={3} max={30} onChange={(v) => set('neighbours', v)} />
              <span className="control-label">Cluster over</span>
              <Segmented options={['full', 'window'] as const} value={clusterOver} onChange={(v) => set('clusterOver', v)} />
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
              <span className="muted num">
                {grouping.groups.length} clusters · modularity {grouping.modularity?.toFixed(2)}
              </span>
            </>
          )}
          <span className="control-label">Chord order</span>
          <Segmented options={['random', 'grouped'] as const} value={order} onChange={(v) => set('order', v)} />
        </div>

        <div className="toolbar">
          <span className="control-label">Reading</span>
          <Segmented options={Object.keys(READING_LABELS) as ReadingKey[]} value={signal.reading} onChange={(v) => patch('signal', { reading: v })} labels={READING_LABELS} />
          <label className="check">
            <input type="checkbox" checked={signal.skipBlank} onChange={(e) => patch('signal', { skipBlank: e.target.checked })} /> skip blank pixels
          </label>
          <Segmented options={['blur', 'lag'] as const} value={signal.smoothing} onChange={(v) => patch('signal', { smoothing: v })} />
          <Slider
            label="smoothing"
            value={signal.smoothingPixels}
            min={0}
            max={8}
            step={0.25}
            onChange={(v) => patch('signal', { smoothingPixels: v })}
            format={(v) => `${v} px`}
          />
          <Segmented
            options={['ink', 'ink-only'] as const}
            value={signal.mapping}
            onChange={(v) => patch('signal', { mapping: v })}
            labels={{ ink: 'paper −1, ink +1', 'ink-only': 'paper 0, ink +1' }}
          />
        </div>
      </div>

      <div className="stage">
        <div className="viz">
          <ChordViz
            traces={traces}
            pickKey={rows}
            playhead={playhead}
            slotOf={slotOf}
            groupOf={grouping.groupOf}
            colors={colors}
            focus={followed}
            view={view}
            geometry={geometry}
            style={style}
            trailSeconds={trailSeconds}
            particles={particles}
            particleReset={particleReset}
            onFocus={setFocus}
            onHover={setHover}
          />
          <div className="viz-controls">
            <Segmented options={['2d', '2d-ts', '3d'] as const} value={view} onChange={(v) => set('view', v)} labels={VIEW_LABELS} />
            <Segmented options={GEO_MODES} value={geometry} onChange={(v) => set('geometry', v)} />
          </div>
          <div className="viz-hint">{view === '3d' ? 'click a digit to follow it · drag to orbit · scroll to zoom' : 'click a digit to follow it'}</div>
        </div>

        <aside className="sidebar">
          {shown !== null && (
            <DigitPreview
              pixels={pixels}
              poolRow={rows[shown]}
              participant={shown}
              label={labels[rows[shown]]}
              groupName={grouping.groups[grouping.groupOf[shown]].name}
              groupColor={colors[grouping.groupOf[shown]]}
              traces={traces}
              playhead={playhead}
              trailPixels={trailPixels}
              following={hover === null}
              focusRing={style.focusRing}
              onFocusRing={(on) => patch('style', { focusRing: on })}
            />
          )}
          <h2>Groups: mean valence now</h2>
          <GroupLegend
            groups={grouping.groups}
            groupOf={grouping.groupOf}
            colors={colors}
            traces={traces}
            playhead={playhead}
            trailPixels={trailPixels}
            pixels={pixels}
            rows={rows}
            onFocus={setFocus}
            onHover={setHover}
          />
          {geometry === 'particle' && (
            <div className="particle-settings">
              <h2>Particles</h2>
              <p className="muted">Groups pull together; the centre pulls ink in and pushes paper out, by each digit's valence now.</p>
              <Slider label="within groups" value={particles.cohesion} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { cohesion: v })} format={fixed(2)} />
              <Slider label="between groups" value={particles.separation} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { separation: v })} format={fixed(2)} />
              <Slider label="centre" value={particles.centreForce} min={0} max={6} step={0.1} onChange={(v) => patch('particles', { centreForce: v })} format={fixed(1)} />
              <Slider label="spread" value={particles.spread} min={0.2} max={1.5} step={0.05} onChange={(v) => patch('particles', { spread: v })} format={fixed(2)} />
              <Slider label="reach" value={particles.radius} min={10} max={150} onChange={(v) => patch('particles', { radius: v })} format={fixed(0)} />
              <Slider label="damping" value={particles.damping} min={0.5} max={0.99} step={0.01} onChange={(v) => patch('particles', { damping: v })} format={fixed(2)} />
              <label className="check">
                <input type="checkbox" checked={particles.reverseCentre} onChange={(e) => patch('particles', { reverseCentre: e.target.checked })} /> ink repels
                from centre
              </label>
              <button onClick={() => setParticleReset((r) => r + 1)}>scatter</button>
            </div>
          )}
          <h2>Colour by</h2>
          <div className="style-grid">
            <span />
            {ELEMENTS.map((el) => (
              <span key={el} className="style-head">
                {el}
              </span>
            ))}
            {(['valence', 'group'] as const).map((by) => (
              <Fragment key={by}>
                <span className="style-head">
                  {by}
                </span>
                {ELEMENTS.map((el) => (
                  <button
                    key={`${by}-${el}`}
                    className={style.colorBy[el] === by ? 'on' : ''}
                    onClick={() => patch('style', { colorBy: { ...style.colorBy, [el]: by } })}
                  >
                    {by}
                  </button>
                ))}
              </Fragment>
            ))}
            <span className="style-head">opacity</span>
            {ELEMENTS.map((el) => (
              <input
                key={`op-${el}`}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={style.opacity[el]}
                aria-label={`${el} opacity`}
                onChange={(e) => patch('style', { opacity: { ...style.opacity, [el]: Number(e.target.value) } })}
              />
            ))}
          </div>
          <Slider label="cursor size" value={style.cursorSize} min={2} max={30} onChange={(v) => patch('style', { cursorSize: v })} />
          <Slider label="chord width" value={style.chordWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { chordWidth: v })} format={(v) => `${v} px`} />
          <Slider label="trace width" value={style.traceWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { traceWidth: v })} />
        </aside>
      </div>

      <section className="matrix-section">
        <h2>Matrix</h2>
        <p className="muted">
          One row per digit, in chord order, one column per pixel. Click a row to follow that digit.
        </p>
        <Transport
          playhead={playhead}
          traces={traces}
          speed={settings.speed}
          onSpeed={(v) => set('speed', v)}
          loop={settings.loop}
          onLoop={(v) => set('loop', v)}
          trailSeconds={trailSeconds}
          onTrailSeconds={(v) => set('trailSeconds', v)}
        />
        <Matrix
          traces={traces}
          slotOf={slotOf}
          groupOf={grouping.groupOf}
          colors={colors}
          grouped={order === 'grouped'}
          focus={followed}
          hover={hover}
          onFocus={setFocus}
          onHover={setHover}
          playhead={playhead}
          trailPixels={trailPixels}
        />
      </section>
    </main>
  )
}

export default function App() {
  const { data, error } = useData()
  if (error) return <p className="status">{error}</p>
  if (!data) return <p className="status">Loading digits…</p>
  return <Explorer data={data} />
}
