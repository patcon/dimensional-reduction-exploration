// Checks the engine's LocalMAP far-pair redraw (resampleFar), which no replay can follow exactly
// (numba draws its random numbers per thread), three ways. SIZE=10k (default), 20k or 65k; DIM=3 for 3D.
//
// 1. Rules: on LocalMAP's own layouts (reference_localmap_<DIM>d.bin, from pipeline/v2-4.py) at
//    iterations 210, 300 and 450, every redrawn pair is within the threshold, never a point and itself
//    or a neighbour pair, and a point's far pairs never repeat (a pair that's kept keeps its old partner,
//    so may be beyond the threshold).
// 2. Against PaCMAP's own sampler: the engine draws from grid cells around each point rather than from
//    every point (see resampleFar), so it's compared with a line-for-line port of pacmap's
//    sample_FP_nearby on the same layouts: how many pairs each keeps, how far apart and how often the
//    same digit each redrawn pair is. Both pick uniformly from the same points, so these should agree.
// 3. A whole run: the engine plays LocalMAP's schedule (boost from 201, a redraw every 10 iterations
//    from 210) to 450, and its final layout is compared with LocalMAP's and PaCMAP's by how many of each
//    point's 10 nearest neighbours they share, and by how many of its 10 nearest are the same digit.
//    It should land nearer LocalMAP's than PaCMAP's does, and as pure.
import { readFileSync } from 'node:fs'
import { Engine } from '../src/engine.ts'
import { Adam } from '../src/optimisers.ts'
import { localmapAt, pacmapWeights, scheduleLength } from '../src/schedule.ts'
import type { Dim, Meta, Pairs } from '../src/types.ts'

const DIM = Number(process.env.DIM ?? 2) as Dim
const SIZE = process.env.SIZE ?? '10k'
const K = 10

const dir = new URL(`../public/data/${SIZE}/`, import.meta.url)
const referenceDir = new URL(`../../../pipeline/data/v2-4/${SIZE}/`, import.meta.url)
const read = (name: string, from = dir) => {
  const b = readFileSync(new URL(name, from))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as Meta
const n = meta.nSamples
const labels = meta.labels
const pairs: Pairs = {
  nb: new Uint32Array(read('pairs_nb.bin')),
  mn: new Uint32Array(read('pairs_mn.bin')),
  fp: new Uint32Array(read('pairs_fp.bin')),
}
const thres = meta.localmap.lowDistThres
const nbPer = pairs.nb.length / 2 / n
const fpPer = pairs.fp.length / 2 / n
const snapshotsOf = (name: string) => new Float32Array(read(name, referenceDir))
const localRef = snapshotsOf(`reference_localmap_${DIM}d.bin`)
const pacmapRef = snapshotsOf(`reference_${DIM}d.bin`)
const at = (ref: Float32Array, it: number) => {
  const k = meta.reference.iterations.indexOf(it)
  return ref.subarray(k * n * DIM, (k + 1) * n * DIM)
}
const newEngine = () => new Engine(pairs, new Float32Array(read(`init_${DIM}d.bin`)), new Adam(n * DIM, meta.adam), DIM)
const dist2 = (Y: Float32Array, i: number, j: number) => {
  let s = 0
  for (let d = 0; d < DIM; d++) s += (Y[i * DIM + d] - Y[j * DIM + d]) ** 2
  return s
}
let failures = 0
const expect = (ok: boolean, what: string) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/** pacmap.sample_FP_pair_nearby, line for line (draws from every point; too-far draws don't count as tries). */
function pacmapResample(Y: Float32Array, fp: Uint32Array, random: () => number) {
  const out = new Uint32Array(fp)
  const result = new Int32Array(fpPer)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < fpPer; k++) {
      let j = 0
      let count = 0
      let reject = true
      while (reject) {
        j = Math.floor(random() * n)
        count++
        if (j === i) continue
        let bad = false
        for (let q = 0; q < k && !bad; q++) if (result[q] === j) bad = true
        for (let q = 0; q < nbPer && !bad; q++) if (pairs.nb[(i * nbPer + q) * 2 + 1] === j) bad = true
        if (!bad) {
          if (dist2(Y, i, j) > thres * thres) continue
          reject = false
        }
        if (count > 100) {
          j = -1
          reject = false
        }
      }
      result[k] = j
      if (j !== -1) out[(i * fpPer + k) * 2 + 1] = j
    }
  }
  return out
}

/** How many pairs moved, and, of those, the mean distance apart and the fraction that are the same digit. */
function stats(Y: Float32Array, before: Uint32Array, after: Uint32Array) {
  let moved = 0
  let distance = 0
  let same = 0
  for (let t = 0; t < after.length; t += 2) {
    const i = after[t]
    const j = after[t + 1]
    if (j === before[t + 1]) continue
    moved++
    distance += Math.sqrt(dist2(Y, i, j))
    if (labels[i] === labels[j]) same++
  }
  return { moved, distance: distance / moved, same: same / moved }
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

console.log(`${SIZE} ${DIM}D, threshold ${thres}`)
for (const it of [210, 300, 450]) {
  const Y = at(localRef, it)
  const engine = newEngine()
  engine.Y.set(Y)
  const before = new Uint32Array(engine.pairs.fp)
  const r = engine.resampleFar(thres)
  const fp = engine.pairs.fp
  console.log(`iteration ${it}: engine redrew ${r.resampled}, kept ${r.kept} in ${r.ms.toFixed(0)} ms`)

  let far = 0, self = 0, neighbour = 0, repeat = 0, wrongStart = 0
  const nbSet = new Set<number>()
  for (let i = 0; i < n; i++) {
    nbSet.clear()
    for (let q = 0; q < nbPer; q++) nbSet.add(pairs.nb[(i * nbPer + q) * 2 + 1])
    const seen = new Set<number>()
    for (let k = 0; k < fpPer; k++) {
      const t = (i * fpPer + k) * 2
      const j = fp[t + 1]
      if (fp[t] !== i) wrongStart++
      if (j !== before[t + 1] && dist2(Y, i, j) > thres * thres) far++
      if (j === i) self++
      if (nbSet.has(j)) neighbour++
      if (seen.has(j)) repeat++
      seen.add(j)
    }
  }
  expect(far === 0 && self === 0 && neighbour === 0 && repeat === 0 && wrongStart === 0,
    `rules: ${far} beyond the threshold, ${self} to itself, ${neighbour} to a neighbour, ${repeat} repeated`)

  const start = performance.now()
  const theirs = pacmapResample(Y, before, mulberry32(1))
  const ms = performance.now() - start
  const a = stats(Y, before, fp)
  const b = stats(Y, before, theirs)
  console.log(`  engine: ${a.moved} moved, ${a.distance.toFixed(3)} apart, ${(a.same * 100).toFixed(1)}% same digit`)
  console.log(`  PaCMAP: ${b.moved} moved, ${b.distance.toFixed(3)} apart, ${(b.same * 100).toFixed(1)}% same digit (${ms.toFixed(0)} ms)`)
  expect(Math.abs(a.moved - b.moved) <= 0.002 * before.length / 2, 'as many redrawn as PaCMAP (within 0.2% of pairs)')
  expect(Math.abs(a.distance - b.distance) <= 0.01 * b.distance, 'as far apart (within 1%)')
  expect(Math.abs(a.same - b.same) <= 0.005, 'as often the same digit (within 0.5 points)')
}

/** Each point's K nearest others in a layout (brute force). */
function knn(Y: Float32Array) {
  const out = new Uint32Array(n * K)
  const best = new Float64Array(K)
  const bestJ = new Uint32Array(K)
  for (let i = 0; i < n; i++) {
    best.fill(Infinity)
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const d = dist2(Y, i, j)
      if (d >= best[K - 1]) continue
      let q = K - 1
      while (q > 0 && best[q - 1] > d) {
        best[q] = best[q - 1]
        bestJ[q] = bestJ[q - 1]
        q--
      }
      best[q] = d
      bestJ[q] = j
    }
    out.set(bestJ, i * K)
  }
  return out
}
const overlap = (a: Uint32Array, b: Uint32Array) => {
  let shared = 0
  for (let i = 0; i < n; i++) {
    const s = new Set(a.subarray(i * K, (i + 1) * K))
    for (const j of b.subarray(i * K, (i + 1) * K)) if (s.has(j)) shared++
  }
  return shared / (n * K)
}
const purity = (nn: Uint32Array) => {
  let same = 0
  for (let i = 0; i < n; i++) for (const j of nn.subarray(i * K, (i + 1) * K)) if (labels[j] === labels[i]) same++
  return same / (n * K)
}

console.log(`a whole LocalMAP run to ${scheduleLength(meta.schedule)}`)
const engine = newEngine()
let resampleMs = 0
for (let itr = 0; itr < scheduleLength(meta.schedule); itr++) {
  const local = localmapAt(itr, meta.schedule, meta.localmap.resampleEvery)
  engine.boost = local.boost ? thres / 2 : null
  engine.step(pacmapWeights(itr, meta.schedule))
  if (local.resampleAfter) resampleMs += engine.resampleFar(thres).ms
}
const last = scheduleLength(meta.schedule)
const ours = knn(engine.Y)
const theirLocal = knn(at(localRef, last))
const theirPacmap = knn(at(pacmapRef, last))
const nearLocal = overlap(ours, theirLocal)
const pacmapNearLocal = overlap(theirPacmap, theirLocal)
console.log(`  redraws took ${resampleMs.toFixed(0)} ms in all`)
console.log(`  ${K}-NN shared with LocalMAP's: engine ${(nearLocal * 100).toFixed(1)}%, PaCMAP's ${(pacmapNearLocal * 100).toFixed(1)}%`)
console.log(`  ${K}-NN same digit: engine ${(purity(ours) * 100).toFixed(1)}%, LocalMAP ${(purity(theirLocal) * 100).toFixed(1)}%, PaCMAP ${(purity(theirPacmap) * 100).toFixed(1)}%`)
expect(nearLocal >= pacmapNearLocal, "nearer LocalMAP's layout than PaCMAP's is")
expect(Math.abs(purity(ours) - purity(theirLocal)) <= 0.01, "as pure as LocalMAP's (within 1 point)")

console.log(failures ? `MISMATCH: ${failures} failed` : 'OK')
process.exit(failures ? 1 : 0)
