import type * as React from 'react'
import type { ViewMode } from '../vizSettings'

// One object from three sides, on Lucide's 24×24 grid with its 2px round strokes: chords radiating from a
// centre, a dot for each one's cursor (now), a faint line for its trail (the past). As in the visualiser, the
// now plane faces right and trails run left.

function Icon({ children, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  )
}

const Faint = (props: React.ComponentProps<'path'>) => <path strokeWidth={1.5} opacity={0.55} {...props} />
const Dot = ({ x, y, r = 1.7 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />

/** Cursor tips, front-on: uneven lengths, so the spokes read as valences, not sun rays. */
const SLICE_TIPS = [[13.56, 3.14], [17.17, 10.12], [18.13, 17.14], [11.22, 16.43], [4.95, 14.57], [7.4, 8.14]]
/** The same, turned to face right, and where each trail ends on its way to a vanishing point on the left. */
const TURNED = [[16.64, 3.31, 6.94, 8.7], [18.13, 10.16, 7.51, 11.3], [18.52, 17.04, 7.66, 13.92], [15.68, 16.34, 6.58, 13.65], [13.1, 14.51, 5.6, 12.95], [14.11, 8.22, 5.98, 10.56]]
/** Cursor heights side-on, where the spokes collapse onto the ring's edge. */
const SIDE_HEIGHTS = [4.5, 9, 14, 18.5]

export function TimeSliceIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      {SLICE_TIPS.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <path d={`M12 12L${x} ${y}`} />
          <Dot x={x} y={y} />
        </g>
      ))}
    </Icon>
  )
}

export function TimeSeriesIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <Faint d="M19 2L19 22" />
      {SIDE_HEIGHTS.map((y) => (
        <g key={y}>
          <Faint d={`M19 ${y}L4 ${y}`} />
          <Dot x={19} y={y} />
        </g>
      ))}
    </Icon>
  )
}

export function PerspectiveIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      {TURNED.map(([x, y, tx, ty]) => (
        <Faint key={`${x},${y}`} d={`M${x} ${y}L${tx} ${ty}`} />
      ))}
      {TURNED.map(([x, y]) => (
        <g key={`${x},${y}`}>
          <path d={`M16 12L${x} ${y}`} />
          <Dot x={x} y={y} r={1.5} />
        </g>
      ))}
    </Icon>
  )
}

/** The icon for a view. */
export function ViewIcon({ view, ...props }: React.ComponentProps<'svg'> & { view: ViewMode }) {
  if (view === '2d') return <TimeSliceIcon {...props} />
  if (view === '2d-ts') return <TimeSeriesIcon {...props} />
  return <PerspectiveIcon {...props} />
}
