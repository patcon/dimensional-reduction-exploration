import { useEffect, useMemo, useState } from 'react'
import { MATRIX_URLS, useMnistData } from './useMnistData'
import { MatrixPanel } from './components/MatrixPanel'
import { DigitView } from './components/DigitView'
import { ProjectionPlot, type GroupPath } from './components/ProjectionPlot'
import { ClusterTable } from './components/ClusterTable'
import { ClusterSamples } from './components/ClusterSamples'
import { DIGIT_COLORS } from './palette'
import type { GroupKey, WithinKey } from './types'
import { SWEEP_DWELL_MS, type Sweep } from './sweep'
import { pixelOrderFor, type PixelShuffle } from './pixelOrder'
import { GREYSCALE, PixelThemeContext, VOTES, VOTE_COLORS } from './pixelTheme'

const MATRIX_HEIGHT = 720

// 'none' treats every row as one group, so none + random is the unsorted matrix.
const GROUPS: Record<GroupKey, { label: string; describe: string }> = {
  none: { label: 'None', describe: 'All rows as one group' },
  label: { label: 'Labels', describe: 'Digits 0–9' },
  leiden: { label: 'Leiden', describe: 'Leiden clusters in dendrogram order' },
}

const LAYOUTS: Record<'1' | '2', { label: string }> = {
  1: { label: 'Simple (1 column)' },
  2: { label: 'Comparison (2 column)' },
}

type ShuffleAxis = 'rows' | 'columns'

const SHUFFLE_AXES: Record<ShuffleAxis, { label: string }> = {
  rows: { label: 'Rows' },
  columns: { label: 'Columns' },
}

const WITHINS: Record<WithinKey, { label: string; describe: string }> = {
  random: { label: 'Random', describe: 'rows in random order within each group' },
  pc1: { label: 'PC1', describe: "rows ordered along each group's own first principal component" },
}

interface SortChoice {
  group: GroupKey
  within: WithinKey
}

function describeSort({ group, within }: SortChoice) {
  if (group !== 'none') return `${GROUPS[group].describe}; ${WITHINS[within].describe}`
  return within === 'random' ? 'Random subsample order' : 'All rows ordered along their shared first principal component'
}

function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Record<K, { label: string }>
  value: K
  onChange: (key: K) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {(Object.keys(options) as K[]).map((key) => (
        <button key={key} role="tab" aria-selected={key === value} className={key === value ? 'on' : ''} onClick={() => onChange(key)}>
          {options[key].label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const { data, error } = useMnistData()
  const [hovered, setHovered] = useState<number | null>(null)
  // A clicked row stays pinned: it drives the preview and path highlight until unpinned.
  const [selected, setSelected] = useState<number | null>(null)
  const toggleSelected = (row: number | null) => setSelected((s) => (row === null || s === row ? null : row))
  // Each matrix picks its own sorting, so either can serve as the baseline for the other.
  const [sorts, setSorts] = useState<[SortChoice, SortChoice]>([
    { group: 'none', within: 'random' },
    { group: 'label', within: 'pc1' },
  ])
  // Show just the first matrix, or both side by side for comparison.
  const [columns, setColumns] = useState<'1' | '2'>('2')
  // Colours and sort paths follow the last-changed visible matrix that has groups, else the other one.
  // (A single all-rows path would just tangle across the whole plot.)
  const [lastChanged, setLastChanged] = useState<0 | 1>(1)
  const updateSort = (side: 0 | 1, next: Partial<SortChoice>) => {
    setSorts((s) => {
      const copy: [SortChoice, SortChoice] = [s[0], s[1]]
      copy[side] = { ...s[side], ...next }
      return copy
    })
    setLastChanged(side)
  }
  const visibleSorts = columns === '1' ? [sorts[0]] : [sorts[lastChanged], sorts[1 - lastChanged]]
  const pathSort = visibleSorts.find((s) => s.group !== 'none')
  const groupBy = pathSort?.group === 'leiden' ? 'leiden' : 'label'
  const within = pathSort?.within ?? null
  // Digit resolution (side length) shown everywhere; null until data arrives, then the largest.
  const [resolutionChoice, setResolution] = useState<number | null>(null)
  const [shuffle, setShuffle] = useState<PixelShuffle>({ rows: false, columns: false, all: false })
  // Draw black, grey and white pixels as disagree, pass and agree.
  const [asVotes, setAsVotes] = useState(false)

  // Each row's colour under the active grouping: its Leiden cluster's majority digit, or its own label.
  const pointColors = useMemo(() => {
    if (!data) return []
    const { meta } = data
    if (groupBy === 'label') return meta.rows.label.map((d) => DIGIT_COLORS[d])
    const majority = new Map(meta.clusters.map((c) => [c.id, c.majorityLabel]))
    return meta.rows.cluster.map((c) => DIGIT_COLORS[majority.get(c)!])
  }, [data, groupBy])

  // One path per group of the active sorting, coloured like that group in the strips.
  const paths = useMemo<GroupPath[]>(() => {
    if (!data || !within) return []
    const { meta } = data
    const { order, boundaries } = meta.sortings[groupBy][within]
    const starts = [0, ...boundaries]
    return starts.map((start, i) => {
      const rows = order.slice(start, starts[i + 1] ?? order.length)
      return { rows, color: pointColors[rows[0]] }
    })
  }, [data, groupBy, within, pointColors])

  // Once the focused digit (pinned, else hovered) holds still, sweep through its pixels.
  const focus = selected ?? hovered
  const [sweep, setSweep] = useState<Sweep | null>(null)
  useEffect(() => {
    if (focus === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setTimeout(() => setSweep({ row: focus, start: performance.now() }), SWEEP_DWELL_MS)
    return () => {
      clearTimeout(timer)
      setSweep(null)
    }
  }, [focus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error) return <main className="status">Failed to load data: {error}</main>
  if (!data) return <main className="status">Loading…</main>

  const { meta } = data
  const p = meta.params
  const resolution = resolutionChoice ?? meta.resolutions[0]
  const pixelOrder = pixelOrderFor(shuffle, resolution)
  const shuffled = (Object.keys(SHUFFLE_AXES) as ShuffleAxis[]).filter((axis) => shuffle[axis])

  return (
    <PixelThemeContext value={asVotes ? VOTES : GREYSCALE}>
      <main>
        <header className="page-header">
          <h1>MNIST, from pixels to projections</h1>
          <p>
            Each 28×28 digit is padded to 32×32 and flattened into a single row of pixels, and{' '}
            {meta.nSamples.toLocaleString()} of those rows are stacked into a matrix. PCA ({p.n_pcs} components) → kNN
            graph (k={p.n_neighbors}) → Leiden (resolution {p.resolution}) finds{' '}
            <strong>{meta.nClusters} clusters</strong>. The sorted matrix regroups rows by cluster or true label, and
            UMAP, PaCMAP and LocalMAP lay the same digits out in 2D and 3D.
          </p>
          <p>
            Each digit is also average-pooled down to 16×16, 8×8, 4×4 and 2×2, and every projection is recomputed at each
            resolution. Clusters stay fixed at 32×32, so colours show how well a coarser digit keeps its cluster together.
            Pick a resolution above the projection to watch the layout morph.
          </p>
          <p>
            Every pooled digit is then posterised to just three shades: the middle{' '}
            {Math.round((p.grey_band ?? 1 / 3) * 100)}% of the brightness range becomes mid-grey, darker pixels black and
            lighter ones white. Clusters and projections only ever see those three levels.
          </p>
          <p>Hover any digit to find it in every view, pause to watch its pixels become a row, and click to pin it.</p>
          <div className="page-controls">
            <span className="muted">Pixel shuffling</span>
            {/* Rows and columns combine; all pixels is a different kind of shuffle, so it clears them (and vice versa). */}
            <div className="segmented" role="group" aria-label="Shuffle pixel rows or columns">
              {(Object.keys(SHUFFLE_AXES) as ShuffleAxis[]).map((axis) => (
                <button
                  key={axis}
                  aria-pressed={shuffle[axis]}
                  className={shuffle[axis] ? 'on' : ''}
                  onClick={() => setShuffle((s) => ({ ...s, [axis]: !s[axis], all: false }))}
                >
                  {SHUFFLE_AXES[axis].label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Shuffle all pixels">
              <button
                aria-pressed={shuffle.all}
                className={shuffle.all ? 'on' : ''}
                onClick={() => setShuffle((s) => ({ rows: false, columns: false, all: !s.all }))}
              >
                All pixels
              </button>
            </div>
            <span className="muted page-controls-note">
              {shuffle.all
                ? `Same shuffle of all ${resolution * resolution} pixels in every digit. Projections don't change: they ignore pixel layout.`
                : shuffled.length
                  ? `Same shuffle of ${shuffled.join(' and ')} in every digit, so the grid survives. Projections don't change: they ignore pixel layout.`
                  : 'Shuffle every digit the same way to see what the projections rely on.'}
            </span>
          </div>
          <div className="page-controls">
            <label className="checkbox" title="Draw black, grey and white pixels as disagree, pass and agree">
              <input type="checkbox" checked={asVotes} onChange={(e) => setAsVotes(e.target.checked)} />
              Theme as votes
            </label>
            {asVotes && (
              <ul className="legend">
                {(['agree', 'pass', 'disagree'] as const).map((vote) => (
                  <li key={vote}>
                    <span className="swatch" style={{ background: VOTE_COLORS[vote] }} /> {vote}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="legend">
            {DIGIT_COLORS.map((c, d) => (
              <li key={d}>
                <span className="swatch" style={{ background: c }} /> {d}
              </li>
            ))}
          </ul>
        </header>

        <div className="layout">
          <div className="content">
            <div className="page-controls">
              <Segmented options={LAYOUTS} value={columns} onChange={setColumns} ariaLabel="Number of matrices" />
            </div>
            <div className="matrices">
              {(columns === '1' ? ([0] as const) : ([0, 1] as const)).map((side) => {
                const sort = sorts[side]
                const sorting = meta.sortings[sort.group][sort.within]
                return (
                  <MatrixPanel
                    key={side}
                    title="Sorting"
                    subtitle={`${describeSort(sort)}; ${resolution}×${resolution} = ${resolution * resolution} pixels per row`}
                    controls={
                      <>
                        <Segmented
                          options={GROUPS}
                          value={sort.group}
                          onChange={(group) => updateSort(side, { group })}
                          ariaLabel="Group rows by"
                        />
                        <span className="muted">then</span>
                        <Segmented
                          options={WITHINS}
                          value={sort.within}
                          onChange={(within) => updateSort(side, { within })}
                          ariaLabel="Order within groups by"
                        />
                      </>
                    }
                    imageUrl={MATRIX_URLS.sorted(sort.group, sort.within, resolution)}
                    meta={meta}
                    order={sorting.order}
                    resolution={resolution}
                    pixelOrder={pixelOrder}
                    height={MATRIX_HEIGHT}
                    // A lone matrix gets 1px per column at full resolution, and the same width (whole px per column) below it.
                    width={columns === '1' ? meta.resolutions[0] ** 2 : undefined}
                    boundaries={sorting.boundaries}
                    hovered={hovered}
                    selected={selected}
                    sweep={sweep}
                    onHover={setHovered}
                    onSelect={toggleSelected}
                  />
                )
              })}
            </div>

            <h3>Samples per cluster</h3>
            <p className="section-note">
              Evenly spaced along each cluster's sorted order. Outlined digits disagree with the cluster's majority label.
            </p>
            <ClusterSamples data={data} resolution={resolution} pixelOrder={pixelOrder} hovered={hovered} selected={selected} onHover={setHovered} onSelect={toggleSelected} />

            <h3>Clusters</h3>
            <ClusterTable meta={meta} />
          </div>
          <aside className="sidebar">
            <DigitView
              data={data}
              row={focus}
              resolution={resolution}
              shuffle={shuffle}
              pixelOrder={pixelOrder}
              pinned={selected !== null}
              sweep={sweep}
              onResolution={setResolution}
              onUnpin={() => setSelected(null)}
            />
            <ProjectionPlot
              meta={meta}
              resolution={resolution}
              onResolution={setResolution}
              pointColors={pointColors}
              paths={paths}
              pathsLabel={within ? `${GROUPS[groupBy].label} groups in ${within === 'pc1' ? 'PC1' : 'random'} order` : 'no groups, as neither matrix is sorted'}
              hovered={hovered}
              selected={selected}
              onHover={setHovered}
              onSelect={toggleSelected}
            />
          </aside>
        </div>
      </main>
    </PixelThemeContext>
  )
}
