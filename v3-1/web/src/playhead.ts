import { useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * Where playback is, in moments (one per pixel read), shared by every view. It moves on every
 * animation frame, so views read it in their own frame loops (or on `onFrame`) rather than
 * through React state; only play/pause and length changes re-render.
 */
export class Playhead {
  moment = 0
  length = 1
  playing = false
  /** Pixels per second. */
  speed = 14
  loop = true
  /** Times playback has looped back to the start, so `elapsed` keeps counting through the loop. */
  laps = 0
  private frameListeners = new Set<() => void>()
  private stateListeners = new Set<() => void>()
  private version = 0

  onFrame(fn: () => void) {
    this.frameListeners.add(fn)
    return () => void this.frameListeners.delete(fn)
  }

  subscribe = (fn: () => void) => {
    this.stateListeners.add(fn)
    return () => void this.stateListeners.delete(fn)
  }

  getVersion = () => this.version

  private changed() {
    this.version++
    this.stateListeners.forEach((fn) => fn())
  }

  /** Moments played through, counting each lap whole: unlike `moment`, it doesn't jump back when playback loops. */
  get elapsed() {
    return this.moment + this.laps * (this.length - 1)
  }

  /** Whether trails reach back round from the start to the end: looping, once playback has actually looped. */
  get wraps() {
    return this.loop && this.laps > 0
  }

  /** Back to the start, as if never played: trails stop at the start again until the next loop. */
  restart() {
    this.resetLaps()
    this.seek(0)
  }

  /** Forget past loops, as when the traces change: their end hasn't been played yet. */
  resetLaps() {
    this.laps = 0
    this.frame()
  }

  frame() {
    this.frameListeners.forEach((fn) => fn())
  }

  setLength(length: number) {
    this.length = Math.max(1, length)
    this.moment = Math.min(this.moment, this.length - 1)
    this.changed()
    this.frame()
  }

  seek(moment: number) {
    this.moment = Math.max(0, Math.min(this.length - 1, moment))
    this.frame()
  }

  setPlaying(playing: boolean) {
    // Playing from the very end starts over.
    if (playing && this.moment >= this.length - 1) this.moment = 0
    this.playing = playing
    this.changed()
  }

  setSpeed(speed: number) {
    this.speed = speed
    this.changed()
  }

  setLoop(loop: boolean) {
    this.loop = loop
    this.changed()
  }

  tick(seconds: number) {
    if (!this.playing) return
    this.moment += this.speed * seconds
    if (this.moment >= this.length - 1) {
      if (this.loop) {
        this.moment %= this.length - 1
        this.laps++
      }
      else {
        this.moment = this.length - 1
        this.setPlaying(false)
      }
    }
    this.frame()
  }
}

/** One playhead for the app, ticked every animation frame. */
export function usePlayhead() {
  const playhead = useMemo(() => new Playhead(), [])
  useEffect(() => {
    let last = performance.now()
    let id = requestAnimationFrame(function step(now) {
      // Cap the step so a backgrounded tab doesn't jump ahead on return.
      playhead.tick(Math.min(0.1, (now - last) / 1000))
      last = now
      id = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(id)
  }, [playhead])
  useSyncExternalStore(playhead.subscribe, playhead.getVersion)
  return playhead
}
