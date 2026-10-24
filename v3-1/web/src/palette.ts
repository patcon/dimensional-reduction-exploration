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

// The 2nd, 3rd… cluster of one digit: lighter, darker, lighter still…
const VARIANTS = [0, 0.45, -0.4, 0.7, -0.6, 0.25, -0.2]

/** A colour per group: its digit's hue, so clusters stay linked to digits, told apart by lightness. */
export function groupColors(grouping: Grouping): RGB[] {
  const seen = new Array<number>(DIGIT_COLORS.length).fill(0)
  return grouping.groups.map((g) => tint(hexToRgb(DIGIT_COLORS[g.majorityLabel]), VARIANTS[seen[g.majorityLabel]++ % VARIANTS.length]))
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`
