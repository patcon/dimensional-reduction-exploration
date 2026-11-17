/**
 * Harmony from the groups, as "Phone-flip crowd" plays it. The ensemble is the detected groups big enough to count,
 * in the order they first appeared, up to five. In chord mode each adds a sustained tone, building root → fifth →
 * third → seventh → ninth (C, C5, C, Cmaj7, Cmaj9), with a chime as it arrives. In voices mode each is an instrument
 * (bass, pluck, keys, bell, lead) playing its chord tone over a four-bar loop (Cmaj9 · Am9 · Fmaj9 · G9), on the steps
 * where its phones were seen flipping, over two bars (so a pattern two bars long is played as it was flipped). A group
 * held still, with no flips to play, holds its tone through each bar instead. A metronome clicks each step, accenting the bar.
 */

import { unlockAudio } from './audio.ts'
import { SLOT } from './crowd.ts'
import { isHeld, RHYTHM_ON, RHYTHM_STEPS, rhythmOf } from './rhythm.ts'
import { NSLOT } from './analysis.ts'

export { isHeld, RHYTHM_ON, RHYTHM_STEPS }

export type SoundMode = 'chord' | 'voices'
export const DEGREE_NAMES = ['root', 'fifth', 'third', 'seventh', 'ninth']
export const PAD_NOTE_NAMES = ['C3', 'G3', 'E4', 'B4', 'D5']
const PAD_MIDI = [48, 55, 64, 71, 74]
const PROG = [[48, 55, 52, 59, 62], [45, 52, 48, 55, 59], [41, 48, 45, 52, 55], [43, 50, 47, 53, 57]]
export const PROG_NAMES = ['Cmaj9', 'Am9', 'Fmaj9', 'G9']
export const CHORD_NAMES = ['silence', 'C (root)', 'C5 (power chord)', 'C major', 'Cmaj7', 'Cmaj9']
export const VOICE_NAMES = ['Bass', 'Pluck', 'Keys', 'Bell', 'Lead']
const VOICE_SHIFT = [-12, 12, 12, 24, 12]
/** Scheduled this far ahead, in seconds. */
const LOOKAHEAD = 0.12

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export interface EnsembleGroup {
  slot: number
  members: number[]
  /** Its place in the ensemble: which tone, or which voice. */
  voice: number
  /** Flip energy on each step of two bars (1 e & a, 1 e & a), over the window. */
  rhythm: number[]
}

/** The groups that sound, in the order they first appeared. */
export class Ensemble {
  list: EnsembleGroup[] = []
  private firstSeen = new Map<number, number>()

  clear() {
    this.firstSeen.clear()
    this.list = []
  }

  /** From the latest groups (`slots`, one per phone), at song time t; `sample(i, n)` reads phone i at sample n. */
  update(slots: Int32Array, minSize: number, t: number, sample: (i: number, n: number) => number) {
    const bySlot = new Map<number, number[]>()
    slots.forEach((s, i) => {
      if (s >= NSLOT) return
      if (!bySlot.has(s)) bySlot.set(s, [])
      bySlot.get(s)!.push(i)
    })
    const active = [...bySlot].filter(([, m]) => m.length >= minSize)
    const now = new Set(active.map(([s]) => s))
    for (const [s] of active) if (!this.firstSeen.has(s)) this.firstSeen.set(s, t)
    for (const s of [...this.firstSeen.keys()]) if (!now.has(s)) this.firstSeen.delete(s)
    this.list = active
      .sort((a, b) => this.firstSeen.get(a[0])! - this.firstSeen.get(b[0])! || a[0] - b[0])
      .slice(0, 5)
      .map(([slot, members], voice) => ({ slot, members, voice, rhythm: rhythmOf(members, t, sample) }))
  }
}

interface Pad {
  out: GainNode
  oscs: OscillatorNode[]
}

export class Sound {
  on = false
  mode: SoundMode = 'chord'
  volume = 0.7
  metronome = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: GainNode | null = null
  private pads: (Pad | null)[] = []
  /** Song time of the last music step scheduled (music steps are a step, or a fraction of one: see tick). */
  private lastMusicAt = -Infinity
  private lastClick = -1
  private playing = false

  /** Called when audio starts or stops running (a browser holds it until the page is touched). */
  onStateChange: (() => void) | null = null

  /** Whether sound is wanted but the browser is holding it, until the page is touched. */
  get blocked() {
    return (this.on || this.metronome) && this.ctx !== null && this.ctx.state !== 'running'
  }

  /**
   * From a touch or a key anywhere on the page: starts audio if sound is wanted. A browser only lets a page start audio
   * on one, so audio made earlier (sound left on from the last visit, say) waits, held, until then.
   */
  wake() {
    if (this.on || this.metronome) unlockAudio()
  }

  private ensure() {
    if (this.ctx) {
      // Held (made before the page was touched): try again, which works from a touch.
      unlockAudio()
      return this.ctx
    }
    const ctx = (this.ctx = unlockAudio())
    ctx.addEventListener('statechange', () => {
      this.setMaster()
      this.onStateChange?.()
    })
    this.master = ctx.createGain()
    this.master.gain.value = 0.0001
    this.bus = ctx.createGain()
    // A little space: a feedback delay under the dry signal.
    const dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter()
    dl.delayTime.value = 0.375; fb.gain.value = 0.28; wet.gain.value = 0.22; lp.type = 'lowpass'; lp.frequency.value = 2500
    this.bus.connect(this.master); this.bus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(this.master)
    this.master.connect(ctx.destination)
    return ctx
  }

  /** Settings from the page; call from a press, so audio can start. */
  set(opts: { on: boolean; mode: SoundMode; volume: number; metronome: boolean }, ensemble: Ensemble, t: number) {
    const restart = opts.on !== this.on || opts.mode !== this.mode
    Object.assign(this, opts)
    if (!this.on && !this.metronome && !this.ctx) return
    this.ensure()
    if (restart) {
      this.lastMusicAt = t
      this.allPadsOff()
    }
    this.updatePads(ensemble)
    this.setMaster()
  }

  setPlaying(playing: boolean, t: number) {
    if (playing === this.playing) return
    this.playing = playing
    this.lastClick = Math.floor(t / SLOT)
    this.lastMusicAt = t
    this.setMaster()
  }

  private setMaster() {
    if (!this.ctx || !this.master) return
    const target = this.on && this.playing ? 0.5 * this.volume : 0.0001, now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now)
    this.master.gain.exponentialRampToValueAtTime(Math.max(target, 0.0001), now + 0.3)
  }

  /** Chord mode: a pad per group in the ensemble. */
  updatePads(ensemble: Ensemble) {
    if (!this.ctx) return
    const want = this.on && this.mode === 'chord' ? ensemble.list.length : 0
    for (let k = 0; k < 5; k++) {
      if (k < want) this.padOn(k)
      else this.padOff(k)
    }
  }

  /**
   * Each frame: clicks and voices due within the lookahead, at song time t running `rate` times real time. The metronome
   * clicks each step, which is what people flip to. The music has steps of its own, `perStep` to a step: at half speed,
   * 2, say, so each group's rhythm and the chords go round at the pace they would at full speed while people flip at
   * half of it.
   */
  tick(t: number, rate: number, ensemble: Ensemble, perStep = 1) {
    const ctx = this.ctx
    if (!ctx || !this.playing || ctx.state !== 'running') return
    const sNext = Math.floor(t / SLOT) + 1
    const clickAhead = (sNext * SLOT - t) / rate
    if (this.metronome && sNext > this.lastClick && clickAhead < LOOKAHEAD) {
      this.lastClick = sNext
      this.click(ctx.currentTime + clickAhead, sNext % 4 === 0)
    }
    if (!this.on || this.mode !== 'voices') return
    const g = SLOT / perStep, mNext = Math.floor(t / g) + 1, at = mNext * g
    const ahead = (at - t) / rate
    if (ahead >= LOOKAHEAD || at <= this.lastMusicAt + 1e-9) return
    this.lastMusicAt = at
    const when = ctx.currentTime + ahead
    const chord = PROG[Math.floor(mNext / 4) % 4], pos = mNext % RHYTHM_STEPS
    for (const e of ensemble.list) {
      const f = mtof(chord[e.voice] + VOICE_SHIFT[e.voice])
      // No beat to follow: its tone, held through the bar, from each bar's 1.
      if (isHeld(e.rhythm)) {
        if (mNext % 4 === 0) this.held(e.voice, when, f, (4 * g) / rate)
        continue
      }
      if (e.rhythm[pos] < RHYTHM_ON) continue
      this.voice(e.voice, when, f, pos % 4 === 0 ? 1 : 0.8)
    }
  }

  private click(when: number, accent: boolean) {
    const ctx = this.ctx!
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = accent ? 1600 : 1000
    const peak = accent ? 0.6 : 0.22, len = accent ? 0.07 : 0.04
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(peak, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + len)
    o.connect(g).connect(ctx.destination)
    o.start(when)
    o.stop(when + len + 0.02)
  }

  // ── Instruments ──
  private envGain(t: number, a: number, peak: number, d: number) {
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
    g.connect(this.bus!)
    return g
  }
  private osc(type: OscillatorType, f: number, t: number, stop: number, dest: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator()
    o.type = type
    o.frequency.value = f
    o.detune.value = detune
    o.connect(dest)
    o.start(t)
    o.stop(stop)
    return o
  }
  private lowpass(freq: number, q: number, dest: AudioNode) {
    const b = this.ctx!.createBiquadFilter()
    b.type = 'lowpass'
    b.frequency.value = freq
    b.Q.value = q
    b.connect(dest)
    return b
  }
  private bell(t: number, f: number, v: number) {
    const ctx = this.ctx!
    const g = this.envGain(t, 0.004, 0.2 * v, 1.5), mod = ctx.createOscillator(), mg = ctx.createGain()
    mod.frequency.value = f * 3.5
    mg.gain.setValueAtTime(f * 2, t)
    mg.gain.exponentialRampToValueAtTime(1, t + 1.2)
    mod.connect(mg)
    const c = this.osc('sine', f, t, t + 1.6, g)
    mg.connect(c.frequency)
    mod.start(t)
    mod.stop(t + 1.6)
  }
  /**
   * Voice k's tone held for `dur` seconds, swelling in and fading out: for a group with no beat to follow. Softer than
   * its notes, as it doesn't stop, and the bass with its octave above, as its notes have.
   */
  private held(k: number, t: number, f: number, dur: number) {
    const ctx = this.ctx!, peak = [0.5, 0.1, 0.09, 0.08, 0.08][k], end = t + dur
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.15, dur / 4))
    g.gain.setValueAtTime(peak, Math.max(t + 0.15, end - 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.1)
    g.connect(this.bus!)
    const lp = this.lowpass(k === 0 ? 900 : 1600, 0.5, g)
    this.osc('triangle', f, t, end + 0.15, lp, -5)
    this.osc('triangle', f, t, end + 0.15, lp, 5)
    if (k === 0) this.osc('sine', f * 2, t, end + 0.15, this.gainInto(0.35, g))
  }
  private gainInto(level: number, dest: AudioNode) {
    const g = this.ctx!.createGain()
    g.gain.value = level
    g.connect(dest)
    return g
  }
  private voice(k: number, t: number, f: number, v: number) {
    const ctx = this.ctx!
    if (k === 0) {
      // The bass: C2 and down, below what laptop and phone speakers give much of, so a growl and its octave above
      // carry it there too, and louder than the rest.
      const g = this.envGain(t, 0.006, 0.9 * v, 0.5), lp = this.lowpass(1200, 1.2, g)
      lp.frequency.setValueAtTime(1200, t)
      lp.frequency.exponentialRampToValueAtTime(400, t + 0.3)
      this.osc('sawtooth', f, t, t + 0.6, lp)
      this.osc('sine', f, t, t + 0.6, g)
      this.osc('sine', f * 2, t, t + 0.6, this.gainInto(0.4, g))
    } else if (k === 1) {
      const g = this.envGain(t, 0.004, 0.22 * v, 0.32), lp = this.lowpass(3200, 2, g)
      lp.frequency.setValueAtTime(3200, t)
      lp.frequency.exponentialRampToValueAtTime(350, t + 0.25)
      this.osc('square', f, t, t + 0.4, lp)
    } else if (k === 2) {
      const g = this.envGain(t, 0.02, 0.16 * v, 0.7), lp = this.lowpass(1600, 0.5, g)
      this.osc('sawtooth', f, t, t + 0.8, lp, -7)
      this.osc('sawtooth', f, t, t + 0.8, lp, 7)
    } else if (k === 3) this.bell(t, f, v)
    else {
      const g = this.envGain(t, 0.05, 0.14 * v, 0.45), lfo = ctx.createOscillator(), lg = ctx.createGain()
      lfo.frequency.value = 5
      lg.gain.value = 5
      lfo.connect(lg)
      const a = this.osc('sine', f, t, t + 0.6, g), b = this.osc('triangle', f * 2, t, t + 0.6, g)
      lg.connect(a.detune)
      lg.connect(b.detune)
      lfo.start(t)
      lfo.stop(t + 0.6)
    }
  }

  private padOn(i: number) {
    if (this.pads[i]) return
    const ctx = this.ctx!
    const t = ctx.currentTime, out = ctx.createGain(), lp = this.lowpass(1100, 0.4, out), f = mtof(PAD_MIDI[i])
    out.gain.setValueAtTime(0.0001, t)
    out.gain.exponentialRampToValueAtTime(0.09, t + 1.2)
    out.connect(this.bus!)
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator()
    o1.type = o2.type = 'sawtooth'
    o3.type = 'sine'
    o1.frequency.value = o2.frequency.value = f
    o3.frequency.value = f / 2
    o1.detune.value = -6
    o2.detune.value = 6
    for (const o of [o1, o2, o3]) { o.connect(lp); o.start(t) }
    this.pads[i] = { out, oscs: [o1, o2, o3] }
    // A chime, to hear the new group arrive.
    this.bell(t, f * 2, 0.6)
  }

  private padOff(i: number) {
    const p = this.pads[i]
    if (!p) return
    this.pads[i] = null
    const t = this.ctx!.currentTime
    p.out.gain.cancelScheduledValues(t)
    p.out.gain.setValueAtTime(Math.max(p.out.gain.value, 0.0001), t)
    p.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    for (const o of p.oscs) o.stop(t + 1.6)
  }

  private allPadsOff() {
    for (let i = 0; i < this.pads.length; i++) this.padOff(i)
  }

  dispose() {
    this.allPadsOff()
    this.master?.disconnect()
  }
}
