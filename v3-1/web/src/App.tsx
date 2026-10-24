import { useEffect, useMemo, useRef, useState } from 'react'
import { ChordViz } from './components/ChordViz'
import { Segmented } from './components/controls'
import { DigitPreview } from './components/DigitPreview'
import { GroupLegend } from './components/GroupLegend'
import { Matrix } from './components/Matrix'
import { Presets } from './components/Presets'
import { GroupingRow, ParticlePanel, ReadingRow, SampleRow, StylePanel } from './components/SettingsPanels'
import { Transport } from './components/Transport'
import { groupColors } from './palette'
import { usePlayhead } from './playhead'
import { useSettings } from './presets'
import { chordSlots, groupParticipants, pcsOf, pickRows, windowFeatures, type Grouping } from './selection'
import { buildTraces } from './signal'
import { useData, type PoolData } from './useData'
import { GEO_MODES, MAX_CHORDS, VIEW_LABELS } from './vizSettings'

/** Moments sampled across the trail's window when clustering over it. */
const WINDOW_SAMPLES = 32

function Explorer({ data }: { data: PoolData }) {
  const { meta, pixels, pcs } = data
  const labels = meta.rows.label

  // Every setting, as presets save and load them; the playhead follows its speed and looping.
  const { settings, setSettings, set, patch } = useSettings()
  const editor = { settings, set, patch }
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

        <SampleRow {...editor} available={available} shownCount={shownCount} maxCount={maxCount} />
        <GroupingRow {...editor} grouping={grouping} />
        <ReadingRow {...editor} />
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
          {geometry === 'particle' && <ParticlePanel {...editor} onScatter={() => setParticleReset((r) => r + 1)} />}
          <StylePanel {...editor} />
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
