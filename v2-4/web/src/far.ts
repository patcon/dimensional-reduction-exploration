import type { Resample } from './engine'

/** Where the far pairs are: PaCMAP's global ones, or redrawn (by the last redraw, at a step: of every digit, or of
 * the `painted` digits under the brush). */
export interface FarState {
  global: boolean
  last: (Resample & { step: number; painted?: number }) | null
}

export const GLOBAL_FAR: FarState = { global: true, last: null }

/** Below this share of far pairs redrawn, the threshold is likely small for the layout's spread. */
export const LOW_SHARE = 0.5

export const share = (r: Resample) => r.resampled / (r.resampled + r.kept)
const percent = (x: number) => `${Math.round(x * 100)}%`

/** The far pairs in a few words, for under the Resample button. */
export function farShort(far: FarState) {
  if (far.global || !far.last) return 'global'
  return `${far.last.painted ? `🖌 ${far.last.painted} · ` : ''}${percent(share(far.last))} · step ${far.last.step}`
}

/** The far pairs in full. */
export function farLong(far: FarState) {
  if (far.global || !far.last) return "PaCMAP's global far pairs, as sampled at the start."
  const r = far.last
  if (r.painted)
    return (
      `Brushed: the far pairs of ${r.painted.toLocaleString()} digits redrawn at step ${r.step}, ${r.resampled.toLocaleString()} ` +
      `of ${(r.resampled + r.kept).toLocaleString()} (${percent(share(r))}), in ${Math.round(r.ms)} ms; every other digit keeps its own.`
    )
  return (
    `Local: ${r.resampled.toLocaleString()} of ${(r.resampled + r.kept).toLocaleString()} far pairs (${percent(share(r))}) ` +
    `redrawn at step ${r.step}, in ${Math.round(r.ms)} ms; the rest kept their partners, as none was found near enough.`
  )
}
