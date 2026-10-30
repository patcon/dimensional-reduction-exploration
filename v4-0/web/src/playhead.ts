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
  /** Times playback has looped back to the start, so `elapsed` keeps counting through the loop. */
  laps = 0
  /**
   * A window of moments playback is pinned to, looping round inside it, or null. Trails
   * wrap round inside it too, and the clustering window holds still on it. `releasing`, playback carries on to the
   * window's end once more and breaks through it, unpinning.
   */
  pin: { from: number; to: number; releasing: boolean } | null = null
  /** While pinned: loops round the window so far, and what `elapsed` was at its start, to count on from. */
  private pinLaps = 0
  private pinBase = 0
  /** Added to `elapsed` once unpinned, so it carries on from where the pinned count left it. */
  private elapsedOffset = 0
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
    if (this.pin) return this.pinBase + (this.moment - this.pin.from) + this.pinLaps * (this.pin.to - this.pin.from)
    return this.moment + this.laps * (this.length - 1) + this.elapsedOffset
  }

  /**
   * Whether trails reach back round: from the start to the end, once playback has actually looped; or
   * from the pinned window's start to its end.
   */
  get wraps() {
    return this.pin !== null || this.laps > 0
  }

  /** Where moment `t` (as a trail reaches back to it) falls: wrapped round the pinned window, or round the whole as `wraps` says. */
  wrapMoment(t: number) {
    const [from, to] = this.pin ? [this.pin.from, this.pin.to] : this.wraps ? [0, this.length - 1] : [-Infinity, Infinity]
    if (t >= from && t <= to) return t
    if (!Number.isFinite(from)) return t
    const span = to - from
    return from + ((((t - from) % span) + span) % span)
  }

  /**
   * Pins playback to the clustering window as it is now (see `pin`), or holds on to the window it's releasing; or,
   * with null, releases it. Too short a window won't pin.
   */
  setPin(windowPixels: number | null) {
    if (windowPixels === null) {
      if (!this.pin) return
      this.pin = { ...this.pin, releasing: true }
    } else if (this.pin) {
      this.pin = { ...this.pin, releasing: false }
    } else {
      const from = Math.max(0, this.moment - windowPixels)
      if (this.moment - from < 2) return
      this.pinBase = this.elapsed - (this.moment - from)
      this.pinLaps = 0
      this.pin = { from, to: this.moment, releasing: false }
    }
    this.changed()
    this.frame()
  }

  /** Unpins at once, with `elapsed` carrying on from where it was. */
  private unpin() {
    const elapsed = this.elapsed
    this.pin = null
    this.elapsedOffset += elapsed - this.elapsed
    this.changed()
  }

  /**
   * The moments a window `windowPixels` long covers now, as [from, to] ranges: one, or two once
   * playback has looped and the window reaches back past the start round to the end.
   */
  windowRanges(windowPixels: number): [number, number][] {
    if (this.pin) return [[this.pin.from, this.pin.to]]
    const from = this.moment - windowPixels
    if (from >= 0 || !this.wraps) return [[Math.max(0, from), this.moment]]
    return [[0, this.moment], [Math.max(this.moment, from + this.length - 1), this.length - 1]]
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
    // One listener failing (say, a view caught mid-unmount) mustn't stop the others, or the frame loop.
    this.frameListeners.forEach((fn) => {
      try {
        fn()
      } catch (e) {
        reportError(e)
      }
    })
  }

  setLength(length: number) {
    this.length = Math.max(1, length)
    this.moment = Math.min(this.moment, this.length - 1)
    this.changed()
    this.frame()
  }

  /** Moves to `moment`; outside the pinned window, unpinning. */
  seek(moment: number) {
    this.moment = Math.max(0, Math.min(this.length - 1, moment))
    if (this.pin && (this.moment < this.pin.from || this.moment > this.pin.to)) this.unpin()
    this.frame()
  }

  setPlaying(playing: boolean) {
    // Playing from the very end starts over.
    if (playing && !this.pin && this.moment >= this.length - 1) this.moment = 0
    this.playing = playing
    this.changed()
  }

  setSpeed(speed: number) {
    this.speed = speed
    this.changed()
  }

  tick(seconds: number) {
    if (!this.playing) return
    this.moment += this.speed * seconds
    if (this.pin) {
      const { from, to } = this.pin
      if (this.moment > to && this.pin.releasing) this.unpin()
      else if (this.moment > to) {
        this.pinLaps += Math.floor((this.moment - from) / (to - from))
        this.moment = from + ((this.moment - from) % (to - from))
      }
    } else if (this.moment >= this.length - 1) {
      // Playback always loops.
      this.moment %= this.length - 1
      this.laps++
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
      // The next frame first, so nothing thrown below can stop playback.
      id = requestAnimationFrame(step)
      // Cap the step so a backgrounded tab doesn't jump ahead on return.
      playhead.tick(Math.min(0.1, (now - last) / 1000))
      last = now
    })
    return () => cancelAnimationFrame(id)
  }, [playhead])
  useSyncExternalStore(playhead.subscribe, playhead.getVersion)
  return playhead
}
