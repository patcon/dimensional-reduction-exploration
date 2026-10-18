import { useEffect, useMemo, useState } from 'react'
import { MATRIX_URLS, useMnistData } from './useMnistData'
import { MatrixPanel } from './components/MatrixPanel'
import { DigitPreview } from './components/DigitPreview'
import { ProjectionPlot, type GroupPath } from './components/ProjectionPlot'
import { ClusterTable } from './components/ClusterTable'
import { ClusterSamples } from './components/ClusterSamples'
import { DIGIT_COLORS } from './palette'
import type { GroupKey, WithinKey } from './types'
import { SWEEP_DWELL_MS, type Sweep } from './sweep'
import { pixelOrderFor, type PixelOrderKey } from './pixelOrder'

const MATRIX_HEIGHT = 720

const GROUPS: Record<GroupKey, { label: string; describe: string }> = {
  leiden: { label: 'Leiden', describe: 'Leiden clusters in dendrogram order' },
  label: { label: 'Labels', describe: 'Digits 0–9' },
}

const PIXEL_ORDER_OPTIONS: Record<PixelOrderKey, { label: string }> = {
  rowMajor: { label: 'Row by row' },
  shuffled: { label: 'Shuffled' },
}

const WITHINS: Record<WithinKey, { label: string; describe: string }> = {
  random: { label: 'Random', describe: 'rows in random order within each group' },
  pc1: { label: 'PC1', describe: "rows ordered along each group's own first principal component" },
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
  const [groupBy, setGroupBy] = useState<GroupKey>('label')
  const [within, setWithin] = useState<WithinKey>('pc1')
  // Digit resolution (side length) shown everywhere; null until data arrives, then the largest.
  const [resolutionChoice, setResolution] = useState<number | null>(null)
  const [pixelOrderKey, setPixelOrderKey] = useState<PixelOrderKey>('rowMajor')
  const identity = useMemo(() => (data ? data.meta.rows.label.map((_, i) => i) : []), [data])

  // One path per group of the active sorting, coloured like that group in the strips.
  const paths = useMemo<GroupPath[]>(() => {
    if (!data) return []
    const { meta } = data
    const { order, boundaries } = meta.sortings[groupBy][within]
    const majority = new Map(meta.clusters.map((c) => [c.id, c.majorityLabel]))
    const starts = [0, ...boundaries]
    return starts.map((start, i) => {
      const rows = order.slice(start, starts[i + 1] ?? order.length)
      const digit = groupBy === 'leiden' ? majority.get(meta.rows.cluster[rows[0]])! : meta.rows.label[rows[0]]
      return { rows, color: DIGIT_COLORS[digit] }
    })
  }, [data, groupBy, within])

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
  const pixelOrder = pixelOrderFor(pixelOrderKey, resolution * resolution)
  const sorting = meta.sortings[groupBy][within]

  return (
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
        <p>Hover any digit to find it in every view, pause to watch its pixels become a row, and click to pin it.</p>
        <div className="page-controls">
          <span className="muted">Pixel order</span>
          <Segmented options={PIXEL_ORDER_OPTIONS} value={pixelOrderKey} onChange={setPixelOrderKey} ariaLabel="Pixel order" />
          <span className="muted">
            {pixelOrderKey === 'shuffled'
              ? `Every row gets the same shuffle of its ${resolution * resolution} pixels (after pooling). The projections are unchanged: they never used the pixel layout.`
              : 'Shuffle the pixel columns to see what the projections actually rely on.'}
          </span>
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
        <MatrixPanel
          title="Original"
          subtitle={`Random subsample order; ${resolution}×${resolution} = ${resolution * resolution} pixels per row`}
          imageUrl={MATRIX_URLS.original(resolution)}
          meta={meta}
          order={identity}
          resolution={resolution}
          pixelOrder={pixelOrder}
          height={MATRIX_HEIGHT}
          hovered={hovered}
          selected={selected}
          sweep={sweep}
          onHover={setHovered}
          onSelect={toggleSelected}
        />
        <MatrixPanel
          title="Sorted"
          subtitle={`${GROUPS[groupBy].describe}; ${WITHINS[within].describe}`}
          controls={
            <>
              <Segmented options={GROUPS} value={groupBy} onChange={setGroupBy} ariaLabel="Group rows by" />
              <span className="muted">then</span>
              <Segmented options={WITHINS} value={within} onChange={setWithin} ariaLabel="Order within groups by" />
            </>
          }
          imageUrl={MATRIX_URLS.sorted(groupBy, within, resolution)}
          meta={meta}
          order={sorting.order}
          resolution={resolution}
          pixelOrder={pixelOrder}
          height={MATRIX_HEIGHT}
          boundaries={sorting.boundaries}
          hovered={hovered}
          selected={selected}
          sweep={sweep}
          onHover={setHovered}
          onSelect={toggleSelected}
        />
        <aside className="sidebar">
          <DigitPreview
            data={data}
            row={focus}
            resolution={resolution}
            pixelOrder={pixelOrder}
            pinned={selected !== null}
            sweep={sweep}
            onUnpin={() => setSelected(null)}
          />
          <ProjectionPlot
            meta={meta}
            resolution={resolution}
            onResolution={setResolution}
            paths={paths}
            pathsLabel={`${GROUPS[groupBy].label} groups in ${within === 'pc1' ? 'PC1' : 'random'} order`}
            hovered={hovered}
            selected={selected}
            onHover={setHovered}
            onSelect={toggleSelected}
          />
        </aside>
      </div>

      <h3>Samples per cluster</h3>
      <p className="section-note">
        Evenly spaced along each cluster's sorted order. Outlined digits disagree with the cluster's majority label.
      </p>
      <ClusterSamples data={data} resolution={resolution} pixelOrder={pixelOrder} hovered={hovered} selected={selected} onHover={setHovered} onSelect={toggleSelected} />

      <h3>Clusters</h3>
      <ClusterTable meta={meta} />
    </main>
  )
}
