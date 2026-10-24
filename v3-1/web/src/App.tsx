import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChordViz } from './components/ChordViz'
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
import { buildTraces, READING_LABELS, type ReadingKey, type SignalSettings } from './signal'
import { useData, type PoolData } from './useData'
import { ELEMENTS, GEO_MODES, MAX_CHORDS, VIEW_LABELS, type ParticleSettings } from './vizSettings'

/** Moments sampled across the trail's window when clustering over it. */
const WINDOW_SAMPLES = 32

function Segmented<T extends string>({ options, value, onChange, labels }: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, string>>
}) {
  return (
    <span className="segmented">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </span>
  )
}

function Explorer({ data }: { data: PoolData }) {
  const { meta, pixels, pcs } = data
  const labels = meta.rows.label

  // Who takes part.
  const [digits, setDigits] = useState<Set<number>>(() => new Set(DEFAULT_SETTINGS.digits))
  const [count, setCount] = useState(DEFAULT_SETTINGS.count)
  const [seed, setSeed] = useState(DEFAULT_SETTINGS.seed)
  // How they're grouped and laid out.
  const [groupBy, setGroupBy] = useState(DEFAULT_SETTINGS.groupBy)
  const [resolution, setResolution] = useState(DEFAULT_SETTINGS.resolution)
  const [neighbours, setNeighbours] = useState(DEFAULT_SETTINGS.neighbours)
  const [clusterOver, setClusterOver] = useState(DEFAULT_SETTINGS.clusterOver)
  /** Re-clusterings over the window per second (of wall time, while the playhead moves). */
  const [clusterRate, setClusterRate] = useState(DEFAULT_SETTINGS.clusterRate)
  const [order, setOrder] = useState(DEFAULT_SETTINGS.order)
  // How each digit is read out as valence.
  const [signal, setSignal] = useState(DEFAULT_SETTINGS.signal)
  // How it's drawn.
  const [view, setView] = useState(DEFAULT_SETTINGS.view)
  const [geometry, setGeometry] = useState(DEFAULT_SETTINGS.geometry)
  const [style, setStyle] = useState(DEFAULT_SETTINGS.style)
  const [trailSeconds, setTrailSeconds] = useState(DEFAULT_SETTINGS.trailSeconds)
  const [particles, setParticles] = useState(DEFAULT_SETTINGS.particles)
  const [particleReset, setParticleReset] = useState(0)
  const [focus, setFocus] = useState(DEFAULT_SETTINGS.focus)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = usePlayhead()

  const settings: Settings = {
    digits: [...digits].sort((a, b) => a - b),
    count,
    seed,
    groupBy,
    resolution,
    neighbours,
    clusterOver,
    clusterRate,
    order,
    signal,
    view,
    geometry,
    style,
    trailSeconds,
    particles,
    focus,
    speed: playhead.speed,
    loop: playhead.loop,
  }
  const applySettings = (s: Settings) => {
    setDigits(new Set(s.digits))
    setCount(s.count)
    setSeed(s.seed)
    setGroupBy(s.groupBy)
    setResolution(s.resolution)
    setNeighbours(s.neighbours)
    setClusterOver(s.clusterOver)
    setClusterRate(s.clusterRate)
    setOrder(s.order)
    setSignal(s.signal)
    setView(s.view)
    setGeometry(s.geometry)
    setStyle(s.style)
    setTrailSeconds(s.trailSeconds)
    setParticles(s.particles)
    setFocus(s.focus)
    playhead.setSpeed(s.speed)
    playhead.setLoop(s.loop)
  }

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
      const features = windowFeatures(traces, playhead.moment, trailSeconds * playhead.speed, WINDOW_SAMPLES, playhead.loop)
      const grouping = groupParticipants(rowLabels, features, WINDOW_SAMPLES, 'leiden', { resolution, neighbours, seed }, previous)
      lastWindow.current = { rows, grouping }
      setWindowGrouping(lastWindow.current)
    }
    run()
    const id = setInterval(run, 1000 / clusterRate)
    return () => clearInterval(id)
  }, [windowed, clusterRate, rows, rowLabels, traces, playhead, playhead.speed, playhead.loop, trailSeconds, resolution, neighbours, seed, fullGrouping])
  const grouping = windowed && windowGrouping?.rows === rows ? windowGrouping.grouping : fullGrouping

  const colors = useMemo(() => groupColors(grouping), [grouping])
  const slotOf = useMemo(() => chordSlots(grouping, points, meta.nPcs, order), [grouping, points, meta.nPcs, order])

  const followed = focus !== null && focus < rows.length ? focus : rows.length ? 0 : null
  const shown = hover ?? followed
  const toggleDigit = (d: number) => {
    const next = new Set(digits)
    if (next.has(d) && next.size > 1) next.delete(d)
    else next.add(d)
    setDigits(next)
  }
  const setSignalKey = <K extends keyof SignalSettings>(key: K, value: SignalSettings[K]) => setSignal((s) => ({ ...s, [key]: value }))
  const setParticleKey = <K extends keyof ParticleSettings>(key: K, value: ParticleSettings[K]) => setParticles((p) => ({ ...p, [key]: value }))
  const particleSlider = (key: 'cohesion' | 'separation' | 'centreForce' | 'spread' | 'radius' | 'damping', label: string, min: number, max: number, step: number, digits: number) => (
    <label className="slider">
      {label}
      <input type="range" min={min} max={max} step={step} value={particles[key]} onChange={(e) => setParticleKey(key, Number(e.target.value))} />
      <span className="num">{particles[key].toFixed(digits)}</span>
    </label>
  )

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
        <Presets settings={settings} onLoad={applySettings} />

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
          <button onClick={() => setDigits(new Set(Array.from({ length: N_DIGITS }, (_, d) => d)))}>all</button>
          <label className="slider">
            sample
            <input type="range" min={2} max={maxCount} value={shownCount} onChange={(e) => setCount(Number(e.target.value))} />
            <span className="num">
              {shownCount} of {available}
            </span>
          </label>
          <button onClick={() => setSeed((s) => s + 1)} title="Pick another sample of these digits">
            ⟳ Reshuffle
          </button>
        </div>

        <div className="toolbar">
          <span className="control-label">Color by</span>
          <Segmented options={['digit', 'leiden'] as const} value={groupBy} onChange={setGroupBy} labels={{ digit: 'Label', leiden: 'Leiden' }} />
          {groupBy === 'leiden' && (
            <>
              <label className="slider">
                resolution
                <input type="range" min={0.1} max={3} step={0.1} value={resolution} onChange={(e) => setResolution(Number(e.target.value))} />
                <span className="num">{resolution.toFixed(1)}</span>
              </label>
              <label className="slider">
                neighbours
                <input type="range" min={3} max={30} step={1} value={neighbours} onChange={(e) => setNeighbours(Number(e.target.value))} />
                <span className="num">{neighbours}</span>
              </label>
              <span className="control-label">Cluster over</span>
              <Segmented options={['full', 'window'] as const} value={clusterOver} onChange={setClusterOver} />
              {clusterOver === 'window' && (
                <label className="slider" title="How often to re-cluster over the window while playing">
                  re-cluster
                  <input type="range" min={0.25} max={10} step={0.25} value={clusterRate} onChange={(e) => setClusterRate(Number(e.target.value))} />
                  <span className="num">{clusterRate} /s</span>
                </label>
              )}
              <span className="muted num">
                {grouping.groups.length} clusters · modularity {grouping.modularity?.toFixed(2)}
              </span>
            </>
          )}
          <span className="control-label">Chord order</span>
          <Segmented options={['random', 'grouped'] as const} value={order} onChange={setOrder} />
        </div>

        <div className="toolbar">
          <span className="control-label">Reading</span>
          <Segmented options={Object.keys(READING_LABELS) as ReadingKey[]} value={signal.reading} onChange={(v) => setSignalKey('reading', v)} labels={READING_LABELS} />
          <label className="check">
            <input type="checkbox" checked={signal.skipBlank} onChange={(e) => setSignalKey('skipBlank', e.target.checked)} /> skip blank pixels
          </label>
          <Segmented options={['blur', 'lag'] as const} value={signal.smoothing} onChange={(v) => setSignalKey('smoothing', v)} />
          <label className="slider">
            smoothing
            <input
              type="range"
              min={0}
              max={8}
              step={0.25}
              value={signal.smoothingPixels}
              onChange={(e) => setSignalKey('smoothingPixels', Number(e.target.value))}
            />
            <span className="num">{signal.smoothingPixels} px</span>
          </label>
          <Segmented
            options={['ink', 'ink-only'] as const}
            value={signal.mapping}
            onChange={(v) => setSignalKey('mapping', v)}
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
            <Segmented options={['2d', '2d-ts', '3d'] as const} value={view} onChange={setView} labels={VIEW_LABELS} />
            <Segmented options={GEO_MODES} value={geometry} onChange={setGeometry} />
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
              trailPixels={trailSeconds * playhead.speed}
              following={hover === null}
              focusRing={style.focusRing}
              onFocusRing={(on) => setStyle((s) => ({ ...s, focusRing: on }))}
            />
          )}
          <h2>Groups: mean valence now</h2>
          <GroupLegend
            groups={grouping.groups}
            groupOf={grouping.groupOf}
            colors={colors}
            traces={traces}
            playhead={playhead}
            trailPixels={trailSeconds * playhead.speed}
            pixels={pixels}
            rows={rows}
            onFocus={setFocus}
            onHover={setHover}
          />
          {geometry === 'particle' && (
            <div className="particle-settings">
              <h2>Particles</h2>
              <p className="muted">Groups pull together; the centre pulls ink in and pushes paper out, by each digit's valence now.</p>
              {particleSlider('cohesion', 'within groups', -1, 1, 0.05, 2)}
              {particleSlider('separation', 'between groups', -1, 1, 0.05, 2)}
              {particleSlider('centreForce', 'centre', 0, 6, 0.1, 1)}
              {particleSlider('spread', 'spread', 0.2, 1.5, 0.05, 2)}
              {particleSlider('radius', 'reach', 10, 150, 1, 0)}
              {particleSlider('damping', 'damping', 0.5, 0.99, 0.01, 2)}
              <label className="check">
                <input type="checkbox" checked={particles.reverseCentre} onChange={(e) => setParticleKey('reverseCentre', e.target.checked)} /> ink repels from
                centre
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
                    onClick={() => setStyle((s) => ({ ...s, colorBy: { ...s.colorBy, [el]: by } }))}
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
                onChange={(e) => setStyle((s) => ({ ...s, opacity: { ...s.opacity, [el]: Number(e.target.value) } }))}
              />
            ))}
          </div>
          <label className="slider">
            cursor size
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={style.cursorSize}
              onChange={(e) => setStyle((s) => ({ ...s, cursorSize: Number(e.target.value) }))}
            />
            <span className="num">{style.cursorSize}</span>
          </label>
          <label className="slider">
            chord width
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={style.chordWidth}
              onChange={(e) => setStyle((s) => ({ ...s, chordWidth: Number(e.target.value) }))}
            />
            <span className="num">{style.chordWidth} px</span>
          </label>
          <label className="slider">
            trace width
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={style.traceWidth}
              onChange={(e) => setStyle((s) => ({ ...s, traceWidth: Number(e.target.value) }))}
            />
            <span className="num">{style.traceWidth}</span>
          </label>
        </aside>
      </div>

      <section className="matrix-section">
        <h2>Matrix</h2>
        <p className="muted">
          One row per digit, in chord order, one column per pixel. Click a row to follow that digit.
        </p>
        <Transport playhead={playhead} traces={traces} trailSeconds={trailSeconds} onTrailSeconds={setTrailSeconds} />
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
          trailPixels={trailSeconds * playhead.speed}
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
