import { use, useEffect, useMemo, useRef } from 'react'
import { GradientContext, gradientRGB, rgbCss, type RGB } from '../palette'
import type { Playhead } from '../playhead'
import { sampleGroups, type Group } from '../selection'
import { accentOf, shadeDigit } from '../digitImage'
import { shuffle } from '../rng'
import { SIDE, valenceAt, type Traces } from '../signal'

/** Sample digits shown beside each group. */
const THUMBS = 8

interface ThumbProps {
  pixels: Uint8Array
  poolRow: number
  traces: Traces
  playhead: Playhead
  windowPixels: number
  /** Whether this digit is the one previewed. */
  hovered: boolean
  onClick: () => void
  onHover: (on: boolean) => void
}

/** One digit, small, read as it plays (as the followed digit is); click to follow it. */
function Thumb({ pixels, poolRow, traces, playhead, windowPixels, hovered, onClick, onHover }: ThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gradient = use(GradientContext)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    const accent = accentOf(canvas)
    const draw = () => {
      shadeDigit(img, pixels, poolRow, traces, playhead, windowPixels, accent, gradient)
      ctx.putImageData(img, 0, 0)
    }
    draw()
    return playhead.onFrame(draw)
  }, [pixels, poolRow, traces, playhead, windowPixels, gradient])
  return (
    <canvas
      ref={ref}
      width={SIDE}
      height={SIDE}
      className={hovered ? 'on' : ''}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    />
  )
}

/**
 * Each group, its size, its mean valence right now (a bar from the middle: left disagrees, right
 * agrees) and a few of its digits, picked at random and kept while they stay in the group. Hovering a
 * row previews its first digit, and hovering a digit previews that one; clicking follows it. The
 * previewed digit's row is tinted.
 */
export function GroupLegend({
  groups,
  groupOf,
  colors,
  traces,
  playhead,
  windowPixels,
  pixels,
  rows,
  hover,
  onFocus,
  onHover,
}: {
  groups: Group[]
  groupOf: Int32Array
  colors: RGB[]
  traces: Traces
  playhead: Playhead
  windowPixels: number
  pixels: Uint8Array
  /** Each participant's row in the pool. */
  rows: number[]
  /** The previewed digit, if any. */
  hover: number | null
  onFocus: (participant: number) => void
  onHover: (participant: number | null) => void
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([])
  const gradient = use(GradientContext)

  // Drawn afresh for each sample of digits, and kept as re-clustering regroups them.
  const order = useMemo(() => shuffle(rows.map((_, i) => i), Math.random), [rows])
  const picks = useMemo(() => sampleGroups(groups.length, groupOf, order, THUMBS), [groups.length, groupOf, order])

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
        // Its end of the gradient, outlined, as an end that's black or white may be the page's own colour.
        bar.style.background = rgbCss(gradientRGB(gradient, mean >= 0 ? 1 : -1))
      })
    }
    draw()
    return playhead.onFrame(draw)
  }, [groups, groupOf, traces, playhead, gradient])

  return (
    <ul className="group-legend">
      {groups.map((g, gi) => {
        const sample = picks[gi]?.[0]
        return (
          <li
            key={gi}
            // The previewed digit's group, however it came to be previewed.
            className={hover !== null && groupOf[hover] === gi ? 'on' : ''}
            title={g.labelCounts.map((c, d) => (c ? `${c}×${d}` : '')).filter(Boolean).join(' ')}
            onMouseEnter={() => sample !== undefined && onHover(sample)}
            onMouseLeave={() => onHover(null)}
            onClick={() => sample !== undefined && onFocus(sample)}
          >
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
                  windowPixels={windowPixels}
                  hovered={i === hover}
                  onClick={() => onFocus(i)}
                  // Back to the row's digit on leaving, as the pointer is still over the row.
                  onHover={(on) => onHover(on ? i : (sample ?? null))}
                />
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
