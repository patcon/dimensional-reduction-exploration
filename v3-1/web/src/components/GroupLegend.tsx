import { useEffect, useMemo, useRef } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import type { Group } from '../selection'
import { accentOf, shadeDigit } from '../digitImage'
import { shuffle } from '../rng'
import { SIDE, valenceAt, type Traces } from '../signal'

/** Sample digits shown beside each group. */
const THUMBS = 8

/**
 * Up to THUMBS participants per group: its members that come first in `order`, a random order of
 * every participant. A group's picks change only when one of them leaves or an earlier one joins, so
 * they hold steady through churn; and they're a fair sample, so groups merging show both.
 */
function pickThumbs(groupCount: number, groupOf: Int32Array, order: number[]) {
  const picks = Array.from({ length: groupCount }, () => [] as number[])
  for (const i of order) if (picks[groupOf[i]]?.length < THUMBS) picks[groupOf[i]].push(i)
  return picks
}

interface ThumbProps {
  pixels: Uint8Array
  poolRow: number
  traces: Traces
  playhead: Playhead
  trailPixels: number
  onClick: () => void
  onHover: (on: boolean) => void
}

/** One digit, small, read as it plays (as the followed digit is); click to follow it. */
function Thumb({ pixels, poolRow, traces, playhead, trailPixels, onClick, onHover }: ThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    const accent = accentOf(canvas)
    const draw = () => {
      shadeDigit(img, pixels, poolRow, traces, playhead, trailPixels, accent)
      ctx.putImageData(img, 0, 0)
    }
    draw()
    return playhead.onFrame(draw)
  }, [pixels, poolRow, traces, playhead, playhead.loop, trailPixels])
  return <canvas ref={ref} width={SIDE} height={SIDE} onClick={onClick} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} />
}

/**
 * Each group, its size, its mean valence right now (a bar from the middle: left disagrees, right
 * agrees) and a few of its digits, picked at random and kept while they stay in the group.
 */
export function GroupLegend({
  groups,
  groupOf,
  colors,
  traces,
  playhead,
  trailPixels,
  pixels,
  rows,
  onFocus,
  onHover,
}: {
  groups: Group[]
  groupOf: Int32Array
  colors: RGB[]
  traces: Traces
  playhead: Playhead
  trailPixels: number
  pixels: Uint8Array
  /** Each participant's row in the pool. */
  rows: number[]
  onFocus: (participant: number) => void
  onHover: (participant: number | null) => void
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([])

  // Drawn afresh for each sample of digits, and kept as re-clustering regroups them.
  const order = useMemo(() => shuffle(rows.map((_, i) => i), Math.random), [rows])
  const picks = useMemo(() => pickThumbs(groups.length, groupOf, order), [groups.length, groupOf, order])

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
          <span className="group-thumbs">
            {picks[gi]?.map((i) => (
              <Thumb
                key={i}
                pixels={pixels}
                poolRow={rows[i]}
                traces={traces}
                playhead={playhead}
                trailPixels={trailPixels}
                onClick={() => onFocus(i)}
                onHover={(on) => onHover(on ? i : null)}
              />
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}
