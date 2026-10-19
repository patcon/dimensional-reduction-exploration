// Step the browser engine from init_<DIM>d.bin under PaCMAP's schedule and compare against
// reference_<DIM>d.bin, PaCMAP's own run (both written by pipeline/v2-0.py; the reference
// goes to pipeline/data/v2-0/, kept out of the site). DIM=3 checks 3D.
//
// Judged like `v2-0.py --check`: on a high percentile of per-point error, not the max.
// Float summation order differs from numba's, and Adam's m/sqrt(v) amplifies that for
// the few points whose gradient is near zero, so a handful drift ~1e-2 while the rest
// agree to ~1e-5.
//
// After phase 1 the bar is looser. When mid-near's weight finishes falling, the clusters
// rearrange, and that magnifies rounding differences into a slightly rotated/scaled but
// otherwise identical layout. pipeline/v2-0.py's independent numpy replay drifts from
// PaCMAP by the same amount (~1e-2 by iteration 450), so it's not an engine bug.
import { readFileSync } from 'node:fs'
import { Engine } from '../src/engine.ts'
import { Adam } from '../src/optimisers.ts'
import { pacmapWeights } from '../src/schedule.ts'
import type { Dim, Meta, Pairs } from '../src/types.ts'

const ITERS = Number(process.env.ITERS ?? 100) // ITERS=450 checks the whole schedule (slower)
const DIM = Number(process.env.DIM ?? 2) as Dim
const PERCENTILE = 99
// As a fraction of the layout spread: strict through phase 1, loose after (see above).
const TOLERANCE = 1e-4
const TOLERANCE_AFTER_PHASE_1 = 1e-2

const dir = new URL('../public/data/', import.meta.url)
const referenceDir = new URL('../../../pipeline/data/v2-0/', import.meta.url)
const read = (name: string, from = dir) => {
  const b = readFileSync(new URL(name, from))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as Meta
const n = meta.nSamples
const pairs: Pairs = {
  nb: new Uint32Array(read('pairs_nb.bin')),
  mn: new Uint32Array(read('pairs_mn.bin')),
  fp: new Uint32Array(read('pairs_fp.bin')),
}
const reference = new Float32Array(read(`reference_${DIM}d.bin`, referenceDir))
const snapshot = (k: number) => reference.subarray(k * n * DIM, (k + 1) * n * DIM)

let spread = 0
for (const x of reference) spread = Math.max(spread, Math.abs(x))

const engine = new Engine(pairs, new Float32Array(read(`init_${DIM}d.bin`)), new Adam(n * DIM, meta.adam), DIM)
const targets = new Map(meta.reference.iterations.map((it, k) => [it, k]))

const phase1 = meta.schedule.phases[0]
let worst = 0
let worstAfter = 0
let elapsed = 0
for (let itr = 0; itr < ITERS; itr++) {
  const start = performance.now()
  engine.step(pacmapWeights(itr, meta.schedule))
  elapsed += performance.now() - start

  const k = targets.get(itr + 1)
  if (k === undefined) continue
  const ref = snapshot(k)
  const err = new Float64Array(n)
  for (let i = 0; i < n; i++)
    for (let d = i * DIM; d < (i + 1) * DIM; d++) err[i] = Math.max(err[i], Math.abs(engine.Y[d] - ref[d]))
  err.sort()
  const p = err[Math.min(n - 1, Math.floor((PERCENTILE / 100) * n))]
  if (itr + 1 <= phase1) worst = Math.max(worst, p / spread)
  else worstAfter = Math.max(worstAfter, p / spread)
  console.log(`iteration ${String(itr + 1).padStart(4)}: p${PERCENTILE} ${p.toExponential(2)}, max ${err[n - 1].toExponential(2)}`)
}

const ok = worst < TOLERANCE && worstAfter < TOLERANCE_AFTER_PHASE_1
console.log(`${(elapsed / ITERS).toFixed(1)} ms per iteration (${n} points, ${DIM}D)`)
console.log(
  `${ok ? 'OK' : 'MISMATCH'}: p${PERCENTILE} error ${worst.toExponential(2)} of layout spread ${spread.toFixed(2)} ` +
    `through phase 1 (tolerance ${TOLERANCE})` +
    (ITERS > phase1 ? `, ${worstAfter.toExponential(2)} after (tolerance ${TOLERANCE_AFTER_PHASE_1})` : ''),
)
process.exit(ok ? 0 : 1)
