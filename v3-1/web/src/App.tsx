import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChordViz } from './components/ChordViz'
import { DigitPreview } from './components/DigitPreview'
import { GroupLegend } from './components/GroupLegend'
import { Matrix } from './components/Matrix'
import { Transport } from './components/Transport'
import { DIGIT_COLORS, groupColors } from './palette'
import { usePlayhead } from './playhead'
import {
  chordSlots,
  groupParticipants,
  N_DIGITS,
  pcsOf,
  pickRows,
  windowFeatures,
  type ChordOrder,
  type ClusterOver,
  type GroupBy,
  type Grouping,
} from './selection'
import { buildTraces, READING_LABELS, type ReadingKey, type SignalSettings } from './signal'
import { useData, type PoolData } from './useData'
import { DEFAULT_STYLE, ELEMENTS, GEO_MODES, MAX_CHORDS, VIEW_LABELS, type GeoMode, type ViewMode, type VizStyle } from './vizSettings'

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
  const [digits, setDigits] = useState<Set<number>>(() => new Set([0, 1, 6, 9]))
  const [count, setCount] = useState(100)
  const [seed, setSeed] = useState(0)
  // How they're grouped and laid out.
  const [groupBy, setGroupBy] = useState<GroupBy>('digit')
  const [resolution, setResolution] = useState(1)
  const [neighbours, setNeighbours] = useState(15)
  const [clusterOver, setClusterOver] = useState<ClusterOver>('full')
  const [order, setOrder] = useState<ChordOrder>('grouped')
  // How each digit is read out as valence.
  const [signal, setSignal] = useState<SignalSettings>({ reading: 'hilbert', skipBlank: false, smoothing: 'blur', smoothingPixels: 1.5, mapping: 'ink' })
  // How it's drawn.
  const [view, setView] = useState<ViewMode>('3d')
  const [geometry, setGeometry] = useState<GeoMode>('diametric')
  const [style, setStyle] = useState<VizStyle>({ ...DEFAULT_STYLE, colorBy: { ...DEFAULT_STYLE.colorBy, chord: 'group' } })
  const [trailSeconds, setTrailSeconds] = useState(10)
  const [focus, setFocus] = useState<number | null>(0)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = usePlayhead()

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

  // Clustering over the trail's window: re-run every second the playhead has moved, each run
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
      const features = windowFeatures(traces, playhead.moment, trailSeconds * playhead.speed, WINDOW_SAMPLES)
      const grouping = groupParticipants(rowLabels, features, WINDOW_SAMPLES, 'leiden', { resolution, neighbours, seed }, previous)
      lastWindow.current = { rows, grouping }
      setWindowGrouping(lastWindow.current)
    }
    run()
    const id = setInterval(run, 1000)
    return () => clearInterval(id)
  }, [windowed, rows, rowLabels, traces, playhead, playhead.speed, trailSeconds, resolution, neighbours, seed, fullGrouping])
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
          />
          <div className="viz-controls">
            <Segmented options={['2d', '2d-ts', '3d'] as const} value={view} onChange={setView} labels={VIEW_LABELS} />
            <Segmented options={GEO_MODES} value={geometry} onChange={setGeometry} />
          </div>
          {view === '3d' && <div className="viz-hint">drag to orbit · scroll to zoom</div>}
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
            />
          )}
          <h2>Groups: mean valence now</h2>
          <GroupLegend groups={grouping.groups} groupOf={grouping.groupOf} colors={colors} traces={traces} playhead={playhead} />
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
