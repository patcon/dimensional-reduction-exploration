/**
 * Grouping phones by how alike their last window of readings is, as "Phone-flip crowd" does: each pair's correlation
 * (at its best shift within a lag tolerance), a graph of every pair or of each phone's k nearest, and Leiden on it,
 * with CPM or RB modularity as its quality. Pure, so it runs in a worker (analysis.worker.ts) and in checks.
 */

export type Quality = 'cpm' | 'mod'
export type GraphKind = 'full' | 'knn'

export interface AnalysisSettings {
  quality: Quality
  /** Resolution γ. */
  gamma: number
  graph: GraphKind
  k: number
  /** Start from the last window's groups. */
  warm: boolean
  /** Raw correlation: a phone face up and one face down at once are opposites. Otherwise |r|: only the rhythm counts. */
  align: boolean
  /** How far, in seconds, either signal may shift to line up best. */
  lagTol: number
  /**
   * Phones held still are alike as far as they face the same way, so holding is a rhythm of its own that groups.
   * Off, a still phone is like nothing (its correlation with anything is 0), as before Hold.
   */
  stillCounts: boolean
}

/** Colour slots for groups, matched to the last window's; groups past these are "other". */
export const NSLOT = 5

export interface AnalysisRequest {
  /** n signals of m samples each, one after another. */
  signals: Float32Array
  n: number
  m: number
  /** Samples a shift may reach. */
  lag: number
  settings: AnalysisSettings
  /** The last window's groups (warm start), for the same phones, or null. */
  prev: Int32Array | null
  /** Colour slots to match to: the last window's, for the same phones, or each phone's true section (−1 for none). */
  refSlots: Int32Array
  /** Each phone's true section, −1 for live phones; ARI is over synthetic phones only. */
  truth: Int32Array
  seed: number
}

export interface Analysis {
  memb: Int32Array
  slots: Int32Array
  k: number
  /** Agreement with the true sections (adjusted Rand index), over the synthetic phones; NaN with fewer than two. */
  ari: number
  ms: number
  /** Similarity, n × n. */
  S: Float32Array
  /** The edges Leiden sees (or, on every pair, those past the threshold), as i, j, weight. */
  edges: Float32Array
}

/**
 * A phone this steady over the window (its readings' standard deviation, below STILL_SD) is held still; above
 * MOVING_SD it's moving, and between, partly each. Sensor noise and wobble give about 0.06; a single flip in the
 * window, 0.3 or more.
 */
const STILL_SD = 0.15, MOVING_SD = 0.3

export function simMatrix(X: Float32Array, n: number, M: number, L: number, abs: boolean, stillCounts = false) {
  const S = new Float32Array(n * n)
  // Each phone's mean facing, and how still it's held (1 still, 0 moving).
  const mean = new Float64Array(n), still = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0, ss = 0
    for (let k = 0; k < M; k++) { const v = X[i * M + k]; s += v; ss += v * v }
    mean[i] = s / M
    const sd = Math.sqrt(Math.max(0, ss / M - mean[i] * mean[i]))
    still[i] = Math.max(0, Math.min(1, (MOVING_SD - sd) / (MOVING_SD - STILL_SD)))
  }
  for (let i = 0; i < n; i++) {
    S[i * n + i] = 1
    const oi = i * M
    for (let j = i + 1; j < n; j++) {
      const oj = j * M
      let best = -Infinity
      for (let s = -L; s <= L; s++) {
        const st = Math.max(0, -s), en = Math.min(M, M - s), c = en - st
        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
        for (let k = st; k < en; k++) {
          const a = X[oi + k], b = X[oj + k + s]
          sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b
        }
        const va = saa - (sa * sa) / c, vb = sbb - (sb * sb) / c
        const r = va > 1e-9 && vb > 1e-9 ? (sab - (sa * sb) / c) / Math.sqrt(va * vb) : 0
        const v = abs ? Math.abs(r) : r
        if (v > best) best = v
      }
      // Two phones held still: as alike as they face the same way (both up, 1; up and edge on, or down, 0), whether
      // or not alignment is required, since facing is all a held phone says.
      const w = stillCounts ? still[i] * still[j] : 0
      if (w > 0) best = (1 - w) * best + w * Math.max(0, 1 - Math.abs(mean[i] - mean[j]))
      S[i * n + j] = S[j * n + i] = best
    }
  }
  return S
}

interface G {
  n: number
  nbr: Int32Array[]
  w: Float64Array[]
  a: Float64Array
}

function nearest(S: Float32Array, n: number, i: number, k: number) {
  const idx: number[] = []
  for (let j = 0; j < n; j++) if (j !== i && S[i * n + j] > 0) idx.push(j)
  idx.sort((a, b) => S[i * n + b] - S[i * n + a])
  return idx.slice(0, k)
}

function buildGraph(S: Float32Array, n: number, P: AnalysisSettings) {
  const keep = new Float32Array(n * n)
  if (P.graph === 'full') {
    for (let q = 0; q < n * n; q++) if (S[q] > 0 && Math.floor(q / n) !== q % n) keep[q] = S[q]
  } else {
    for (let i = 0; i < n; i++) for (const j of nearest(S, n, i, P.k)) keep[i * n + j] = keep[j * n + i] = S[i * n + j]
  }
  const nbr: Int32Array[] = [], w: Float64Array[] = []
  for (let i = 0; i < n; i++) {
    const a: number[] = [], b: number[] = []
    for (let j = 0; j < n; j++) if (keep[i * n + j] > 0) { a.push(j); b.push(keep[i * n + j]) }
    nbr.push(Int32Array.from(a))
    w.push(Float64Array.from(b))
  }
  return { n, nbr, w }
}

// ── Leiden (CPM or RB modularity) ──
const THETA = 0.01
const identity = (n: number) => Int32Array.from({ length: n }, (_, i) => i)
function shuffledIds(n: number, rng: () => number) {
  const o = identity(n)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}
function renumber(m: Int32Array) {
  const map = new Map<number, number>()
  for (let i = 0; i < m.length; i++) {
    let v = map.get(m[i])
    if (v === undefined) map.set(m[i], (v = map.size))
    m[i] = v
  }
  return map.size
}

function moveNodes(g: G, memb: Int32Array, ge: number, rng: () => number) {
  const n = g.n, A = new Float64Array(n), cnt = new Int32Array(n), wTo = new Float64Array(n), stamp = new Int32Array(n)
  for (let v = 0; v < n; v++) { A[memb[v]] += g.a[v]; cnt[memb[v]]++ }
  const empty: number[] = []
  for (let c = n - 1; c >= 0; c--) if (cnt[c] === 0) empty.push(c)
  const queue = Array.from(shuffledIds(n, rng)), inQ = new Uint8Array(n).fill(1), touched: number[] = []
  let head = 0, tick = 0
  while (head < queue.length) {
    const v = queue[head++]
    inQ[v] = 0
    tick++
    const cur = memb[v], av = g.a[v], nb = g.nbr[v], ws = g.w[v]
    touched.length = 0
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k]
      if (u === v) continue
      const c = memb[u]
      if (stamp[c] !== tick) { stamp[c] = tick; wTo[c] = 0; touched.push(c) }
      wTo[c] += ws[k]
    }
    A[cur] -= av
    cnt[cur]--
    if (cnt[cur] === 0) empty.push(cur)
    let best = cur, bestGain = (stamp[cur] === tick ? wTo[cur] : 0) - ge * av * A[cur]
    for (const c of touched) {
      const gn = wTo[c] - ge * av * A[c]
      if (gn > bestGain + 1e-12) { bestGain = gn; best = c }
    }
    if (bestGain < -1e-12) {
      while (empty.length && cnt[empty[empty.length - 1]] > 0) empty.pop()
      if (empty.length) { best = empty[empty.length - 1]; bestGain = 0 }
    }
    memb[v] = best
    A[best] += av
    cnt[best]++
    if (best !== cur) for (let k = 0; k < nb.length; k++) { const u = nb[k]; if (!inQ[u] && memb[u] !== best) { inQ[u] = 1; queue.push(u) } }
  }
}

function refine(g: G, memb: Int32Array, ge: number, rng: () => number) {
  const n = g.n, ref = identity(n), RA = Float64Array.from(g.a), SA = new Float64Array(n), ext = new Float64Array(n), single = new Uint8Array(n).fill(1)
  for (let v = 0; v < n; v++) SA[memb[v]] += g.a[v]
  for (let v = 0; v < n; v++) { const nb = g.nbr[v], ws = g.w[v]; for (let k = 0; k < nb.length; k++) if (nb[k] !== v && memb[nb[k]] === memb[v]) ext[v] += ws[k] }
  const wTo = new Float64Array(n), stamp = new Int32Array(n), touched: number[] = []
  let tick = 0
  for (const v of shuffledIds(n, rng)) {
    if (!single[v]) continue
    const S = memb[v], av = g.a[v]
    if (ext[v] < ge * av * (SA[S] - av) - 1e-12) continue
    tick++
    touched.length = 0
    const nb = g.nbr[v], ws = g.w[v]
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k]
      if (u === v || memb[u] !== S) continue
      const c = ref[u]
      if (stamp[c] !== tick) { stamp[c] = tick; wTo[c] = 0; touched.push(c) }
      wTo[c] += ws[k]
    }
    const cands: number[] = [], gains: number[] = []
    let maxg = 0
    for (const c of touched) {
      if (c === v) continue
      if (ext[c] < ge * RA[c] * (SA[S] - RA[c]) - 1e-12) continue
      const gn = wTo[c] - ge * av * RA[c]
      if (gn >= 0) { cands.push(c); gains.push(gn); if (gn > maxg) maxg = gn }
    }
    if (!cands.length) continue
    const stay = Math.exp(-maxg / THETA), ps = gains.map((x) => Math.exp((x - maxg) / THETA))
    let r = rng() * (stay + ps.reduce((a, b) => a + b, 0)) - stay
    if (r < 0) continue
    let R = cands[cands.length - 1]
    for (let q = 0; q < cands.length; q++) { r -= ps[q]; if (r < 0) { R = cands[q]; break } }
    ext[R] = ext[R] + ext[v] - 2 * wTo[R]
    RA[R] += av
    RA[v] = 0
    ref[v] = R
    single[v] = 0
    single[R] = 0
  }
  return ref
}

function aggregate(g: G, part: Int32Array, k: number): G {
  const a = new Float64Array(k)
  for (let v = 0; v < g.n; v++) a[part[v]] += g.a[v]
  const maps = Array.from({ length: k }, () => new Map<number, number>())
  for (let v = 0; v < g.n; v++) {
    const cv = part[v], nb = g.nbr[v], ws = g.w[v]
    for (let q = 0; q < nb.length; q++) {
      const cu = part[nb[q]]
      if (cu === cv) continue
      maps[cv].set(cu, (maps[cv].get(cu) ?? 0) + ws[q])
    }
  }
  return { n: k, a, nbr: maps.map((m) => Int32Array.from(m.keys())), w: maps.map((m) => Float64Array.from(m.values())) }
}

function leiden(G0: { n: number; nbr: Int32Array[]; w: Float64Array[] }, init: Int32Array | null, rng: () => number, P: AnalysisSettings) {
  const n0 = G0.n, a0 = new Float64Array(n0)
  let tot = 0
  for (let v = 0; v < n0; v++) {
    let s = 0
    for (const x of G0.w[v]) s += x
    a0[v] = P.quality === 'cpm' ? 1 : s
    tot += s
  }
  const ge = P.quality === 'cpm' ? P.gamma : tot > 0 ? P.gamma / tot : 0
  let g: G = { n: n0, nbr: G0.nbr, w: G0.w, a: a0 }
  let memb = init ? Int32Array.from(init) : identity(n0)
  renumber(memb)
  const map = identity(n0)
  for (let level = 0; level < 32; level++) {
    moveNodes(g, memb, ge, rng)
    const nc = renumber(memb)
    if (nc === g.n) break
    let ref = refine(g, memb, ge, rng), nr = renumber(ref)
    if (nr === g.n) { ref = Int32Array.from(memb); nr = nc }
    const agg = aggregate(g, ref, nr), am = new Int32Array(nr)
    for (let v = 0; v < g.n; v++) am[ref[v]] = memb[v]
    for (let i = 0; i < n0; i++) map[i] = ref[map[i]]
    g = agg
    memb = am
  }
  const out = new Int32Array(n0)
  for (let i = 0; i < n0; i++) out[i] = memb[map[i]]
  renumber(out)
  return out
}

export function ari(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length
  if (n < 2) return NaN
  const cont = new Map<number, number>(), ra = new Map<number, number>(), rb = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const key = a[i] * 4096 + b[i]
    cont.set(key, (cont.get(key) ?? 0) + 1)
    ra.set(a[i], (ra.get(a[i]) ?? 0) + 1)
    rb.set(b[i], (rb.get(b[i]) ?? 0) + 1)
  }
  const c2 = (x: number) => (x * (x - 1)) / 2
  let idx = 0, ea = 0, eb = 0
  for (const v of cont.values()) idx += c2(v)
  for (const v of ra.values()) ea += c2(v)
  for (const v of rb.values()) eb += c2(v)
  const exp = (ea * eb) / c2(n), max = (ea + eb) / 2
  return max === exp ? 1 : (idx - exp) / (max - exp)
}

/** Stable colour slots: each group takes the slot it overlaps most among the reference's, biggest overlaps first. */
function matchSlots(memb: Int32Array, refSlots: Int32Array) {
  let k = 0
  for (const c of memb) k = Math.max(k, c + 1)
  const counts = new Map<number, number>()
  for (let i = 0; i < memb.length; i++) {
    if (refSlots[i] < 0 || refSlots[i] >= NSLOT) continue
    const key = memb[i] * 16 + refSlots[i]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ov = [...counts].map(([key, c]) => [c, Math.floor(key / 16), key % 16]).sort((x, y) => y[0] - x[0])
  const slotOf = new Array<number>(k).fill(-1), used = new Set<number>()
  for (const [, c, s] of ov) if (slotOf[c] < 0 && !used.has(s)) { slotOf[c] = s; used.add(s) }
  const sizes = new Array<number>(k).fill(0)
  for (const c of memb) sizes[c]++
  const rest = [...Array(k).keys()].filter((c) => slotOf[c] < 0).sort((x, y) => sizes[y] - sizes[x])
  for (const c of rest) {
    let s = 0
    while (used.has(s) && s < NSLOT) s++
    slotOf[c] = s
    if (s < NSLOT) used.add(s)
  }
  return slotOf
}

/** The edges drawn: the kNN graph's, or (on every pair) those at least as similar as CPM's γ, as a similarity cut-off. */
function displayEdges(S: Float32Array, n: number, P: AnalysisSettings) {
  const out: number[] = []
  if (P.graph === 'knn') {
    const seen = new Map<number, number>()
    for (let i = 0; i < n; i++) for (const j of nearest(S, n, i, Math.min(P.k, n - 1))) seen.set(Math.min(i, j) * 4096 + Math.max(i, j), S[i * n + j])
    for (const [key, w] of seen) out.push(Math.floor(key / 4096), key % 4096, w)
  } else {
    const th = P.quality === 'cpm' ? Math.max(P.gamma, 0.05) : 0.4
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (S[i * n + j] >= th) out.push(i, j, S[i * n + j])
  }
  return Float32Array.from(out)
}

function rngOf(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function analyse(req: AnalysisRequest): Analysis {
  const t0 = performance.now()
  const { signals, n, m, lag, settings: P } = req
  const S = simMatrix(signals, n, m, lag, !P.align, P.stillCounts)
  const G = buildGraph(S, n, P)
  const rng = rngOf(req.seed)
  let memb = leiden(G, P.warm && req.prev?.length === n ? req.prev : null, rng, P)
  memb = leiden(G, memb, rng, P)
  const slotOf = matchSlots(memb, req.refSlots)
  const slots = Int32Array.from(memb, (c) => slotOf[c])
  let k = 0
  for (const c of memb) k = Math.max(k, c + 1)
  const synth: number[] = [], truth: number[] = []
  for (let i = 0; i < n; i++) if (req.truth[i] >= 0) { synth.push(memb[i]); truth.push(req.truth[i]) }
  return { memb, slots, k, ari: ari(synth, truth), ms: performance.now() - t0, S, edges: displayEdges(S, n, P) }
}
