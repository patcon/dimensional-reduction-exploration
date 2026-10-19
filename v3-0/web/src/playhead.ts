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
  speed = 8
  loop = true
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
      if (this.loop) this.moment %= this.length - 1
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
