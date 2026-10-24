import { useEffect, useRef, useState } from 'react'
import { rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import type { Group } from '../selection'
import { accentOf, shadeDigit } from '../digitImage'
import { SIDE, valenceAt, type Traces } from '../signal'

/** Sample digits shown beside each group. */
const THUMBS = 4

/** Up to THUMBS participants per group, by group name: those of `previous` still in it, then others at random. */
function pickThumbs(groups: Group[], groupOf: Int32Array, previous: Map<string, number[]>) {
  const members = groups.map(() => [] as number[])
  groupOf.forEach((g, i) => members[g]?.push(i))
  return new Map(
    groups.map((g, gi) => {
      const kept = (previous.get(g.name) ?? []).filter((i) => groupOf[i] === gi)
      const others = members[gi].filter((i) => !kept.includes(i))
      while (kept.length < THUMBS && others.length) kept.push(others.splice(Math.floor(Math.random() * others.length), 1)[0])
      return [g.name, kept]
    }),
  )
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

  // Re-clustering over a window regroups every second or so: keep the last picks that are still in
  // their group (by name, which a cluster keeps) and top up from its other members.
  const [picked, setPicked] = useState(() => ({ groupOf, rows, picks: pickThumbs(groups, groupOf, new Map()) }))
  let picks = picked.picks
  if (picked.groupOf !== groupOf || picked.rows !== rows) {
    picks = pickThumbs(groups, groupOf, picked.rows === rows ? picked.picks : new Map())
    setPicked({ groupOf, rows, picks })
  }

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
            {picks.get(g.name)?.map((i) => (
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
