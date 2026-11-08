/**
 * Who chose whom among the neighbour pairs. Each of PaCMAP's pairs (i, j) is i's: i's neighbours are its nearest
 * in the data (by PaCMAP's scaled distance), so a pair listed one way only, i choosing j but not j choosing i, is a
 * relationship the data makes lopsided. Leaning the forces moves points only along those (see Engine.lean).
 */

/** For each neighbour pair, 1 if it's listed one way only (its reverse isn't a neighbour pair), else 0. */
export function oneWayPairs(nb: Uint32Array, n: number): Uint8Array {
  const listed = new Set<number>()
  for (let t = 0; t < nb.length; t += 2) listed.add(nb[t] * n + nb[t + 1])
  const oneWay = new Uint8Array(nb.length / 2)
  for (let t = 0; t < nb.length; t += 2) oneWay[t / 2] = listed.has(nb[t + 1] * n + nb[t]) ? 0 : 1
  return oneWay
}

/**
 * The neighbour pairs with who chose whom scrambled: each one-way pair turned round, or not, at random (from a fixed
 * seed, so it's the same every time). Which digits pair, and which pairs are mutual, stay as they are; only the
 * data's say in which end chose the other is lost. A lean on these is the null to compare the data's own against.
 * The mid-near and far pairs need no scrambling: each is drawn at random by the point that chose it, so their
 * direction says nothing of the data already.
 */
export function scrambleOneWay(nb: Uint32Array, oneWay: Uint8Array): Uint32Array {
  const out = new Uint32Array(nb)
  let a = 0x9e3779b9
  for (let p = 0; p < oneWay.length; p++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    if (oneWay[p] && a >>> 31) {
      out[2 * p] = nb[2 * p + 1]
      out[2 * p + 1] = nb[2 * p]
    }
  }
  return out
}
