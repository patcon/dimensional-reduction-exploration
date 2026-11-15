import { createContext } from 'react'
import { DEFAULT_GRADIENT, participantColor, type Gradient } from './protocol.ts'

export type RGB = [number, number, number]

export function hexRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * Detected groups' colours, by slot (blue, yellow, magenta, violet, green, as "Phone-flip crowd" had them on dark), and
 * the grey of "other", for groups past them. Patterns take the first four, so a group that is a pattern can match it.
 */
export const SLOT_COLORS: RGB[] = ['#3987e5', '#c98500', '#d55181', '#9085e9', '#0ca30c'].map(hexRgb)
export const OTHER_COLOR: RGB = [110, 110, 105]
export const slotColor = (slot: number) => SLOT_COLORS[slot] ?? OTHER_COLOR
export const patternColor = (pattern: number) => SLOT_COLORS[pattern] ?? OTHER_COLOR

/** A live phone's colour, by its room slot, as its remote's border shows it. */
export const participantRGB = (slot: number) => hexRgb(participantColor(slot))

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
