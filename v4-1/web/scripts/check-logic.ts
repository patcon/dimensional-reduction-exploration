// Checks of the small pure pieces that are easy to get subtly wrong: valence lookups wrapping when
// playback loops, the playhead's laps and window, presets filling in missing settings, the group
// legend's sample of each group staying put through churn and representing merges, and neighbour
// forces being one-way only when asked.
// Plain Node (no DOM types), so it's type-checked with the app: `pnpm check:logic`.
import { knnGraph, neighbourAffinity } from '../src/knn.ts'
import { Playhead } from '../src/playhead.ts'
import { completeSettings, DEFAULT_SETTINGS } from '../src/presets.ts'
import { groupFromClusters, sampleGroups } from '../src/selection.ts'
import { buildTraces, N_PIXELS, valenceAt, type Traces } from '../src/signal.ts'
import { Particles } from '../src/viz/particles.ts'
import { DEFAULT_PARTICLES } from '../src/vizSettings.ts'

const failures: string[] = []
function check(name: string, actual: unknown, expected: unknown) {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)]
  if (a !== e) failures.push(`${name}: got ${a}, expected ${e}`)
}
const close = (x: number) => Math.round(x * 1e6) / 1e6

// ── valenceAt: clamped at the ends, or wrapping with a period of length − 1 (the last moment is the first again) ──
const traces = { n: 1, length: 5, valence: Float32Array.from([0, 1, 2, 3, 4]) } as unknown as Traces
check('clamped before the start', valenceAt(traces, 0, -1), 0)
check('clamped past the end', valenceAt(traces, 0, 10), 4)
check('interpolated', valenceAt(traces, 0, 1.5), 1.5)
check('wrapped before the start', valenceAt(traces, 0, -1, true), 3)
check('wrapped, interpolated', close(valenceAt(traces, 0, -0.5, true)), 3.5)
check('wrapped past the end', valenceAt(traces, 0, 5, true), 1)

// ── buildTraces against a speaker: matching agrees, ink against paper disagrees ──
const digitPixels = new Uint8Array(3 * N_PIXELS)
for (let p = 0; p < N_PIXELS; p++) {
  digitPixels[p] = p % 3 ? 0 : 255
  digitPixels[N_PIXELS + p] = digitPixels[p]
  digitPixels[2 * N_PIXELS + p] = 255 - digitPixels[p]
}
const unsmoothed = { ...DEFAULT_SETTINGS.signal, smoothingPixels: 0, mapping: 'ink' as const }
const heard = buildTraces(digitPixels, [1, 2], unsmoothed, 0)
check('a digit matching the speaker agrees throughout', heard.valence.subarray(0, heard.length).every((v) => v === 1), true)
check('a digit inverting the speaker disagrees throughout', heard.valence.subarray(heard.length).every((v) => v === -1), true)
const own = buildTraces(digitPixels, [0], unsmoothed)
check('with no speaker, ink speaks for itself', [own.valence[own.momentOf[0]], own.valence[own.momentOf[1]]], [1, -1])

// ── Line starts: each row's first pixel read, past any skipped ──
const startsOf = (t: Traces) => [...t.lineStart.keys()].filter((i) => t.lineStart[i])
check('every row starts a line', [startsOf(own).length, ...startsOf(own).slice(0, 3)], [28, 0, 28, 56])
// Ink only in columns 1 and 2: each row's start (column 0) is skipped, so it lands on column 1.
const stripes = new Uint8Array(N_PIXELS)
for (let r = 0; r < 28; r++) stripes[r * 28 + 1] = stripes[r * 28 + 2] = 255
const skipping = buildTraces(stripes, [0], { ...unsmoothed, skipBlank: true })
check('skipped starts carry onto the next pixel read', startsOf(skipping).slice(0, 3), [0, 2, 4])

// ── Playhead: laps, and the window ──
const playhead = new Playhead()
playhead.setLength(101)
playhead.seek(5)
check('first play-through: window stops at the start', playhead.windowRanges(10), [[0, 5]])
playhead.seek(99)
playhead.setSpeed(10)
playhead.setPlaying(true)
playhead.tick(0.2)
check('looping past the end counts a lap', [close(playhead.moment), playhead.laps, playhead.wraps], [1, 1, true])
check('elapsed counts through the loop', close(playhead.elapsed), 101)
check('once looped: window wraps round to the end', playhead.windowRanges(10).map((r) => r.map(close)), [[0, 1], [91, 100]])
check('a window longer than the loop stops at now', playhead.windowRanges(500).map((r) => r.map(close)), [[0, 1], [1, 100]])
playhead.restart()
check('restart forgets laps', [playhead.moment, playhead.laps, playhead.wraps], [0, 0, false])

// ── completeSettings: an old or partial preset gets defaults for whatever it lacks ──
check('an old preset\'s reading order is dropped', 'reading' in completeSettings({ signal: { reading: 'spiral' } as never }).signal, false)
const partial = completeSettings({ resolution: 0.5, style: { traceWidth: 3 } as never, particles: { cohesion: 0.65 } as never })
check('given settings kept', [partial.resolution, partial.style.traceWidth, partial.particles.cohesion], [0.5, 3, 0.65])
check('missing top-level settings filled', partial.digits, DEFAULT_SETTINGS.digits)
check('missing nested settings filled', [partial.style.colorBy, partial.style.focusRing, partial.particles.damping], [
  DEFAULT_SETTINGS.style.colorBy,
  true,
  DEFAULT_SETTINGS.particles.damping,
])
check('nested-nested settings merged', completeSettings({ style: { opacity: { fill: 0.1 } } as never }).style.opacity, {
  ...DEFAULT_SETTINGS.style.opacity,
  fill: 0.1,
})

// ── sampleGroups: each group's earliest members in one fixed order ──
const order = [7, 2, 9, 0, 5, 3, 8, 1, 6, 4]
// Two groups: evens and odds.
const split = Int32Array.from({ length: 10 }, (_, i) => i % 2)
check('earliest members, in order', sampleGroups(2, split, order, 3), [[2, 0, 8], [7, 9, 5]])
// 4 (unpicked, late in the order) moves to the odds: neither group's picks change.
const churned = Int32Array.from(split, (g, i) => (i === 4 ? 1 : g))
check('a late member moving changes nothing', sampleGroups(2, churned, order, 3), [[2, 0, 8], [7, 9, 5]])
// The two merge: the merged group's picks come from both.
check('a merged group shows both', sampleGroups(1, new Int32Array(10), order, 3), [[7, 2, 9]])

// ── groupFromClusters: HDBSCAN's noise is a group of its own, last; clusters keep their ids from the last run ──
const hdb = groupFromClusters([0, 0, 1, 1, 7], Int32Array.from([0, 0, 1, 1, -1]))
check('clusters, then noise', hdb.groups.map((g) => [g.name, g.size, g.noise ?? false]), [['1', 2, false], ['2', 2, false], ['noise', 1, true]])
check('each digit in its group', Array.from(hdb.groupOf), [0, 0, 1, 1, 2])
// The same clusters, numbered the other way round by HDBSCAN (largest first), keep their ids.
const again = groupFromClusters([0, 0, 1, 1, 7], Int32Array.from([1, 1, 0, 0, 0]), hdb)
check('ids carried over', again.groups.map((g) => [g.name, g.size]), [['1', 2], ['2', 3]])

// ── neighbourAffinity: symmetrised, Leiden's graph weights; one-way, not mutual ──
// A tight cluster of 6 on a line, and one outlier off to the side: it counts them, they don't count it.
const linePoints = Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5, 3])
const nLine = linePoints.length
const graph = knnGraph(linePoints, nLine, 1, 4)
const sym = neighbourAffinity(linePoints, nLine, 1, 4, false)
let worst = 0
for (let i = 0; i < nLine; i++) {
  for (let e = graph.offsets[i]; e < graph.offsets[i + 1]; e++) worst = Math.max(worst, Math.abs(sym[i * nLine + graph.nbrs[e]] - graph.weights[e]))
}
check("symmetrised affinity is Leiden's graph", worst < 1e-6, true)
check('symmetrised affinity is symmetric', sym.every((w, at) => w === sym[(at % nLine) * nLine + Math.floor(at / nLine)]), true)
const oneWay = neighbourAffinity(linePoints, nLine, 1, 4, true)
check('the outlier counts its nearest', oneWay[6 * nLine + 5] > 0, true)
check("which doesn't count it back", oneWay[5 * nLine + 6], 0)

// ── Particles.advance: symmetric forces cancel overall; one-way forces needn't ──
function netPush(affinity: Float32Array) {
  const sim = new Particles(4)
  sim.resize(nLine)
  for (let i = 0; i < nLine; i++) { sim.x[i] = linePoints[i] * 20 - 30; sim.y[i] = (i % 2) * 15 }
  sim.advance(new Int32Array(nLine), affinity, new Float32Array(nLine), { ...DEFAULT_PARTICLES, radius: 150, cohesion: 0.6, separation: -0.3 }, false)
  // Within the boundary and with no speaker, velocities are the pair forces alone; their sum is the net push.
  let sx = 0
  for (let i = 0; i < nLine; i++) sx += sim.x[i] - sim.prevX[i]
  return Math.abs(sx)
}
check('symmetric forces leave the cloud where it was', netPush(sym) < 1e-4, true)
check('one-way forces push it', netPush(oneWay) > 1e-3, true)

if (failures.length) throw new Error(`${failures.length} failed:\n${failures.join('\n')}`)
console.log('All logic checks pass.')
