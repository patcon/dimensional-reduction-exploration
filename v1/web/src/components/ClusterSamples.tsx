import { useEffect, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { DIGIT_COLORS } from '../palette'

const SAMPLES_PER_CLUSTER = 12

function Digit({ data, row }: { data: MnistData; row: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(28, 28)
    const offset = row * data.meta.nPixels
    for (let i = 0; i < 784; i++) {
      const v = data.pixels[offset + i]
      img.data.set([v, v, v, 255], i * 4)
    }
    ctx.putImageData(img, 0, 0)
  }, [data, row])
  return <canvas ref={ref} width={28} height={28} />
}

/** Samples are evenly spaced through each cluster's sorted rows, so they span its PC1 axis. */
export function ClusterSamples({
  data,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  data: MnistData
  hovered: number | null
  selected: number | null
  onHover: (row: number | null) => void
  onSelect: (row: number) => void
}) {
  const { meta } = data
  return (
    <div className="cluster-samples">
      {meta.clusters.map((c) => {
        const k = Math.min(SAMPLES_PER_CLUSTER, c.size)
        const rows = Array.from({ length: k }, (_, i) => {
          const pos = c.start + Math.round((i * (c.size - 1)) / Math.max(1, k - 1))
          return meta.sortings.leiden.pc1.order[pos]
        })
        return (
          <div key={c.id} className="sample-row">
            <div className="sample-head">
              <span className="swatch" style={{ background: DIGIT_COLORS[c.majorityLabel] }} /> #{c.id}
              <span className="muted">
                {' '}
                mostly {c.majorityLabel} · n={c.size}
              </span>
            </div>
            <ul className="samples">
              {rows.map((r) => {
                const label = meta.rows.label[r]
                return (
                  <li
                    key={r}
                    className={[label !== c.majorityLabel && 'mismatch', r === hovered && 'active', r === selected && 'selected']
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => onHover(r)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(r)}
                    title={`label ${label}`}
                  >
                    <Digit data={data} row={r} />
                    <span className="badge" style={{ background: DIGIT_COLORS[label] }}>
                      {label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
