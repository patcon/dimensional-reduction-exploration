import type { Grouping } from './selection.ts'

// One hue per digit, as in v1 and v2.
export const DIGIT_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#7f7f7f',
]

export type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Mixes towards white (amount > 0) or black (amount < 0). */
function tint([r, g, b]: RGB, amount: number): RGB {
  const to = amount > 0 ? 255 : 0
  const a = Math.abs(amount)
  return [r + (to - r) * a, g + (to - g) * a, b + (to - b) * a].map(Math.round) as RGB
}

// Past the tenth cluster, the same hues again: lighter, darker, lighter still…
const VARIANTS = [0, 0.45, -0.4, 0.7, -0.6, 0.25, -0.2]

/** A cluster's colour, from its id alone, so a cluster that keeps its id keeps its colour. */
export function clusterColor(id: number): RGB {
  return tint(hexToRgb(DIGIT_COLORS[id % DIGIT_COLORS.length]), VARIANTS[Math.floor(id / DIGIT_COLORS.length) % VARIANTS.length])
}

/** A colour per group: a digit's own hue, or a cluster's by its id. */
export function groupColors(grouping: Grouping): RGB[] {
  return grouping.groups.map((g) => (g.id === undefined ? hexToRgb(DIGIT_COLORS[g.majorityLabel]) : clusterColor(g.id)))
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`
