/** A group's rhythm: where its phones were seen flipping, step by step, over two bars. Apart from the audio, so it's checked without a browser. */

import { FS, SLOT, WIN } from './crowd.ts'

/** A step is played when its group's flip energy there is at least this. */
export const RHYTHM_ON = 0.45
/** A group's rhythm is this many steps long: two bars, so a pattern counted over two (1-2-345-, say) is kept whole. */
export const RHYTHM_STEPS = 8
/** A rhythm with no step played: a group held still (Hold, say), with no beat to follow. */
export const isHeld = (rhythm: readonly number[]) => rhythm.every((e) => e < RHYTHM_ON)

/**
 * Flip energy at each step over the window, folded onto two bars (steps counted from the song's start, so a two-bar
 * pattern's first bar stays first). A pattern a bar long comes out twice over, as it would folded onto one.
 */
export function rhythmOf(members: number[], t: number, sample: (i: number, n: number) => number) {
  const prof = new Array<number>(RHYTHM_STEPS).fill(0), cnt = new Array<number>(RHYTHM_STEPS).fill(0)
  const s0 = Math.ceil((t - WIN) / SLOT), s1 = Math.floor((t - 0.5) / SLOT)
  for (let s = s0; s <= s1; s++) {
    const n0 = Math.round((s * SLOT - 0.02) * FS), n1 = Math.round((s * SLOT + 0.45) * FS)
    let e = 0
    for (const i of members) e += Math.min(1, Math.abs(sample(i, n1) - sample(i, n0)) / 2)
    prof[s % RHYTHM_STEPS] += e / members.length
    cnt[s % RHYTHM_STEPS]++
  }
  return prof.map((v, k) => (cnt[k] ? v / cnt[k] : 0))
}
