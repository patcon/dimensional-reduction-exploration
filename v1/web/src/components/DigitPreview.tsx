import { useEffect, useRef } from 'react'
import type { MnistData } from '../useMnistData'
import { DIGIT_COLORS } from '../palette'

export function DigitPreview({
  data,
  row,
  pinned,
  onUnpin,
}: {
  data: MnistData
  row: number | null
  pinned: boolean
  onUnpin: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { meta, pixels } = data

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(28, 28)
    if (row !== null) {
      const offset = row * meta.nPixels
      for (let i = 0; i < 784; i++) {
        const v = pixels[offset + i]
        img.data.set([v, v, v, 255], i * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [row, meta, pixels])

  const cluster = row === null ? null : meta.clusters.find((c) => c.id === meta.rows.cluster[row])!
  const label = row === null ? null : meta.rows.label[row]

  return (
    <div className="digit-preview">
      <canvas ref={ref} width={28} height={28} />
      {row === null ? (
        <p className="muted">Hover a row in either matrix, a sample, or a point in the projection. Click to pin it.</p>
      ) : (
        <dl>
          <dt>Label</dt>
          <dd>
            <span className="swatch" style={{ background: DIGIT_COLORS[label!] }} /> {label}
          </dd>
          <dt>Cluster</dt>
          <dd>
            <span className="swatch" style={{ background: DIGIT_COLORS[cluster!.majorityLabel] }} /> #{cluster!.id}{' '}
            <span className="muted">
              (mostly {cluster!.majorityLabel}, {Math.round(cluster!.purity * 100)}% pure)
            </span>
          </dd>
          <dt>MNIST index</dt>
          <dd>{meta.rows.sourceIndex[row]}</dd>
          <dt>{pinned ? 'Pinned' : ''}</dt>
          <dd>
            {pinned ? (
              <button className="link" onClick={onUnpin}>
                Unpin (Esc)
              </button>
            ) : (
              <span className="muted">Click to pin</span>
            )}
          </dd>
        </dl>
      )}
    </div>
  )
}
