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
/** Chord tips, each on its own diameter, one way along it or the other from the centre: rays of uneven length. */
const DIAMETRIC = [[2.68, 10.15], [16.99, 15.33], [7.56, 5.35], [13.76, 20.83], [13.07, 6.61], [7.83, 18.24], [19.48, 7], [7.1, 12.98]]
/** The radial chords' tips, joined round: a ring bulging in and out with the valences. */
const RADIAL = Array.from({ length: 96 }, (_, i) => {
  const a = (i / 96) * 2 * Math.PI
  const r = 7.5 + 1.1 * Math.sin(8 * a + 0.4) + 0.4 * Math.sin(3 * a)
  return `${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`
})
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
      {DIAMETRIC.map(([x, y]) => <path key={`${x},${y}`} d={`M12 12L${x} ${y}`} />)}
    </Icon>
  )
}

export function RadialIcon(props: React.ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={7.5} strokeWidth={1.5} opacity={0.55} />
      <path d={`M${RADIAL.join('L')}Z`} />
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
