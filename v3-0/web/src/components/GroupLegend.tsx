import { useEffect, useRef } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import type { Group } from '../selection'
import { valenceAt, type Traces } from '../signal'

/** Each group, its size and its mean valence right now (a bar from the middle: left disagrees, right agrees). */
export function GroupLegend({
  groups,
  groupOf,
  colors,
  traces,
  playhead,
}: {
  groups: Group[]
  groupOf: Int32Array
  colors: RGB[]
  traces: Traces
  playhead: Playhead
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const sums = new Float64Array(groups.length)
    const draw = () => {
      sums.fill(0)
      for (let i = 0; i < traces.n; i++) sums[groupOf[i]] += valenceAt(traces, i, playhead.moment)
      groups.forEach((g, gi) => {
        const bar = barRefs.current[gi]
        if (!bar) return
        const mean = sums[gi] / g.size
        bar.style.left = `${50 + Math.min(0, mean) * 50}%`
        bar.style.width = `${Math.abs(mean) * 50}%`
        bar.style.background = mean >= 0 ? 'var(--agree)' : 'var(--disagree)'
      })
    }
    draw()
    return playhead.onFrame(draw)
  }, [groups, groupOf, traces, playhead])

  return (
    <ul className="group-legend">
      {groups.map((g, gi) => (
        <li key={gi} title={g.labelCounts.map((c, d) => (c ? `${c}×${d}` : '')).filter(Boolean).join(' ')}>
          <span className="swatch" style={{ background: rgbCss(colors[gi]) }} />
          <span className="group-name">{g.name}</span>
          <span className="num muted">{g.size}</span>
          <div className="group-mean">
            <div className="group-mean-zero" />
            <div className="group-mean-bar" ref={(el) => void (barRefs.current[gi] = el)} />
          </div>
        </li>
      ))}
    </ul>
  )
}
