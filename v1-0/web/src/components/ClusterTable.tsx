import type { Meta } from '../types'
import { DIGIT_COLORS } from '../palette'

export function ClusterTable({ meta }: { meta: Meta }) {
  return (
    <table className="clusters">
      <thead>
        <tr>
          <th>Cluster</th>
          <th>Size</th>
          <th>Purity</th>
          <th>Label composition</th>
        </tr>
      </thead>
      <tbody>
        {meta.clusters.map((c) => (
          <tr key={c.id}>
            <td>
              <span className="swatch" style={{ background: DIGIT_COLORS[c.majorityLabel] }} /> #{c.id}
            </td>
            <td className="num">{c.size}</td>
            <td className="num">{Math.round(c.purity * 100)}%</td>
            <td>
              <div className="composition">
                {c.labelCounts.map((count, digit) =>
                  count === 0 ? null : (
                    <div
                      key={digit}
                      style={{ flexGrow: count, background: DIGIT_COLORS[digit] }}
                      title={`${digit}: ${count}`}
                    >
                      {count / c.size > 0.08 ? digit : ''}
                    </div>
                  ),
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
