import { useEffect, useMemo, useState } from 'react'
import { MATRIX_URLS, useMnistData } from './useMnistData'
import { MatrixPanel } from './components/MatrixPanel'
import { DigitPreview } from './components/DigitPreview'
import { ProjectionPlot, type GroupPath } from './components/ProjectionPlot'
import { ClusterTable } from './components/ClusterTable'
import { ClusterSamples } from './components/ClusterSamples'
import { DIGIT_COLORS } from './palette'
import type { GroupKey, WithinKey } from './types'

const MATRIX_HEIGHT = 720

const GROUPS: Record<GroupKey, { label: string; describe: string }> = {
  leiden: { label: 'Leiden', describe: 'Leiden clusters in dendrogram order' },
  label: { label: 'Labels', describe: 'Digits 0–9' },
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
  const [groupBy, setGroupBy] = useState<GroupKey>('leiden')
  const [within, setWithin] = useState<WithinKey>('pc1')
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error) return <main className="status">Failed to load data: {error}</main>
  if (!data) return <main className="status">Loading…</main>

  const { meta } = data
  const p = meta.params
  const sorting = meta.sortings[groupBy][within]

  return (
    <main>
      <header className="page-header">
        <h1>MNIST × Leiden</h1>
        <p>
          {meta.nSamples.toLocaleString()} digits, each a row of {meta.nPixels} pixels. PCA ({p.n_pcs}) → kNN graph (k=
          {p.n_neighbors}) → Leiden (resolution {p.resolution}) found <strong>{meta.nClusters} clusters</strong>.
        </p>
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
          subtitle="Random subsample order"
          imageUrl={MATRIX_URLS.original}
          meta={meta}
          order={identity}
          height={MATRIX_HEIGHT}
          hovered={hovered}
          selected={selected}
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
          imageUrl={MATRIX_URLS.sorted(groupBy, within)}
          meta={meta}
          order={sorting.order}
          height={MATRIX_HEIGHT}
          boundaries={sorting.boundaries}
          hovered={hovered}
          selected={selected}
          onHover={setHovered}
          onSelect={toggleSelected}
        />
        <aside className="sidebar">
          <DigitPreview data={data} row={selected ?? hovered} pinned={selected !== null} onUnpin={() => setSelected(null)} />
          <ProjectionPlot
            meta={meta}
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
      <ClusterSamples data={data} hovered={hovered} selected={selected} onHover={setHovered} onSelect={toggleSelected} />

      <h3>Clusters</h3>
      <ClusterTable meta={meta} />
    </main>
  )
}
