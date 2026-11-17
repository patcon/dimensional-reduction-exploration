// Checks the crowd and how it's read, without a browser:
// - Grouping: the synthetic crowd's three sections are found again from a window of their signals (ARI near 1), and
//   phones given a new pattern form a group of their own once the window has moved on past the switch.
// - Beat: the step people flip to is found from their flips (played by simulated phones, at a tempo other than the
//   song's own), whatever mix of patterns they play; random flips give none.
// - Rhythm: a group's rhythm keeps a pattern two bars long (1-2-345-) whole, and one a bar long comes out twice.
// - Calibration: with set high and set low, a phone's facing runs smoothly and in order from −1 to +1 as it's flipped,
//   whichever way it's turned over, with no reading missing on the way (the old reading held in the middle).
import { analyse, type AnalysisSettings } from '../src/analysis.ts'
import { Crowd, FS, SLOT, START_T, WIN } from '../src/crowd.ts'
import { RHYTHM_ON, RHYTHM_STEPS, rhythmOf } from '../src/rhythm.ts'
import { detectBeat, FlipListener } from '../src/tempo.ts'
import { angle, valenceOf, type Vec } from '../src/remote/valence.ts'

let failed = 0
function check(ok: boolean, what: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed++
}

const SETTINGS: AnalysisSettings = { quality: 'cpm', gamma: 0.4, graph: 'full', k: 10, warm: true, align: false, lagTol: 0.15 }

function groupAt(crowd: Crowd, t: number, settings = SETTINGS) {
  const n = crowd.n, M = WIN * FS, n1 = Math.floor(t * FS), n0 = n1 - M + 1
  const signals = new Float32Array(n * M)
  for (let i = 0; i < n; i++) for (let k = 0; k < M; k++) signals[i * M + k] = crowd.sample(i, n0 + k)
  const truth = Int32Array.from({ length: n }, (_, i) => crowd.patternAt(i, t))
  return { ...analyse({ signals, n, m: M, lag: Math.round(settings.lagTol * FS), settings, prev: null, refSlots: truth, truth, seed: 12345 }), truth }
}

{
  const crowd = new Crowd({ count: 60, jitter: 0.05, lagSpread: 0.06, noise: 0.05, miss: 0, sync: 0.85, shuffleSeats: false })
  let t = START_T
  crowd.generate(t + Crowd.AHEAD)
  const a = groupAt(crowd, t)
  check(a.k === 3 && a.ari > 0.9, `three sections found from the first window: ${a.k} groups, ARI ${a.ari.toFixed(3)}, ${a.ms.toFixed(0)} ms`)
  // Requiring alignment, phones facing the other way from their section are a group of their own, unless all keep in step.
  const aligned = new Crowd({ count: 60, jitter: 0.05, lagSpread: 0.06, noise: 0.05, miss: 0, sync: 1, shuffleSeats: false })
  aligned.generate(t + Crowd.AHEAD)
  const b = groupAt(aligned, t, { ...SETTINGS, align: true })
  check(b.k === 3 && b.ari > 0.9, `requiring +1/−1 alignment, with every phone in step: ${b.k} groups, ARI ${b.ari.toFixed(3)}`)
  // Ten phones of the first section switch to 1-&-a; two windows on, they're a group of their own.
  const { from, moved } = crowd.assign([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3, t)
  check(moved === 10 && from > t + Crowd.AHEAD, `ten phones switch at ${from.toFixed(1)} s, after what's been worked out (${(t + Crowd.AHEAD).toFixed(1)} s)`)
  t = from + WIN + 0.5
  crowd.generate(t + Crowd.AHEAD)
  const c = groupAt(crowd, t)
  const moved10 = new Set(Array.from({ length: 10 }, (_, i) => c.memb[i]))
  check(c.k === 4 && moved10.size === 1 && c.ari > 0.9, `a window after the switch, they're a fourth group: ${c.k} groups, ARI ${c.ari.toFixed(3)}`)
}

{
  const norm = (v: Vec): Vec => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l] }
  // Set high face up (top raised a little), set low face down, a little skewed: as people hold them, never exactly opposite.
  const high = norm([0.05, 0.17, 0.98]), low = norm([-0.1, 0.12, -0.98])
  check(angle(high, low) < Math.PI - 0.05, `setpoints ${((angle(high, low) * 180) / Math.PI).toFixed(0)}° apart, short of opposite`)
  const turns: Record<string, (th: number) => Vec> = {
    'turned over sideways': (th) => norm([Math.sin(th), 0.17, Math.cos(th)]),
    'turned over end to end': (th) => norm([0, Math.sin(th) * 0.98 + 0.17 * Math.cos(th), Math.cos(th)]),
    'turned over diagonally': (th) => norm([Math.sin(th) * 0.7, 0.17 + Math.sin(th) * 0.7, Math.cos(th)]),
  }
  for (const [how, up] of Object.entries(turns)) {
    const vs = Array.from({ length: 37 }, (_, k) => valenceOf('flip', { low, high }, up((Math.PI * k) / 36)) ?? NaN)
    const steps = vs.slice(1).map((v, k) => v - vs[k])
    const ok = vs.every((v) => !Number.isNaN(v)) && vs[0] > 0.9 && vs[36] < -0.9 && steps.every((d) => d <= 0.02) && Math.max(...steps.map(Math.abs)) < 0.15 && vs.some((v) => Math.abs(v) < 0.2)
    check(ok, `${how}: ${vs[0].toFixed(2)} → ${vs[18].toFixed(2)} → ${vs[36].toFixed(2)}, falling steadily (largest change ${Math.max(...steps.map(Math.abs)).toFixed(2)})`)
  }
  // Only high set: the detection's own low (face down) stands in.
  const tilted = norm([0, 0.7, 0.7])
  check((valenceOf('flip', { low: null, high: tilted }, tilted) ?? 0) > 0.999 && (valenceOf('flip', { low: null, high: tilted }, [0, 0, -1]) ?? 0) < -0.999, 'with only high set, face down is still −1')
}

{
  // Six people, two each of Slow, Fast and 1-e-&, flipping at 140 steps a minute: the simulated crowd's phones,
  // their song time run 140/120 as fast as the wall clock, heard as live phones are, sixty times a second.
  const people = new Crowd({ count: 6, jitter: 0.05, lagSpread: 0.06, noise: 0.05, miss: 0, sync: 0.85, shuffleSeats: false })
  const listen = (crowd: Crowd, tempo: number, seconds: number, only?: number[]) => {
    const rate = tempo / 120, ears = new FlipListener(), slots = only ?? [...Array(crowd.n).keys()], valence = new Float32Array(crowd.n)
    crowd.generate(seconds * rate + 1)
    for (let wall = 0; wall < seconds; wall += 1 / 60) {
      for (const i of slots) valence[i] = crowd.sample(i, Math.floor(wall * rate * FS))
      ears.hear(slots, valence, wall, wall * rate, 60)
    }
    return detectBeat(ears.onsets.map((o) => o.wall))
  }
  for (const tempo of [100, 140, 165]) {
    const beat = listen(people, tempo, 10)
    check(beat !== null && Math.abs(60 / beat.step - tempo) < 3, `people flipping a mix of patterns at ${tempo}/min: heard ${beat ? `${(60 / beat.step).toFixed(1)}/min, fitting ${beat.fit.toFixed(2)}, from ${beat.onsets} flips` : 'nothing'}`)
  }
  // Only the two Slow ones (flipping every other step): twice the step, folded back onto it.
  const slow = listen(people, 120, 10, [0, 1])
  check(slow !== null && Math.abs(60 / slow.step - 120) < 3, `only Slow flippers at 120/min: heard ${slow ? `${(60 / slow.step).toFixed(1)}/min` : 'nothing'}`)
  // Flips at random: no beat.
  const rng = (() => { let a = 3; return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648) })()
  const random = Array.from({ length: 40 }, () => rng() * 10).sort((x, y) => x - y)
  check(detectBeat(random) === null, 'flips at random: no beat')
}

{
  // A phone flipping on these steps of every two bars, 0.25 s after each (reacting), each flip taking 0.25 s.
  const flipper = (steps: number[]) => (n: number) => {
    const t = n / FS
    let v = 1
    for (let s = 0; s * SLOT <= t; s++) {
      if (!steps.includes(s % RHYTHM_STEPS)) continue
      const u = (t - s * SLOT - 0.25) / 0.25
      if (u >= 1) v = -v
      else if (u > 0) return v * (1 - 2 * u)
    }
    return v
  }
  const heard = (steps: number[], t: number) => {
    const r = rhythmOf([0], t, (_, n) => flipper(steps)(n))
    return r.flatMap((e, q) => (e >= RHYTHM_ON ? [q] : []))
  }
  // 1-2-345-, counted a step each over two bars: 1 and & in the first; 1, e and & in the second.
  const two = [0, 2, 4, 5, 6]
  for (const t of [40, 41.3, 47.9]) {
    const got = heard(two, t)
    check(got.join() === two.join(), `1-2-345- over two bars, at ${t} s: heard on steps ${got.join(' ')}`)
  }
  const one = [0, 1, 2, 4, 5, 6]
  const got = heard(one, 40)
  check(got.join() === one.join(), `1 e & every bar: heard on steps ${got.join(' ')}`)
}

if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
