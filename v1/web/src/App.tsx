import { useMemo, useState } from 'react'
import { MATRIX_URLS, useMnistData } from './useMnistData'
import { MatrixPanel } from './components/MatrixPanel'
import { DigitPreview } from './components/DigitPreview'
import { UmapPlot } from './components/UmapPlot'
import { ClusterTable } from './components/ClusterTable'
import { ClusterSamples } from './components/ClusterSamples'
import { DIGIT_COLORS } from './palette'

const MATRIX_HEIGHT = 720

export default function App() {
  const { data, error } = useMnistData()
  const [hovered, setHovered] = useState<number | null>(null)
  const identity = useMemo(() => (data ? data.meta.rows.label.map((_, i) => i) : []), [data])

  if (error) return <main className="status">Failed to load data: {error}</main>
  if (!data) return <main className="status">Loading…</main>

  const { meta } = data
  const p = meta.params

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
          onHover={setHovered}
        />
        <MatrixPanel
          title="Sorted by cluster"
          subtitle="Clusters in dendrogram order; rows within a cluster ordered by its own PC1"
          imageUrl={MATRIX_URLS.sorted}
          meta={meta}
          order={meta.sortedOrder}
          height={MATRIX_HEIGHT}
          showBoundaries
          hovered={hovered}
          onHover={setHovered}
        />
        <aside className="sidebar">
          <DigitPreview data={data} row={hovered} />
          <h3>UMAP</h3>
          <UmapPlot meta={meta} hovered={hovered} onHover={setHovered} />
        </aside>
      </div>

      <h3>Samples per cluster</h3>
      <p className="section-note">
        Evenly spaced along each cluster's sorted order. Outlined digits disagree with the cluster's majority label.
      </p>
      <ClusterSamples data={data} hovered={hovered} onHover={setHovered} />

      <h3>Clusters</h3>
      <ClusterTable meta={meta} />
    </main>
  )
}
