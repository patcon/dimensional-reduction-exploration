import { useEffect } from 'react'
import type { Playhead } from './playhead'
import type { Traces } from './signal'

/** A click: a square wave's blip, dying away fast. The digit's first line is higher, as a metronome's downbeat. */
const CLICK_HZ = 1400
const FIRST_LINE_HZ = 2400
const CLICK_SECONDS = 0.035
const CLICK_GAIN = 0.2

/**
 * Browsers only let a page make sound once someone has interacted with it, so the audio starts on the first press or
 * key anywhere (pressing play, say), and is made then.
 */
let audio: AudioContext | null = null
function unlockAudio() {
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

function click(hz: number) {
  if (!audio || audio.state !== 'running') return
  const t = audio.currentTime
  const osc = audio.createOscillator()
  osc.type = 'square'
  osc.frequency.value = hz
  const gain = audio.createGain()
  gain.gain.setValueAtTime(CLICK_GAIN, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + CLICK_SECONDS)
  osc.connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + CLICK_SECONDS)
}

/**
 * While `on`, clicks as playback reaches the start of each line of the reading (see `Traces.lineStart`), so it's
 * obvious, from across a room, when a new row starts. Only while playing forward: a seek or scrub stays quiet, and a
 * loop back round clicks for the start it lands on.
 */
export function useLineClicks(playhead: Playhead, traces: Traces, on: boolean) {
  useEffect(() => {
    if (!on) return
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    let last = Math.round(playhead.moment)
    const off = playhead.onFrame(() => {
      const now = Math.round(playhead.moment)
      const was = last
      last = now
      if (!playhead.playing || now === was) return
      // Looping (round the end, or a pinned window), from where it loops back to.
      const from = now < was ? Math.round(playhead.pin?.from ?? 0) : was + 1
      // A jump (a seek while playing) isn't a line read.
      if (now - from > traces.length / 4) return
      let first = false
      let any = false
      for (let t = from; t <= now; t++) {
        if (!traces.lineStart[t]) continue
        any = true
        if (t === 0) first = true
      }
      if (any) click(first ? FIRST_LINE_HZ : CLICK_HZ)
    })
    return () => {
      off()
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [playhead, traces, on])
}
