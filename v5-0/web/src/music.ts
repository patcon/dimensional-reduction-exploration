/**
 * Music from the map: a walker steps at random through the digits' nearest neighbours and plays what it steps on.
 * Broad groups (HDBSCAN on the UMAP, or Leiden on the neighbours) set the harmony: one chord tone per group, the bass on
 * the walker's group's tone, the chord richer the more groups there are. Small groups (Leiden at a high resolution on
 * the same neighbours) set the melody: each is given a note of the chord, so the tune changes as the walker crosses
 * from one to the next. After "Density clusters on deskewed digits", by way of v4.1.
 */

import type { MapMusic } from './analysis.ts'
import { runningAudio, unlockAudio } from './audio.ts'
import type { Settings } from './settings.ts'

/** The mix and the walk's time, of the settings. */
type MusicSettings = Pick<Settings, 'chord' | 'bass' | 'melody' | 'stepsPerSecond' | 'swing'>

// ── Harmony ──

/** The chord's tones above the root, in semitones, added one per broad group: root, fifth, third, seventh, ninth… */
export const CHORD_TONES = [0, 7, 16, 22, 26, 30, 33, 25, 27, 32, 35, 29]
export const TONE_NAMES = ['R', '5', '3', '♭7', '9', '♯11', '13', '♭9', '♯9', '♭13', '7', '11']
/** What the chord is, for as many broad groups (1 to 12). */
export const CHORD_NAMES = [
  'a single tone (unison)',
  'an open fifth',
  'a major triad',
  'a dominant seventh',
  'a dominant ninth',
  'a ninth with a sharp eleventh',
  'a thirteenth chord',
  'an altered thirteenth (adds ♭9)',
  'an altered thirteenth (♭9, ♯9)',
  'an altered thirteenth (♭9, ♯9, ♭13)',
  'a dense cluster (adds the major seventh)',
  'a dense cluster (every tension)',
]
/** D2, in Hz. */
const ROOT = 73.42
/** Seconds the chord's tones swell over: the nth swells n times in it, against each other. */
export const BAR = 4

/** Tones in the chord for `groups` broad groups. */
export const chordSize = (groups: number) => Math.max(1, Math.min(groups, CHORD_TONES.length))

/** A small group's note, in semitones above the root: a tone of the chord (by pitch class), in one of two octaves. */
function melodyNote(fine: number, groups: number) {
  const classes = [...new Set(CHORD_TONES.slice(0, chordSize(groups)).map((s) => s % 12))].sort((a, b) => a - b)
  const h = Math.imul(fine + 1, 2654435761) >>> 0
  return classes[h % classes.length] + 12 * (Math.floor(h / classes.length) % 2)
}

/** A short reverb's impulse: noise, dying away. */
function impulse(ctx: AudioContext) {
  const length = ctx.sampleRate * 2.6
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
  }
  return buffer
}

interface PadVoice {
  level: GainNode
  out: GainNode
  sources: AudioScheduledSourceNode[]
}

/** The synth: a pad holding the chord, a plucked bass and a struck melody, through a compressor and a little reverb. */
class Synth {
  private master: GainNode
  private padBus: GainNode
  private bassBus: GainNode
  private melodyBus: GainNode
  private wet: GainNode
  private pad: PadVoice[] = []
  private bass: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode }
  /** Broad groups the pad's chord is for, or 0 for none yet. */
  groups = 0
  readonly ctx: AudioContext

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.ratio.value = 5
    compressor.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(compressor)
    const reverb = ctx.createConvolver()
    reverb.buffer = impulse(ctx)
    reverb.connect(this.master)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0
    this.wet.connect(reverb)
    this.padBus = ctx.createGain()
    this.bassBus = ctx.createGain()
    this.melodyBus = ctx.createGain()
    for (const bus of [this.padBus, this.bassBus, this.melodyBus]) bus.connect(this.master)
    this.padBus.connect(this.wet)
    this.melodyBus.connect(this.wet)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = ROOT
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 500
    filter.Q.value = 2
    const gain = ctx.createGain()
    gain.gain.value = 0
    osc.connect(filter).connect(gain).connect(this.bassBus)
    osc.start()
    this.bass = { osc, filter, gain }
  }

  mix({ chord, bass, melody }: MusicSettings) {
    const t = this.ctx.currentTime
    this.padBus.gain.setTargetAtTime(chord, t, 0.05)
    this.bassBus.gain.setTargetAtTime(bass * 0.9, t, 0.05)
    this.melodyBus.gain.setTargetAtTime(melody, t, 0.05)
  }

  /**
   * The pad's chord for `groups` broad groups, crossfading from the last; with `announce`, the new chord is
   * arpeggiated over it, so a change in how many groups there are is heard.
   */
  setChord(groups: number, announce: boolean) {
    const t = this.ctx.currentTime
    const fade = this.groups ? 1.4 : 0.3
    this.fadePad(fade)
    this.groups = groups
    const tones = chordSize(groups)
    const type: OscillatorType = tones === 1 ? 'sine' : tones === 2 ? 'triangle' : 'sawtooth'
    const spread = tones === 1 ? 0 : 1.5 * (tones - 1)
    const cutoff = tones === 1 ? 4000 : tones === 2 ? 2200 : 500 + 180 * tones
    for (let i = 0; i < tones; i++) {
      const ctx = this.ctx
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = cutoff
      lowpass.Q.value = 0.8
      const level = ctx.createGain()
      level.gain.value = 0
      // Each tone swells (i + 1) times a bar.
      const depth = tones === 1 ? 0.6 : 0.75
      const pulse = ctx.createGain()
      pulse.gain.value = 1 - depth / 2
      const lfo = ctx.createOscillator()
      lfo.frequency.value = (i + 1) / BAR
      const lfoDepth = ctx.createGain()
      lfoDepth.gain.value = depth / 2
      lfo.connect(lfoDepth).connect(pulse.gain)
      const sources: AudioScheduledSourceNode[] = [lfo]
      const detunes = tones === 1 ? [0] : tones < 6 ? [-spread, spread] : [-spread, 0, spread]
      for (const detune of detunes) {
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.value = ROOT * 2 * Math.pow(2, CHORD_TONES[i] / 12)
        osc.detune.value = detune
        osc.connect(lowpass)
        sources.push(osc)
      }
      lowpass.connect(level).connect(pulse)
      const out = ctx.createGain()
      out.gain.value = 0
      // Spread left to right.
      if (tones > 1) {
        const pan = ctx.createStereoPanner()
        pan.pan.value = -0.85 + (1.7 * i) / (tones - 1)
        pulse.connect(pan).connect(out)
      } else pulse.connect(out)
      out.connect(this.padBus)
      for (const s of sources) s.start(t)
      out.gain.setTargetAtTime(1, t + (announce ? 0.15 : 0), fade / 3)
      this.pad.push({ level, out, sources })
    }
    this.wet.gain.setTargetAtTime(tones === 1 ? 0 : 0.12 + 0.05 * tones, t, 0.5)
    if (announce) for (let i = 0; i < tones; i++) this.strike(t + 0.12 + i * 0.11, ROOT * 4 * Math.pow(2, CHORD_TONES[i] / 12), 0.16, 1.4, tones > 1 ? -0.85 + (1.7 * i) / (tones - 1) : 0)
  }

  private fadePad(fade: number) {
    const t = this.ctx.currentTime
    for (const v of this.pad) {
      v.out.gain.setTargetAtTime(0, t, fade / 3)
      for (const s of v.sources) s.stop(t + fade * 3)
    }
    this.pad = []
  }

  /** The pad's loudness: the walker's group's tone louder than the rest; silent while not `sounding`. */
  padLevels(group: number, sounding: boolean, quick = false) {
    const t = this.ctx.currentTime
    const tones = this.pad.length
    const base = 0.22 / Math.sqrt(tones || 1)
    this.pad.forEach((v, i) => v.level.gain.setTargetAtTime(sounding ? base * (tones > 1 && i === group % CHORD_TONES.length ? 2 : 1) : 0, t, quick ? 0.6 : 0.35))
  }

  /** Plucks the bass on a broad group's tone; noise (−1) leaves only a murmur. */
  bassTo(group: number, t: number) {
    const { osc, filter, gain } = this.bass
    gain.gain.cancelScheduledValues(t)
    if (group < 0) {
      gain.gain.setTargetAtTime(0.03, t, 0.15)
      return
    }
    osc.frequency.setTargetAtTime(ROOT * Math.pow(2, (CHORD_TONES[group % CHORD_TONES.length] % 12) / 12), t, 0.03)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(0.34, t + 0.012)
    gain.gain.setTargetAtTime(this.groups === 1 ? 0.1 : 0.16, t + 0.02, 0.25)
    filter.frequency.cancelScheduledValues(t)
    filter.frequency.setValueAtTime(this.groups === 1 ? 700 : 1400, t)
    filter.frequency.setTargetAtTime(this.groups === 1 ? 300 : 420, t + 0.01, 0.15)
  }

  bassOff() {
    const t = this.ctx.currentTime
    this.bass.gain.gain.cancelScheduledValues(t)
    this.bass.gain.gain.setTargetAtTime(0, t, 0.2)
  }

  /** A struck, bell-like note: a fundamental and two quicker partials. */
  strike(t: number, hz: number, gain: number, seconds: number, pan: number) {
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, pan))
    panner.connect(this.melodyBus)
    for (const [mult, amp, length] of [[1, 1, seconds], [4, 0.18, seconds * 0.35], [2.76, 0.08, seconds * 0.25]]) {
      const osc = this.ctx.createOscillator()
      osc.frequency.value = hz * mult
      const env = this.ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(gain * amp, t + 0.004)
      env.gain.exponentialRampToValueAtTime(0.0001, t + length)
      osc.connect(env).connect(panner)
      osc.start(t)
      osc.stop(t + length + 0.02)
    }
  }

  /** A metronome's click: a burst of filtered noise, brighter and louder on the first beat of a bar of 8, and on the beat. */
  click(beat: number) {
    const ctx = this.ctx
    const t = ctx.currentTime + 0.01
    const length = Math.floor(ctx.sampleRate * 0.03)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const bar = beat % 8 === 0
    const on = beat % 2 === 0
    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = bar ? 2600 : on ? 1800 : 1200
    bandpass.Q.value = 4
    const gain = ctx.createGain()
    gain.gain.value = bar ? 0.9 : on ? 0.55 : 0.28
    source.connect(bandpass).connect(gain).connect(this.master)
    source.start(t)
  }

  /** Fades everything out, for music turned off, or no groups to play; the next chord starts afresh. */
  silence() {
    this.fadePad(0.6)
    this.bassOff()
    this.wet.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
    this.groups = 0
  }
}

// ── The walk ──

/** How often a walk waiting (for sound to start, or the groups) looks again, in ms. */
const WAIT_MS = 150
/** Steps of the walk's trail kept, for the map to draw. */
const TRAIL = 70

export interface WalkSnapshot {
  music: MapMusic | null
  playing: boolean
  /** The digit the walker is on, as an index into music.rows, or null before it has started. */
  node: number | null
  /** Its small group's note, as a chord tone's index, or −1; changes with each step. */
  tone: number
  /** Steps in the walker's small group so far. */
  dwell: number
  steps: number
}

/**
 * The walker and what it plays. Its state changes many times a second, so the map reads it as it draws; the tabs
 * re-render from `snapshot`.
 */
export class MusicWalk {
  node: number | null = null
  /** Where it's been, newest last, as rows of the data (so it carries over when the digits on the map change). */
  trail: number[] = []
  /** When it last struck a melody note (performance.now()), and which chord tone. */
  struck = { at: -Infinity, tone: -1 }
  /** When the pad's chord started, on the audio clock, as its tones swell from then. */
  chordStart = 0
  music: MapMusic | null = null
  playing = false
  private synth: Synth | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private settings: MusicSettings
  private pan: (row: number) => number = () => 0
  private lastBroad = -2
  private lastFine = -1
  private beat = 0
  private tone = -1
  private dwell = 0
  private listeners = new Set<() => void>()
  snapshot: WalkSnapshot = { music: null, playing: false, node: null, tone: -1, dwell: 0, steps: 0 }

  constructor(settings: MusicSettings) {
    this.settings = settings
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  private changed() {
    this.snapshot = { music: this.music, playing: this.playing, node: this.node, tone: this.tone, dwell: this.dwell, steps: this.snapshot.steps + 1 }
    this.listeners.forEach((fn) => fn())
  }

  /** The synth, once a press has started the page's audio (browsers only let sound start from one). */
  private get ready() {
    const ctx = runningAudio()
    if (!ctx) return null
    if (this.synth?.ctx !== ctx) this.synth = new Synth(ctx)
    return this.synth
  }

  /** The mix and the walk's time; and where in the stereo field each row of the data sits. */
  setSettings(settings: MusicSettings, pan: (row: number) => number) {
    this.settings = settings
    this.pan = pan
    this.ready?.mix(settings)
  }

  /** The pad's chord, for however many broad groups there are now. */
  private refreshChord() {
    const synth = this.ready
    const m = this.music
    if (!synth || !m || !this.playing) return
    // No groups: the walk keeps time with a metronome instead (see step).
    if (m.broadCount === 0) synth.silence()
    else if (synth.groups !== m.broadCount) {
      synth.setChord(m.broadCount, synth.groups > 0)
      this.chordStart = synth.ctx.currentTime
      this.lastBroad = -2
      synth.padLevels(this.node === null ? -1 : m.broad[this.node], true, true)
    }
  }

  /**
   * Takes in the map's groups, carrying the walker over to the same digit if it's still on the map, or else the
   * nearest that is (by `distance` between rows of the data).
   */
  setMusic(next: MapMusic, distance: (a: number, b: number) => number) {
    const previous = this.music
    if (previous && previous.rows !== next.rows && this.node !== null) {
      const row = previous.rows[this.node]
      const at = next.rows.indexOf(row)
      if (at >= 0) this.node = at
      else if (next.rows.length) {
        let best = Infinity
        next.rows.forEach((r, i) => {
          const d = distance(row, r)
          if (d < best) [best, this.node] = [d, i]
        })
      } else this.node = null
      const on = new Set(next.rows)
      this.trail = this.trail.filter((r) => on.has(r))
      if (this.node !== null && this.trail.at(-1) !== next.rows[this.node]) this.trail = [next.rows[this.node]]
    }
    if (this.node !== null && this.node >= next.rows.length) this.node = null
    this.music = next
    this.refreshChord()
    this.changed()
  }

  /** Moves the walker to digit i (a tap on the map, say), starting afresh from there. */
  moveTo(i: number) {
    if (!this.music || i >= this.music.rows.length) return
    this.node = i
    this.trail = [this.music.rows[i]]
    this.lastFine = -1
    this.lastBroad = -2
    this.changed()
  }

  /** Moves the walker to digit i and plays from there: Random point and Other group. */
  jumpTo(i: number) {
    this.moveTo(i)
    if (!this.playing) this.setPlaying(true)
  }

  /** Jumps to a digit anywhere, at random. */
  jumpAnywhere() {
    const n = this.music?.rows.length ?? 0
    if (n) this.jumpTo(Math.floor(Math.random() * n))
  }

  /** Jumps to a digit in another broad group, at random. */
  jumpGroup() {
    const m = this.music
    if (!m || !m.rows.length) return
    const here = this.node === null ? -2 : m.broad[this.node]
    const elsewhere = [...m.broad.keys()].filter((i) => m.broad[i] >= 0 && m.broad[i] !== here)
    const pool = elsewhere.length ? elsewhere : [...m.broad.keys()]
    this.jumpTo(pool[Math.floor(Math.random() * pool.length)])
  }

  /** Starts or stops the walk; call it from a press, so sound can start. */
  setPlaying(playing: boolean) {
    if (playing === this.playing) return
    this.playing = playing
    clearTimeout(this.timer)
    if (playing) {
      unlockAudio()
      this.lastBroad = -2
      const tick = () => {
        this.timer = setTimeout(tick, this.step())
      }
      tick()
    } else this.silence()
    this.changed()
  }

  /**
   * One step: to a neighbour, at random by how strongly they're linked, playing its small group's note (louder on a
   * new one, or on the beat) over the pad, and the bass when it crosses into another broad group. With no groups (no
   * digits, or every one left as noise), there's nothing to harmonise, so it clicks as a metronome would, in the walk's
   * time. Returns how long until the next step, in ms.
   */
  private step() {
    const synth = this.ready
    const m = this.music
    if (synth) synth.mix(this.settings)
    if (!synth || !m) return WAIT_MS
    if (m.broadCount === 0) {
      synth.silence()
      synth.click(this.beat)
      this.tone = -1
      this.changed()
      return this.nextStep()
    }
    if (synth.groups !== m.broadCount) this.refreshChord()
    let v = this.node ?? Math.floor(Math.random() * m.rows.length)
    if (this.node !== null) {
      const { offsets, nbrs, weights } = m.graph
      let total = 0
      for (let e = offsets[v]; e < offsets[v + 1]; e++) total += weights[e]
      let r = Math.random() * total
      for (let e = offsets[v]; e < offsets[v + 1]; e++) {
        r -= weights[e]
        if (r <= 0) {
          v = nbrs[e]
          break
        }
      }
    }
    this.node = v
    this.trail.push(m.rows[v])
    if (this.trail.length > TRAIL) this.trail.shift()
    const t = synth.ctx.currentTime + 0.02
    const broad = m.broad[v]
    const fine = m.fine[v]
    if (broad !== this.lastBroad) {
      synth.bassTo(broad, t)
      synth.padLevels(broad, true)
      this.lastBroad = broad
    }
    const fresh = fine !== this.lastFine
    this.dwell = fresh ? 1 : this.dwell + 1
    this.lastFine = fine
    const semitones = melodyNote(fine, m.broadCount)
    const strong = this.beat % 2 === 0
    const quiet = broad < 0 ? 0.45 : 1
    synth.strike(t, ROOT * 8 * Math.pow(2, semitones / 12), quiet * (fresh ? 0.2 : strong ? 0.09 : 0.05), fresh ? 0.9 : 0.45, m.broadCount === 1 ? 0 : this.pan(m.rows[v]))
    this.tone = CHORD_TONES.slice(0, chordSize(m.broadCount)).findIndex((s) => s % 12 === semitones % 12)
    this.struck = { at: performance.now(), tone: this.tone }
    this.changed()
    return this.nextStep()
  }

  /** The time till the next step, in ms, swung long-short. */
  private nextStep() {
    this.beat++
    const swing = this.settings.swing ? (this.beat % 2 ? 1.34 : 0.66) : 1
    return (1000 / this.settings.stepsPerSecond) * swing
  }

  /** Paused: everything fades out, and the walker stays where it is. */
  private silence() {
    this.synth?.silence()
    this.lastBroad = -2
  }

  /** For good, as the page goes. */
  dispose() {
    clearTimeout(this.timer)
    this.silence()
  }
}
