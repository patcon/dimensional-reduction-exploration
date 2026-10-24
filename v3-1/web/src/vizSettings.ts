/** The visualiser's modes, shared by its controls and ChordViz. */

export type ViewMode = '2d' | '2d-ts' | '3d'
export type GeoMode = 'parallel' | 'linear' | 'diametric' | 'radial'
export type Element = 'cursor' | 'chord' | 'trace' | 'fill'
export type ColorBy = 'valence' | 'group'
export interface VizStyle {
  colorBy: Record<Element, ColorBy>
  opacity: Record<Element, number>
  /** Cursor dot size, in the authoring space's units. */
  cursorSize: number
  /** Trace width, in world units (the authoring space's, where the ring's radius is 180). */
  traceWidth: number
}

export const VIEW_LABELS: Record<ViewMode, string> = { '2d': '2d time slice', '2d-ts': '2d time series', '3d': '3d' }
export const GEO_MODES: GeoMode[] = ['parallel', 'linear', 'diametric', 'radial']
export const ELEMENTS: Element[] = ['cursor', 'chord', 'trace', 'fill']
export const DEFAULT_STYLE: VizStyle = {
  colorBy: { cursor: 'valence', chord: 'valence', trace: 'valence', fill: 'valence' },
  opacity: { cursor: 1, chord: 1, trace: 0.8, fill: 0.45 },
  cursorSize: 9,
  traceWidth: 1.5,
}

/** At most this many digits take part (one chord each). */
export const MAX_CHORDS = 200
