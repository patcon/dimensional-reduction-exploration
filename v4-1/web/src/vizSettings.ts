/** The visualiser's modes, shared by its controls and ChordViz. */

import { MAX_PARTICIPANTS } from './protocol.ts'

export type ViewMode = '2d' | '2d-ts' | '3d'
export type GeoMode = 'parallel' | 'linear' | 'diametric' | 'radial' | 'particle'
export type Element = 'cursor' | 'chord' | 'trace' | 'fill'
export type ColorBy = 'valence' | 'group'
export interface VizStyle {
  colorBy: Record<Element, ColorBy>
  opacity: Record<Element, number>
  /** Cursor dot size, in the authoring space's units. */
  cursorSize: number
  /** Chord width, in pixels. */
  chordWidth: number
  /** Trace width, in world units (the authoring space's, where the ring's radius is 180). */
  traceWidth: number
  /** Ring the followed digit's cursor. */
  focusRing: boolean
}

export const VIEW_LABELS: Record<ViewMode, string> = { '2d': '2d time slice', '2d-ts': '2d time series', '3d': '3d' }
export const GEO_MODES: GeoMode[] = ['parallel', 'linear', 'diametric', 'radial', 'particle']
export const ELEMENTS: Element[] = ['cursor', 'chord', 'trace', 'fill']
export const DEFAULT_STYLE: VizStyle = {
  colorBy: { cursor: 'valence', chord: 'valence', trace: 'valence', fill: 'valence' },
  opacity: { cursor: 1, chord: 1, trace: 0.8, fill: 0.45 },
  cursorSize: 12,
  chordWidth: 8,
  traceWidth: 8,
  focusRing: true,
}

/**
 * What sets the force between two particles: whether they're in the same group, or how much each counts the other
 * among its nearest neighbours (which needn't be mutual, so neither need the forces be).
 */
export type ForceSource = 'groups' | 'neighbours'

/** Forces in the particle geometry. Positive pulls together, negative pushes apart. */
export interface ParticleSettings {
  forces: ForceSource
  /** Between particles of the same group; with neighbour forces, on a particle towards one it counts fully as a neighbour. */
  cohesion: number
  /** Between particles of different groups; with neighbour forces, on a particle towards one it doesn't count. */
  separation: number
  /** With neighbour forces, each particle goes by its own neighbours, rather than UMAP's symmetrised weights. */
  oneWay: boolean
  /** The speaker's pull on a particle, from the centre, scaled by its valence now; with no speaker, nothing pulls. */
  centreForce: number
  /** Agreement pushes away from the centre and disagreement pulls in, rather than the other way round. */
  reverseCentre: boolean
  /** Scales the centre's reach and the boundary past it: below 1 crowds particles in, above 1 lets them spread out. */
  spread: number
  /** How far particles feel each other, in the authoring space's units. */
  radius: number
  /** Velocity kept from one frame to the next. */
  damping: number
}

export const DEFAULT_PARTICLES: ParticleSettings = {
  forces: 'groups',
  cohesion: 0.6,
  separation: -0.3,
  oneWay: true,
  centreForce: 3.4,
  reverseCentre: false,
  spread: 1,
  radius: 92,
  damping: 0.94,
}

/** At most this many digits take part (one chord each). */
export const MAX_CHORDS = 200
/** Chords and cursors drawn at most: every digit, and every participant beside them. */
export const MAX_CURSORS = MAX_CHORDS + MAX_PARTICIPANTS
