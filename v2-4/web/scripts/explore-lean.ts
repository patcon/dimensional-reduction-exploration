// Explores what leaning the forces does, headless: plays LocalMAP's run to 450, then holds its last-phase forces
// (neighbours 1, far pairs -1, boosted, far pairs redrawn every 10) for HOLD more steps with each lean in CONFIGS,
// from the same layout, and reports how much the map keeps moving once it would otherwise have settled.
//
//   speed        mean distance a point moves per step, over the last WINDOW steps
//   drift        mean distance a point ends up from where it was WINDOW steps before (motion that goes somewhere,
//                rather than jitter in place); both as a share of the layout's spread, x1000
//   persist      drift / (speed x WINDOW): 0 for jitter, 1 for a straight line
//   r(one-way)   correlation, over points, between drift and how many one-way neighbour pairs a point is in
//
//   align        cosine between the points' drift (with the map's own turn and shift taken out) and the push the lean
//                adds (with the data's own who-chose-whom), at the start of the window: 1 if points go where the
//                one-way relationships push them
//   pure         share of each point's 10 nearest on the map that are its digit (1000 points), at the end: the map
//                staying a map
//   rigid        share of drift that is the whole map turning and shifting as one (a least-squares fit)
//   cluster      share of the remaining drift that is digits' centroids moving (whole clusters on the move)
//
// "null" rows flip each one-way neighbour pair's direction at random for the gradient (the redraw still reads them
// the right way round), keeping which points pair, and which pairs are mutual, but not who chose whom: motion the
// data drives should differ there.
//
// FROM=start leans (and scrambles) from the first step of LocalMAP's run, rather than from the end of it.
// SIZE=10k (default), DIM=2 (default) or 3, OPT=adam (default) or momentum, HOLD, WINDOW, THRES, CONFIGS (JSON).
import { readFileSync } from 'node:fs'
import { Engine } from '../src/engine.ts'
import { Adam, Momentum } from '../src/optimisers.ts'
import { DEFAULT_OPTIMISER } from '../src/optimisers.ts'
import { localmapAt, pacmapWeights, scheduleLength } from '../src/schedule.ts'
import type { Dim, Meta, Pairs, Weights } from '../src/types.ts'

const DIM = Number(process.env.DIM ?? 2) as Dim
const SIZE = process.env.SIZE ?? '10k'
const OPT = process.env.OPT ?? 'adam'
const HOLD = Number(process.env.HOLD ?? 400)
const WINDOW = Number(process.env.WINDOW ?? 100)
const dir = new URL(`../public/data/${SIZE}/`, import.meta.url)
const read = (name: string) => {
  const b = readFileSync(new URL(name, dir))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as Meta
const n = meta.nSamples
const THRES = Number(process.env.THRES ?? meta.localmap.lowDistThres)
const every = meta.localmap.resampleEvery
const pairs: Pairs = {
  nb: new Uint32Array(read('pairs_nb.bin')),
  mn: new Uint32Array(read('pairs_mn.bin')),
  fp: new Uint32Array(read('pairs_fp.bin')),
}

type Config = { name: string; lean: Weights; null?: boolean }
const L = (nb: number, fp: number, mn = 0): Weights => ({ nb, mn, fp })
const CONFIGS: Config[] = process.env.CONFIGS
  ? (JSON.parse(process.env.CONFIGS) as Config[])
  : [
      { name: 'none', lean: L(0, 0) },
      { name: 'nb +1', lean: L(1, 0) },
      { name: 'nb +1 null', lean: L(1, 0), null: true },
      { name: 'nb -1', lean: L(-1, 0) },
      { name: 'fp +1', lean: L(0, 1) },
      { name: 'fp -1', lean: L(0, -1) },
      { name: 'both +1', lean: L(1, 1) },
      { name: 'both +1 null', lean: L(1, 1), null: true },
      { name: 'nb +1 fp -1', lean: L(1, -1) },
    ]

// How many one-way neighbour pairs each point is in (either end).
const keyOf = (i: number, j: number) => i * n + j
const nbKeys = new Set<number>()
for (let t = 0; t < pairs.nb.length; t += 2) nbKeys.add(keyOf(pairs.nb[t], pairs.nb[t + 1]))
const oneWay = new Float64Array(n)
for (let t = 0; t < pairs.nb.length; t += 2) {
  const i = pairs.nb[t]
  const j = pairs.nb[t + 1]
  if (!nbKeys.has(keyOf(j, i))) {
    oneWay[i]++
    oneWay[j]++
  }
}
const makeOptimiser = () =>
  OPT === 'momentum' ? new Momentum(n * DIM, { ...DEFAULT_OPTIMISER.momentum }, DIM) : new Adam(n * DIM, meta.adam)
const speedOf = OPT === 'momentum' ? DEFAULT_OPTIMISER.speed.momentum : 1

// LocalMAP's run to the end of its schedule, shared by every config.
const length = scheduleLength(meta.schedule)
const FROM = process.env.FROM ?? 'hold'
function localmapRun(c?: Config) {
  const e = new Engine(pairs, new Float32Array(read(`init_${DIM}d.bin`)), new Adam(n * DIM, meta.adam), DIM)
  if (c) {
    e.setLean(c.lean)
    e.setScrambled(!!c.null)
  }
  for (let it = 0; it < length; it++) {
    const { boost, resampleAfter } = localmapAt(it, meta.schedule, every)
    e.setBoost(boost ? meta.localmap.lowDistThres / 2 : null)
    e.step(pacmapWeights(it, meta.schedule))
    if (resampleAfter) e.resampleFar(meta.localmap.lowDistThres)
  }
  return e
}
const base = localmapRun()
const spreadOf = (Y: Float32Array) => {
  let lo = Infinity
  let hi = -Infinity
  for (const v of Y) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return hi - lo
}
const spread = spreadOf(base.Y)
console.log(`${SIZE} ${DIM}D, ${OPT}, LocalMAP run to ${length}, spread ${spread.toFixed(1)}; hold ${HOLD} at thres ${THRES}`)

const hold: Weights = { nb: 1, mn: 0, fp: -1 }
const corr = (a: Float64Array, b: Float64Array) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let k = 0; k < a.length; k++) {
    sab += (a[k] - ma) * (b[k] - mb)
    saa += (a[k] - ma) ** 2
    sbb += (b[k] - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}
const fmt = (x: number, w = 7, d = 2) => x.toFixed(d).padStart(w)
/** The rigid motion (rotation about the centroid, then translation; 2D only) from A to B, applied to A. */
function rigidFit(A: Float32Array, B: Float32Array) {
  const out = new Float32Array(A.length)
  if (DIM !== 2) return out.fill(NaN)
  let ax = 0, ay = 0, bx = 0, by = 0
  for (let i = 0; i < n; i++) {
    ax += A[2 * i]; ay += A[2 * i + 1]; bx += B[2 * i]; by += B[2 * i + 1]
  }
  ax /= n; ay /= n; bx /= n; by /= n
  let sc = 0, ss = 0
  for (let i = 0; i < n; i++) {
    const px = A[2 * i] - ax, py = A[2 * i + 1] - ay, qx = B[2 * i] - bx, qy = B[2 * i + 1] - by
    sc += px * qx + py * qy
    ss += px * qy - py * qx
  }
  const th = Math.atan2(ss, sc)
  const c = Math.cos(th), s = Math.sin(th)
  for (let i = 0; i < n; i++) {
    const px = A[2 * i] - ax, py = A[2 * i + 1] - ay
    out[2 * i] = c * px - s * py + bx
    out[2 * i + 1] = s * px + c * py + by
  }
  return out
}
const labels = meta.labels
/** Share of each sampled point's 10 nearest on the map that are its own digit. */
function purity(Y: Float32Array) {
  let same = 0
  const sample = 1000
  const d2 = new Float64Array(n)
  for (let q = 0; q < sample; q++) {
    const i = Math.floor((q * n) / sample)
    for (let j = 0; j < n; j++) {
      let s2 = 0
      for (let d = 0; d < DIM; d++) s2 += (Y[i * DIM + d] - Y[j * DIM + d]) ** 2
      d2[j] = j === i ? Infinity : s2
    }
    const idx = Array.from(d2.keys()).sort((a, b) => d2[a] - d2[b]).slice(0, 10)
    for (const j of idx) if (labels[j] === labels[i]) same++
  }
  return same / sample / 10
}
console.log(`LocalMAP's map: pure ${purity(base.Y).toFixed(3)}`)
console.log(`${'config'.padEnd(16)}  speed    drift  persist  r(one-way)  align  rigid  cluster  turn°   pure`)
for (const c of CONFIGS) {
  const from = FROM === 'start' ? localmapRun(c) : base
  const e = new Engine(pairs, new Float32Array(from.Y), makeOptimiser(), DIM)
  e.pairs.fp.set(from.pairs.fp)
  e.fpGlobal = false
  e.setSpeed(speedOf)
  e.setBoost(meta.localmap.lowDistThres / 2)
  e.setLean(c.lean)
  // The Adam the run ended with, so holding doesn't start from a cold optimiser (for Adam only).
  if (OPT === 'adam') Object.assign(e.optimiser, structuredClone(from.optimiser))
  e.setScrambled(!!c.null)
  const prev = new Float32Array(e.Y)
  const start = new Float32Array(e.Y)
  const pathLen = new Float64Array(n)
  const drive = new Float64Array(n * DIM)
  for (let s = 0; s < HOLD; s++) {
    prev.set(e.Y)
    e.step(hold)
    if ((s + 1) % every === 0) e.resampleFar(THRES)
    if (s === HOLD - WINDOW - 1) {
      start.set(e.Y)
      // The push the lean adds: the step's force with it, less the force without it (true orientation).
      e.setLean({ nb: 0, mn: 0, fp: 0 })
      e.gradient(hold)
      drive.set(e.grad)
      e.setLean(c.lean)
      e.gradient(hold)
      for (let k = 0; k < drive.length; k++) drive[k] -= e.grad[k]
    }
    if (s >= HOLD - WINDOW)
      for (let i = 0; i < n; i++) {
        let d2 = 0
        for (let d = 0; d < DIM; d++) d2 += (e.Y[i * DIM + d] - prev[i * DIM + d]) ** 2
        pathLen[i] += Math.sqrt(d2)
      }
  }
  const drift = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let d2 = 0
    for (let d = 0; d < DIM; d++) d2 += (e.Y[i * DIM + d] - start[i * DIM + d]) ** 2
    drift[i] = Math.sqrt(d2)
  }
  const mean = (a: Float64Array) => a.reduce((s, x) => s + x, 0) / a.length
  const speed = mean(pathLen) / WINDOW
  // Drift left once the whole map's turn and shift is taken out, and how much of that is clusters moving.
  const fit = rigidFit(start, e.Y)
  const rest = new Float64Array(n)
  const centroid = (Y: Float32Array) => {
    const c2 = new Float64Array(10 * DIM)
    const count = new Float64Array(10)
    for (let i = 0; i < n; i++) {
      count[labels[i]]++
      for (let d = 0; d < DIM; d++) c2[labels[i] * DIM + d] += Y[i * DIM + d]
    }
    for (let k = 0; k < 10; k++) for (let d = 0; d < DIM; d++) c2[k * DIM + d] /= count[k]
    return c2
  }
  const c0 = centroid(fit)
  const c1 = centroid(e.Y)
  let clusterPart = 0
  for (let i = 0; i < n; i++) {
    let d2 = 0
    let dc = 0
    for (let d = 0; d < DIM; d++) {
      d2 += (e.Y[i * DIM + d] - fit[i * DIM + d]) ** 2
      dc += (c1[labels[i] * DIM + d] - c0[labels[i] * DIM + d]) ** 2
    }
    rest[i] = Math.sqrt(d2)
    clusterPart += Math.sqrt(dc)
  }
  let dot = 0
  let mm = 0
  let uu = 0
  for (let k = 0; k < n * DIM; k++) {
    const m = e.Y[k] - fit[k]
    dot += m * drive[k]
    mm += m * m
    uu += drive[k] * drive[k]
  }
  const align = uu > 0 ? dot / Math.sqrt(mm * uu) : NaN
  let turn = 0
  if (DIM === 2) {
    // The fitted rotation's angle, from one point's offset (any will do for a rigid fit).
    const a0 = Math.atan2(start[1] - start[3], start[0] - start[2])
    const a1 = Math.atan2(fit[1] - fit[3], fit[0] - fit[2])
    turn = (((a1 - a0) * 180) / Math.PI + 540) % 360 - 180
  }
  if (FROM === 'start') console.log(`  ${c.name}: pure ${purity(from.Y).toFixed(3)} at ${length}`)
  console.log(
    `${c.name.padEnd(16)}${fmt((speed / spread) * 1000)}${fmt((mean(drift) / spread) * 1000, 9)}` +
      `${fmt(mean(drift) / mean(pathLen), 9)}${fmt(corr(drift, oneWay), 11)}${fmt(align, 7)}` +
      `${fmt(1 - mean(rest) / mean(drift), 8)}${fmt(clusterPart / n / mean(rest), 8)}${fmt(turn, 7, 1)}${fmt(purity(e.Y), 7, 3)}`,
  )
}
