/**
 * The crowd as it plays: the clock, the synthetic phones and the live ones, grouping each window in a worker, the
 * force layout, and the sound. Outside React: the graph reads it every frame, and the page through a snapshot that
 * changes when there's something new to show.
 */

import type { Analysis, AnalysisSettings } from './analysis'
import type { AnalysisAnswer, AnalysisMessage } from './analysis.worker'
import { Crowd, FS, LiveRecorder, START_T, WIN, type CrowdSettings } from './crowd'
import { ForceLayout, LayoutView, type LayoutSettings } from './layout'
import { Ensemble, Sound, type SoundMode } from './music'
import { WorkerQueue } from './workerQueue'

/** Song time between groupings. */
const ANALYSIS_EVERY = 0.5
/** Layout steps a frame. */
const LAYOUT_STEPS = 2
/** The page's snapshot is refreshed at most this often, in ms, between groupings. */
const SNAPSHOT_MS = 250

/** A phone: synthetic (its index in the crowd) or live (its room slot). */
export interface Phone {
  key: string
  live: boolean
  /** The crowd index, or the room slot. */
  index: number
}

export interface Snapshot {
  t: number
  playing: boolean
  phones: Phone[]
  analysis: (Analysis & { keys: string[] }) | null
  /** ARI over time, oldest first. */
  ariHistory: number[]
  ensemble: Ensemble['list']
  version: number
}

export class CrowdEngine {
  t = START_T
  playing = true
  speed = 1
  readonly crowd: Crowd
  readonly live = new LiveRecorder()
  readonly layout = new ForceLayout()
  readonly view = new LayoutView()
  readonly ensemble = new Ensemble()
  readonly sound = new Sound()
  phones: Phone[] = []
  analysis: (Analysis & { keys: string[] }) | null = null
  /** Live phones' facing now, by slot (the room's, shared). */
  private liveValence: Float32Array = new Float32Array(0)
  private liveSlots: number[] = []
  private analysisSettings: AnalysisSettings
  private layoutSettings: LayoutSettings
  private minGroupShare = 0.1
  private nextAnalysis = 0
  private ariHistory: number[] = []
  private queue: WorkerQueue<AnalysisMessage, AnalysisAnswer>
  private listeners = new Set<() => void>()
  private snapshot: Snapshot
  private lastSnapshotAt = 0
  private version = 0
  private lastFrame: number | null = null
  private raf = 0

  constructor(crowd: CrowdSettings, analysis: AnalysisSettings, layout: LayoutSettings) {
    this.crowd = new Crowd(crowd)
    this.analysisSettings = analysis
    this.layoutSettings = layout
    this.crowd.generate(this.t + Crowd.AHEAD)
    this.queue = new WorkerQueue(new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }))
    this.syncPhones()
    this.snapshot = this.makeSnapshot()
  }

  /** Runs the clock, a step a frame, until the returned function is called. */
  start() {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame)
      this.frame(now)
    }
    this.lastFrame = null
    this.raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(this.raf)
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  // ── For React ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getSnapshot = () => this.snapshot
  private makeSnapshot(): Snapshot {
    return { t: this.t, playing: this.playing, phones: this.phones, analysis: this.analysis, ariHistory: this.ariHistory, ensemble: this.ensemble.list, version: ++this.version }
  }
  private changed() {
    this.snapshot = this.makeSnapshot()
    this.lastSnapshotAt = performance.now()
    this.listeners.forEach((fn) => fn())
  }

  // ── Settings ──
  setCrowd(settings: CrowdSettings) {
    this.crowd.configure(settings, this.t + Crowd.AHEAD)
    if (this.syncPhones()) this.ensemble.clear()
    this.analyseNow()
  }
  setAnalysis(settings: AnalysisSettings) {
    const fresh = settings.quality !== this.analysisSettings.quality || settings.graph !== this.analysisSettings.graph || settings.align !== this.analysisSettings.align
    this.analysisSettings = settings
    if (fresh) this.analysis = null
    this.analyseNow()
  }
  setLayout(settings: LayoutSettings) {
    this.layoutSettings = settings
  }
  setMinGroupShare(share: number) {
    this.minGroupShare = share
    this.updateEnsemble()
  }
  setSound(opts: { on: boolean; mode: SoundMode; volume: number; metronome: boolean }) {
    this.sound.set(opts, this.ensemble, this.t)
    this.sound.setPlaying(this.playing, this.t)
  }
  setPlaying(playing: boolean) {
    this.playing = playing
    this.lastFrame = null
    this.sound.setPlaying(playing, this.t)
    this.changed()
  }
  /** The room's participants, by slot, and their facing now (read as it changes). */
  setLive(slots: number[], valence: Float32Array) {
    this.liveSlots = [...slots].sort((a, b) => a - b)
    this.liveValence = valence
    if (this.syncPhones()) this.analyseNow()
  }

  /** Starts the song over: everyone back to their sections (dealt afresh, shuffled), and live recordings forgotten. */
  restart() {
    this.t = START_T
    this.crowd.restart(this.t + Crowd.AHEAD)
    this.live.clear()
    this.analysis = null
    this.ariHistory = []
    this.ensemble.clear()
    this.analyseNow()
  }

  /** Synthetic phones among `phones` (indices into this.phones) take up a pattern at the next step. */
  assign(phones: number[], pattern: number) {
    const crowd = phones.map((i) => this.phones[i]).filter((p) => p && !p.live).map((p) => p.index)
    return this.crowd.assign(crowd, pattern, this.t)
  }
  moveTenth() {
    return this.crowd.moveTenth(this.t)
  }

  // ── Reading ──
  /** Phone i's facing now. */
  value(i: number) {
    const p = this.phones[i]
    if (!p) return 0
    return p.live ? (this.liveValence[p.index] ?? 0) : this.crowd.value(p.index, this.t)
  }
  /** Phone i's reading at sample n. */
  sample = (i: number, n: number) => {
    const p = this.phones[i]
    if (!p) return 0
    return p.live ? this.live.sample(p.index, n) : this.crowd.sample(p.index, n)
  }
  /** Phone i's true pattern now, or −1 for a live phone. */
  pattern(i: number) {
    const p = this.phones[i]
    return !p || p.live ? -1 : this.crowd.patternAt(p.index, this.t)
  }
  /** Phone i's detected group's colour slot, from the latest grouping of these phones, or −1. */
  slot(i: number) {
    const a = this.analysis
    return a && a.keys.length === this.phones.length ? (a.slots[i] ?? -1) : -1
  }
  minGroupSize() {
    return Math.max(1, Math.round(this.minGroupShare * this.phones.length))
  }

  private syncPhones() {
    const phones: Phone[] = [
      ...Array.from({ length: this.crowd.n }, (_, i) => ({ key: `s${i}`, live: false, index: i })),
      ...this.liveSlots.map((slot) => ({ key: `p${slot}`, live: true, index: slot })),
    ]
    const keys = phones.map((p) => p.key)
    if (!this.layout.sync(keys)) return false
    this.phones = phones
    this.changed()
    return true
  }

  private analyseNow() {
    this.nextAnalysis = 0
  }

  private frame(now: number) {
    const dt = this.lastFrame === null ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    if (this.playing) {
      this.t += dt * this.speed
      this.crowd.generate(this.t + Crowd.AHEAD)
      this.live.record(this.t, this.liveSlots, this.liveValence)
      this.sound.tick(this.t, this.speed, this.ensemble)
    }
    if (this.t >= this.nextAnalysis) {
      this.nextAnalysis = this.t + ANALYSIS_EVERY
      this.requestAnalysis()
    }
    for (let s = 0; s < LAYOUT_STEPS; s++) this.layout.step(this.layoutSettings)
    this.view.update(this.layout.x, this.layout.y)
    if (performance.now() - this.lastSnapshotAt > SNAPSHOT_MS && this.playing) this.changed()
  }

  private requestAnalysis() {
    const phones = this.phones, n = phones.length
    if (n < 2) return
    const M = WIN * FS, n1 = Math.floor(this.t * FS), n0 = n1 - M + 1
    const signals = new Float32Array(n * M)
    for (let i = 0; i < n; i++) for (let k = 0; k < M; k++) signals[i * M + k] = this.sample(i, n0 + k)
    const keys = phones.map((p) => p.key)
    // The last grouping's, phone by phone: as a warm start if it was of these same phones, and for colours either way.
    const prev = this.analysis
    const prevOf = new Map(prev ? prev.keys.map((k, i) => [k, i]) : [])
    const same = prev !== null && prev.keys.length === n && prev.keys.every((k, i) => k === keys[i])
    const truth = Int32Array.from(phones, (_, i) => this.pattern(i))
    const refSlots = Int32Array.from(keys, (k, i) => {
      const j = prevOf.get(k)
      return j !== undefined ? prev!.slots[j] : truth[i]
    })
    const t = this.t
    this.queue.request(
      {
        signals, n, m: M, lag: Math.round(this.analysisSettings.lagTol * FS), settings: this.analysisSettings,
        prev: same ? prev!.memb : null, refSlots, truth, seed: 12345, keys,
      },
      [signals.buffer],
      (answer) => this.answered(answer, t),
    )
  }

  private answered(answer: AnalysisAnswer, t: number) {
    const keys = this.phones.map((p) => p.key)
    if (answer.keys.length !== keys.length || answer.keys.some((k, i) => k !== keys[i])) return
    this.analysis = answer
    this.layout.setSimilarity(answer.S)
    if (!Number.isNaN(answer.ari)) {
      this.ariHistory = [...this.ariHistory.slice(-239), answer.ari]
    }
    this.updateEnsemble(t)
    this.changed()
  }

  private updateEnsemble(t = this.t) {
    if (!this.analysis || this.analysis.keys.length !== this.phones.length) return
    this.ensemble.update(this.analysis.slots, this.minGroupSize(), t, this.sample)
    this.sound.updatePads(this.ensemble)
  }
}
