import type * as React from 'react'
import type { GeoMode } from '../vizSettings'

// Each geometry as the time slice shows it, drawn as the view icons are (Lucide's 24×24 grid, 2px round strokes):
// solid chords, faint lines for what they're laid out along.

function Icon({ children, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  )
}

const Faint = (props: React.ComponentProps<'path'>) => <path strokeWidth={1.5} opacity={0.55} {...props} />
const Dot = ({ x, y, r = 1.7 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />

/** Chord roots along the baseline and tip heights: valence up or down from it. */
const PARALLEL = [[4, 5], [8, 16.5], [12, 7.5], [16, 20], [20, 9.5]]
/** The highest and lowest tips on the one line all chords share. */
const LINEAR = [3.5, 20.5]
/** Each diameter's ends, and its chord's tip: valence one way along it or the other from the centre. */
const DIAMETRIC = [[20.66, 17, 3.34, 7, 4.21, 7.5], [12, 22, 12, 2, 12, 21.5], [3.34, 17, 20.66, 7, 17.2, 9]]
/** Roots on the ring and tips: positive valence in towards the centre, negative out. */
const RADIAL = [[13.68, 5.72, 12.67, 9.49], [18.28, 10.32, 21.42, 9.48], [16.6, 16.6, 17.52, 17.52], [10.32, 18.28, 11.16, 15.14], [5.72, 13.68, 2.58, 14.52], [7.4, 7.4, 8.78, 8.78]]
/** Particles, in three groups. */
const PARTICLES = [[5, 6], [9.5, 5], [6.5, 10], [15, 4], [19, 6.5], [16, 9.5], [8.5, 18], [12.5, 15.5], [15, 19.5], [11, 21]]

export function ParallelIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <Faint d="M2 12L22 12" />
      {PARALLEL.map(([x, y]) => <path key={x} d={`M${x} 12L${x} ${y}`} />)}
    </Icon>
  )
}

export function LinearIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <Faint d="M6 12L18 12" />
      <path d={`M12 ${LINEAR[0]}L12 ${LINEAR[1]}`} />
    </Icon>
  )
}

export function DiametricIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      {DIAMETRIC.map(([x1, y1, x2, y2, x, y]) => (
        <g key={`${x1},${y1}`}>
          <Faint d={`M${x1} ${y1}L${x2} ${y2}`} />
          <path d={`M12 12L${x} ${y}`} />
        </g>
      ))}
    </Icon>
  )
}

export function RadialIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={6.5} strokeWidth={1.5} opacity={0.55} />
      {RADIAL.map(([rx, ry, x, y]) => <path key={`${rx},${ry}`} d={`M${rx} ${ry}L${x} ${y}`} />)}
    </Icon>
  )
}

export function ParticleIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      {PARTICLES.map(([x, y]) => <Dot key={`${x},${y}`} x={x} y={y} />)}
    </Icon>
  )
}

/** The icon for a geometry. */
export function GeometryIcon({ geometry, ...props }: React.ComponentProps<'svg'> & { geometry: GeoMode }) {
  if (geometry === 'parallel') return <ParallelIcon {...props} />
  if (geometry === 'linear') return <LinearIcon {...props} />
  if (geometry === 'diametric') return <DiametricIcon {...props} />
  if (geometry === 'radial') return <RadialIcon {...props} />
  return <ParticleIcon {...props} />
}
