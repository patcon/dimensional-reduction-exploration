/**
 * The crowd: phones being flipped to the beat, each a signal from −1 (face down) to +1 (face up), sampled FS times a
 * second. Most are synthetic, after "Phone-flip crowd · harmony from clusters": each follows a beat pattern, with its
 * own reaction lag, timing jitter, flip speed, tilt and sensor noise. Live phones join them, recorded as the clock runs.
 *
 * Time is song time, in seconds: one bar is BAR seconds, four SLOTs counted 1 e & a.
 */

/** Seconds per step of a pattern (a quarter of a bar), per bar, and in the window analysed. */
export const SLOT = 0.5
export const BAR = 2
export const WIN = 8
/** Samples a second. */
export const FS = 20
export const SUB = ['1', 'e', '&', 'a']
/** Song time to start at, so the first window is full. */
export const START_T = WIN + 0.5

export interface Pattern {
  name: string
  desc: string
  /** Which of 1 e & a it flips on. */
  mask: readonly [number, number, number, number]
}

/** Slow, Fast and 1-e-& start the crowd; 1-&-a is only ever chosen, and like them, on a clean grid it correlates at 0 with each. */
export const PATTERNS: readonly Pattern[] = [
  { name: 'Slow', desc: 'every 1 s', mask: [1, 0, 1, 0] },
  { name: 'Fast', desc: 'every ½ s', mask: [1, 1, 1, 1] },
  { name: '1-e-&', desc: '½ s, rest on a', mask: [1, 1, 1, 0] },
  { name: '1-&-a', desc: '½ s, rest on e', mask: [1, 0, 1, 1] },
]
export const START_PATTERNS = 3

/** How the synthetic crowd behaves. */
export interface CrowdSettings {
  count: number
  /** Timing jitter per flip, σ in seconds. */
  jitter: number
  /** Spread of reaction lags, σ in seconds. */
  lagSpread: number
  /** Sensor noise, σ. */
  noise: number
  /** Chance of missing a flip. */
  miss: number
  /** Share of phones keeping to their section's agreed facing, rather than toggling from a random start. */
  sync: number
  /** Sections spread over the seats at random, rather than in three blocks. */
  shuffleSeats: boolean
}

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

const SEED = 7
export function hash(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d) ^ Math.imul(SEED, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
export function gauss(a: number, b: number, c: number) {
  const u = Math.max(1e-9, hash(a, b, c)), v = hash(a, b, c + 7919)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
export function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffled(n: number, rng: () => number) {
  const o = Int32Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

interface Segment {
  from: number
  pattern: number
}

/** One synthetic phone. */
export interface Person {
  id: number
  /** Which pattern it follows from when, in order. */
  segs: Segment[]
  lag: number
  /** How long a flip takes. */
  dur: number
  amp: number
  synced: boolean
  /** Facing before its first flip. */
  s0: number
  js: number
  phi: number
  wf: number
  /** Flips: when, and which way it faces after. */
  ev: number[]
  evS: number[]
  cursor: number
}

/** The section's agreed facing after step s: face up at t = 0, flipping on every step of the pattern. */
function refState(pattern: number, s: number) {
  const m = PATTERNS[pattern].mask, per = m[0] + m[1] + m[2] + m[3]
  let c = Math.floor(s / 4) * per
  for (let k = 0; k <= s % 4; k++) c += m[k]
  return c & 1 ? -1 : 1
}

export class Crowd {
  people: Person[] = []
  private settings: CrowdSettings
  private seatMap: Int32Array | null = null
  /** Flips are worked out this far ahead of the clock, and so a change of pattern can only start after it. */
  static readonly AHEAD = 0.4

  constructor(settings: CrowdSettings) {
    this.settings = settings
    this.build(false)
  }

  get n() {
    return this.people.length
  }

  /** New settings: a new count starts over; others rebuild each phone's habits, keeping who follows what when. */
  configure(settings: CrowdSettings, horizon: number) {
    const restart = settings.count !== this.settings.count || settings.shuffleSeats !== this.settings.shuffleSeats
    this.settings = settings
    if (restart) this.seatMap = null
    this.build(!restart)
    this.generate(horizon)
  }

  /** Starts over: everyone back in their section, and (shuffled) seats dealt afresh. */
  restart(horizon: number) {
    this.seatMap = null
    this.build(false)
    this.generate(horizon)
  }

  private seatPattern(i: number) {
    const N = this.settings.count
    if (!this.settings.shuffleSeats) return Math.floor((i * START_PATTERNS) / N)
    if (!this.seatMap || this.seatMap.length !== N) {
      const perm = shuffled(N, mulberry32((Date.now() & 0xffffff) + 1))
      this.seatMap = new Int32Array(N)
      perm.forEach((who, k) => (this.seatMap![who] = Math.floor((k * START_PATTERNS) / N)))
    }
    return this.seatMap[i]
  }

  private build(keepSegs: boolean) {
    const old = this.people
    const P = this.settings
    this.people = Array.from({ length: P.count }, (_, i) => {
      const synced = hash(i, 0, 9) < P.sync - 1e-9
      return {
        id: i,
        segs: keepSegs && old[i] ? old[i].segs : [{ from: -1e9, pattern: this.seatPattern(i) }],
        lag: clamp(0.18 + P.lagSpread * gauss(i, 0, 1), 0.04, 0.5),
        dur: 0.15 + 0.15 * hash(i, 0, 2),
        amp: 0.82 + 0.16 * hash(i, 0, 3),
        synced,
        s0: synced ? 1 : hash(i, 0, 4) < 0.5 ? -1 : 1,
        js: 0.6 + 0.8 * hash(i, 0, 5),
        phi: hash(i, 0, 6) * 6.283,
        wf: 0.15 + 0.2 * hash(i, 0, 8),
        ev: [],
        evS: [],
        cursor: 0,
      }
    })
  }

  /** The pattern phone p follows at time t. */
  patternAt(i: number, t: number) {
    const segs = this.people[i].segs
    let g = segs[0].pattern
    for (const s of segs) {
      if (t >= s.from) g = s.pattern
      else break
    }
    return g
  }

  /** Works out flips up to `horizon`. */
  generate(horizon: number) {
    const P = this.settings
    for (const p of this.people) {
      while (p.cursor * SLOT <= horizon) {
        const s = p.cursor++, tn = s * SLOT, g = this.patternAt(p.id, tn)
        if (!PATTERNS[g].mask[s % 4]) continue
        if (hash(p.id, s, 11) < P.miss) continue
        const cur = p.evS.length ? p.evS[p.evS.length - 1] : p.s0
        const target = p.synced ? refState(g, s) : -cur
        if (target === cur) continue
        let t = tn + p.lag + clamp(P.jitter * p.js * gauss(p.id, s, 10), -0.2, 0.2)
        const last = p.ev.length ? p.ev[p.ev.length - 1] : -1e9
        if (t < last + 0.08) t = last + 0.08
        p.ev.push(t)
        p.evS.push(target)
      }
    }
  }

  /** Phone i's facing at time t, without noise. */
  value(i: number, t: number) {
    const p = this.people[i], ev = p.ev
    let lo = 0, hi = ev.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (ev[m] <= t) lo = m + 1
      else hi = m
    }
    const cur = lo ? p.evS[lo - 1] : p.s0
    let v = cur
    if (lo > 0) {
      const dt = t - ev[lo - 1]
      if (dt < p.dur) {
        const prev = lo > 1 ? p.evS[lo - 2] : p.s0
        v = prev + ((cur - prev) * (1 - Math.cos((Math.PI * dt) / p.dur))) / 2
      }
    }
    return v * p.amp + 0.05 * Math.sin(p.wf * 6.283 * t + p.phi)
  }

  /** Phone i's reading at sample n, with sensor noise. */
  sample(i: number, n: number) {
    return this.value(i, n / FS) + this.settings.noise * gauss(i, n, 20)
  }

  /** Phones `who` switch to `pattern` at the next step after flips already worked out: nothing played is rewritten. */
  assign(who: Iterable<number>, pattern: number, t: number) {
    const from = Math.ceil((t + Crowd.AHEAD + 0.05) / SLOT) * SLOT
    let moved = 0
    for (const i of who) {
      const p = this.people[i]
      if (!p) continue
      p.segs = p.segs.filter((sg) => sg.from < from)
      if (this.patternAt(i, from) !== pattern) {
        p.segs.push({ from, pattern })
        moved++
      }
    }
    return { from, moved }
  }

  /** A tenth of the crowd (at least one) moves on to the next starting section's pattern, at the next bar. */
  moveTenth(t: number) {
    const N = this.n
    const from = Math.ceil((t + 0.5) / BAR) * BAR
    const pick = Array.from(shuffled(N, mulberry32(Math.floor(t * 1000)))).slice(0, Math.max(1, Math.round(N / 10)))
    for (const i of pick) {
      const p = this.people[i]
      p.segs = p.segs.filter((sg) => sg.from < from)
      p.segs.push({ from, pattern: (this.patternAt(i, from) + 1) % START_PATTERNS })
    }
    return { from, picked: pick }
  }
}

/** Seconds of live readings kept per phone. */
const LIVE_SECONDS = 120
const LIVE_CAP = LIVE_SECONDS * FS

/**
 * Live phones' readings, recorded at each sample the clock passes, from the room's latest tilt per slot. A phone is
 * read as 0 before it joined (or once its recording is older than what's kept).
 */
export class LiveRecorder {
  private rings = new Map<number, { data: Float32Array; since: number }>()
  private lastN: number | null = null

  /** Records samples up to song time t, for the slots here now; slots that have gone are forgotten. */
  record(t: number, slots: readonly number[], valence: Float32Array) {
    const n = Math.floor(t * FS)
    const here = new Set(slots)
    for (const slot of [...this.rings.keys()]) if (!here.has(slot)) this.rings.delete(slot)
    const from = this.lastN === null || n < this.lastN || n - this.lastN > LIVE_CAP ? n : this.lastN + 1
    for (const slot of slots) {
      let ring = this.rings.get(slot)
      if (!ring) this.rings.set(slot, (ring = { data: new Float32Array(LIVE_CAP), since: from }))
      for (let k = Math.max(from, ring.since); k <= n; k++) ring.data[k % LIVE_CAP] = valence[slot]
    }
    this.lastN = n
  }

  /** Forgets everything: on restarting the clock, say. */
  clear() {
    this.rings.clear()
    this.lastN = null
  }

  sample(slot: number, n: number) {
    const ring = this.rings.get(slot)
    if (!ring || this.lastN === null || n < ring.since || n > this.lastN || this.lastN - n >= LIVE_CAP) return 0
    return ring.data[n % LIVE_CAP]
  }
}
