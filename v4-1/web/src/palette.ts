import { createContext } from 'react'
import { DEFAULT_GRADIENT, type Gradient } from './protocol.ts'
import type { Grouping } from './selection.ts'

// One hue per digit, as in v1 and v2.
export const DIGIT_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#7f7f7f',
]

export type RGB = [number, number, number]

export function hexRgb(hex: string): RGB {
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
  return tint(hexRgb(DIGIT_COLORS[id % DIGIT_COLORS.length]), VARIANTS[Math.floor(id / DIGIT_COLORS.length) % VARIANTS.length])
}

/** Participants, grouped by label: they have no digit, so they're a group of their own. */
const LIVE_GROUP_COLOR: RGB = [235, 235, 235]

/** HDBSCAN's noise: the digits in no cluster. */
const NOISE_GROUP_COLOR: RGB = [110, 110, 110]

/** A colour per group: a digit's own hue (or the participants' grey), a cluster's by its id, or noise's grey. */
export function groupColors(grouping: Grouping): RGB[] {
  return grouping.groups.map((g) => (g.noise ? NOISE_GROUP_COLOR : g.id !== undefined ? clusterColor(g.id) : g.majorityLabel < 0 ? LIVE_GROUP_COLOR : hexRgb(DIGIT_COLORS[g.majorityLabel])))
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`

/** Each gradient's colours, from −1 to +1, evenly spaced. */
const GRADIENT_STOPS: Record<Gradient, RGB[]> = {
  'black-white': [[0, 0, 0], [255, 255, 255]],
  'white-black': [[255, 255, 255], [0, 0, 0]],
  'red-black-green': [[255, 80, 60], [0, 0, 0], [80, 255, 140]],
  'red-white-green': [[255, 80, 60], [255, 255, 255], [80, 255, 140]],
}

export const GRADIENT_LABELS: Record<Gradient, string> = {
  'black-white': 'black/white',
  'white-black': 'white/black',
  'red-black-green': 'red/black/green',
  'red-white-green': 'red/white/green',
}

/** Valence v (−1–1) along the gradient, 0–255, into `out` from `at` (to fill typed arrays without allocating). */
export function gradientRGB<T extends number[] | Uint8ClampedArray = number[]>(gradient: Gradient, v: number, out: T = [0, 0, 0] as T, at = 0): T {
  const stops = GRADIENT_STOPS[gradient]
  const x = ((Math.max(-1, Math.min(1, v)) + 1) / 2) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  for (let c = 0; c < 3; c++) out[at + c] = stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f
  return out
}

/** The gradient as CSS, left (−1) to right (+1). */
export const gradientCss = (gradient: Gradient) => `linear-gradient(to right, ${GRADIENT_STOPS[gradient].map(rgbCss).join(', ')})`

/** The room's gradient, for whatever draws valence. */
export const GradientContext = createContext<Gradient>(DEFAULT_GRADIENT)
