import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMultiplier, toU, type ForceScale } from '../forceScale'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { pacmapWeights, scheduleLength, type Trail } from '../schedule'
import { PAIR_TYPES, type PairType, type Schedule, type Weights } from '../types'

interface Props {
  schedule: Schedule
  /** One scale for all three forces: the sliders' ranges together. */
  scale: ForceScale
  playhead: number
  /** The forces live right now, drawn as dots at the playhead. */
  current: Weights
  /** Mutated in place as the loop plays; the parent re-renders on every step. */
  trail: Trail
}

const HEIGHT = 200
const M = { top: 10, right: 12, bottom: 22, left: 44 }
/** Gridline magnitudes, drawn on both sides of 0 when the scale covers them. */
const GRID = [0.1, 1, 10, 100, 1000]

/** An SVG path through (x, y) points, broken wherever y is NaN. */
function linePath(xs: number[], ys: number[]) {
  let d = ''
  let pen = false
  for (let k = 0; k < xs.length; k++) {
    if (Number.isNaN(ys[k])) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${xs[k].toFixed(1)},${ys[k].toFixed(1)}`
    pen = true
  }
  return d
}

/**
 * PaCMAP's force schedule over one loop, on a signed log scale spanning the sliders' ranges
 * (attraction above the middle, repulsion below), with what you've played this loop over it.
 */
export function ScheduleGraph({ schedule, scale, playhead, current, trail }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(wrapRef.current!)
    return () => observer.disconnect()
  }, [])

  const length = scheduleLength(schedule)
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = HEIGHT - M.top - M.bottom
  const x = (iter: number) => M.left + (iter / length) * plotW
  const y = (u: number) => M.top + ((1 - u) / 2) * plotH

  const xs = useMemo(() => Array.from({ length }, (_, k) => M.left + (k / length) * plotW), [length, plotW])
  /** One path per force through the given multiplier at each iteration. */
  const paths = (at: (type: PairType, k: number) => number) =>
    Object.fromEntries(
      PAIR_TYPES.map((t) => [t, linePath(xs, xs.map((_, k) => (Number.isNaN(at(t, k)) ? NaN : y(toU(at(t, k), scale)))))]),
    ) as Record<PairType, string>
  const referenceWeights = useMemo(() => xs.map((_, k) => pacmapWeights(k, schedule)), [xs, schedule])
  const reference = paths((t, k) => referenceWeights[k][t])
  // The trail grows in place as the loop plays; `version` is what changes when it does.
  const played = paths((t, k) => trail.values[t][k])

  const [p1, p2] = schedule.phases
  const grid = GRID.filter((g) => g >= scale.min && g <= scale.max).flatMap((g) => [g, -g])

  return (
    <div ref={wrapRef} className="schedule">
      <svg width={width} height={HEIGHT} role="img" aria-label="PaCMAP's force schedule, with the forces you've played this loop">
        <rect className="sg-deadzone" x={M.left} width={plotW} y={y(scale.deadzone)} height={y(-scale.deadzone) - y(scale.deadzone)} />
        {grid.map((g) => (
          <g key={g} className="sg-grid">
            <line x1={M.left} x2={M.left + plotW} y1={y(toU(g, scale))} y2={y(toU(g, scale))} />
            <text x={M.left - 6} y={y(toU(g, scale))} dy="0.32em" textAnchor="end">
              {formatMultiplier(g)}
            </text>
          </g>
        ))}
        <g className="sg-axis">
          <line x1={M.left} x2={M.left + plotW} y1={y(0)} y2={y(0)} />
          <text x={M.left - 6} y={y(0)} dy="0.32em" textAnchor="end">
            0
          </text>
          {[p1, p1 + p2].map((it) => (
            <line key={it} className="sg-phase" x1={x(it)} x2={x(it)} y1={M.top} y2={M.top + plotH} />
          ))}
          {[
            [0, p1],
            [p1, p1 + p2],
            [p1 + p2, length],
          ].map(([a, b], k) => (
            <text key={k} x={(x(a) + x(b)) / 2} y={HEIGHT - 6} textAnchor="middle">
              phase {k + 1} · {a}–{b}
            </text>
          ))}
        </g>
        {PAIR_TYPES.map((t) => (
          <path key={`ref-${t}`} className="sg-reference" d={reference[t]} stroke={FORCE_COLORS[t]} />
        ))}
        {PAIR_TYPES.map((t) => (
          <path key={`played-${t}`} className="sg-played" d={played[t]} stroke={FORCE_COLORS[t]} />
        ))}
        <line className="sg-playhead" x1={x(playhead)} x2={x(playhead)} y1={M.top} y2={M.top + plotH} />
        {PAIR_TYPES.map((t) => (
          <circle key={`now-${t}`} cx={x(playhead)} cy={y(toU(current[t], scale))} r={4} fill={FORCE_COLORS[t]}>
            <title>
              {FORCE_LABELS[t]}: {formatMultiplier(current[t])}
            </title>
          </circle>
        ))}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {PAIR_TYPES.map((t) => (
          <li key={t}>
            <span className="swatch" style={{ background: FORCE_COLORS[t] }} /> {FORCE_LABELS[t]}
          </li>
        ))}
        <li className="text-muted-foreground">dashed: PaCMAP · solid: you, this loop</li>
      </ul>
    </div>
  )
}
