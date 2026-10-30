import { useEffect } from 'react'
import type { Playhead } from './playhead'

/** A beep, dying away fast: higher on an accented beat (the downbeat) than on the rest. */
const ACCENT_HZ = 880
const BEAT_HZ = 440
const BEEP_SECONDS = 0.06
const BEEP_GAIN = 0.3

/** Beat patterns, a bar's beats in order: 2 is accented, 1 not. */
export const BEAT_PATTERNS = {
  '2111': [2, 1, 1, 1],
  '211': [2, 1, 1],
  '21': [2, 1],
  '1': [1],
} as const
export type BeatPattern = keyof typeof BEAT_PATTERNS
export const BEAT_PATTERN_LABELS: Record<BeatPattern, string> = { '2111': '4', '211': '3', '21': '2', '1': '1' }

/**
 * Browsers only let a page make sound once someone has interacted with it, so the audio starts on the first press or
 * key anywhere (pressing play, say), and is made then.
 */
let audio: AudioContext | null = null
function unlockAudio() {
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

function beep(hz: number) {
  if (!audio || audio.state !== 'running') return
  const t = audio.currentTime
  const osc = audio.createOscillator()
  osc.frequency.value = hz
  const gain = audio.createGain()
  gain.gain.setValueAtTime(BEEP_GAIN, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + BEEP_SECONDS)
  osc.connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + BEEP_SECONDS)
}

/**
 * While `on`, beeps as playback reaches each beat: every `beatPixels` moments from the start of the reading, so a bar
 * starts again at its start, and each beat accented or not by `pattern`. Only while playing forward: a seek or scrub
 * stays quiet, and a loop back round beeps for the beat it lands on.
 */
export function useMetronome(playhead: Playhead, length: number, on: boolean, beatPixels: number, pattern: BeatPattern) {
  useEffect(() => {
    if (!on) return
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    const beats = BEAT_PATTERNS[pattern]
    let last = Math.round(playhead.moment)
    const off = playhead.onFrame(() => {
      const now = Math.round(playhead.moment)
      const was = last
      last = now
      if (!playhead.playing || now === was) return
      // Looping (round the end, or a pinned window), from where it loops back to.
      const from = now < was ? Math.round(playhead.pin?.from ?? 0) : was + 1
      // A jump (a seek while playing) isn't a beat played.
      if (now - from > length / 4) return
      // The strongest beat passed since the last frame.
      let strongest = 0
      for (let t = Math.ceil(from / beatPixels) * beatPixels; t <= now; t += beatPixels) strongest = Math.max(strongest, beats[(t / beatPixels) % beats.length])
      if (strongest) beep(strongest > 1 ? ACCENT_HZ : BEAT_HZ)
    })
    return () => {
      off()
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [playhead, length, on, beatPixels, pattern])
}
