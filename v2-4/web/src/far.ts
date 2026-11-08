import type { Resample } from './engine'

/** Where the far pairs are: PaCMAP's global ones, or redrawn (by the last redraw, at a step: of every digit, or of
 * the `painted` digits under the brush). */
export interface FarState {
  global: boolean
  last: (Resample & { step: number; painted?: number; added?: boolean }) | null
  /** Far pairs the brush has added on top of the sampled ones, in all. */
  extra?: number
}

export const GLOBAL_FAR: FarState = { global: true, last: null }

/** Below this share of far pairs redrawn, the threshold is likely small for the layout's spread. */
export const LOW_SHARE = 0.5

export const share = (r: Resample) => r.resampled / (r.resampled + r.kept)
const percent = (x: number) => `${Math.round(x * 100)}%`

/** The far pairs in a few words, for under the Resample button. */
export function farShort(far: FarState) {
  if (far.global || !far.last) return 'global'
  const plus = far.extra ? ` · +${far.extra.toLocaleString()}` : ''
  if (far.last.added) return `🖌+ ${far.last.painted} · step ${far.last.step}${plus}`
  return `${far.last.painted ? `🖌 ${far.last.painted} · ` : ''}${percent(share(far.last))} · step ${far.last.step}${plus}`
}

/** The far pairs in full. */
export function farLong(far: FarState) {
  if (far.global || !far.last) return "PaCMAP's global far pairs, as sampled at the start."
  const r = far.last
  const extra = far.extra ? ` ${far.extra.toLocaleString()} far pairs added by the brush in all, on top of the sampled ones.` : ''
  if (r.added)
    return (
      `Brushed, adding: ${r.resampled.toLocaleString()} far pairs added to ${r.painted?.toLocaleString()} digits at step ${r.step}` +
      `${r.kept ? ` (${r.kept.toLocaleString()} found none near enough)` : ''}, in ${Math.round(r.ms)} ms.${extra}`
    )
  if (r.painted)
    return (
      `Brushed: the far pairs of ${r.painted.toLocaleString()} digits redrawn at step ${r.step}, ${r.resampled.toLocaleString()} ` +
      `of ${(r.resampled + r.kept).toLocaleString()} (${percent(share(r))}), in ${Math.round(r.ms)} ms; every other digit keeps its own.${extra}`
    )
  return (
    `Local: ${r.resampled.toLocaleString()} of ${(r.resampled + r.kept).toLocaleString()} far pairs (${percent(share(r))}) ` +
    `redrawn at step ${r.step}, in ${Math.round(r.ms)} ms; the rest kept their partners, as none was found near enough.`
  )
}
