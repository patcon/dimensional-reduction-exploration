/** A press that moves further than this, in pixels, is a drag (orbiting or panning), not a click. */
export const CLICK_SLOP = 5
/** How near and far the camera can zoom, relative to where the view puts it. */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5
/** Radians turned per pixel dragged. */
const TURN = 0.009
/** How long one finger rests (within CLICK_SLOP) before it's held, rather than tapping or dragging. */
const HOLD_MS = 350

/** What dragging does: turn the camera around what it looks at, or slide the view sideways. */
export type DragMode = 'orbit' | 'pan'

/** The camera's offsets from where the view puts it. */
export interface Offsets {
  dTheta: number
  dPhi: number
  dRadius: number
  dPanX: number
  dPanY: number
}

export interface OrbitOptions {
  /** What dragging does now, if anything. */
  dragMode: () => DragMode | null
  /** Whether the wheel zooms now. */
  canZoom: () => boolean
  /** The camera's distance before zooming, which zoom limits are measured against. */
  baseRadius: () => number
  /** World units per pixel dragged, when panning. */
  panScale: () => number
  /** How far above the canvas's middle the view's middle is, in pixels (the lens shifted to clear something covering the canvas). */
  middleRaised: () => number
  /** A one-finger tap that didn't move, at these client coordinates (dragging cancels its click). */
  onTap: (clientX: number, clientY: number) => void
  onOrbiting: (orbiting: boolean) => void
  /** One finger held still, at these client coordinates; then where it moves to, and null once it lifts. */
  onHold: (at: { x: number; y: number } | null) => void
}

/**
 * Drag to turn or pan the camera, wheel or pinch to zoom, and move two fingers to pan, as offsets from where the view puts it:
 * `dTheta` and `dPhi` (radians), `dPanX` and `dPanY` (world units, across the screen), and `dRadius`. One finger held
 * still is passed to `onHold` instead.
 */
export class Orbit {
  dTheta = 0
  dPhi = 0
  dPanX = 0
  dPanY = 0
  dRadius = 0
  dragging = false
  private readonly canvas: HTMLCanvasElement
  private readonly opts: OrbitOptions
  private mode: DragMode = 'orbit'
  private dragLast = { x: 0, y: 0 }
  private base = { dTheta: 0, dPhi: 0, dPanX: 0, dPanY: 0 }
  private lastTouchDist = 0
  private lastTouchMid = { x: 0, y: 0 }
  /** Whether this touch is still one finger that could be a tap. */
  private tapping = false
  /** Whether one finger is held (see HOLD_MS), and the timer until it will be. */
  private holding = false
  private holdTimer: ReturnType<typeof setTimeout> | undefined
  private pressAt = { x: 0, y: 0 }

  constructor(canvas: HTMLCanvasElement, opts: OrbitOptions) {
    this.canvas = canvas
    this.opts = opts
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    canvas.addEventListener('touchend', this.onTouchEnd)
    canvas.addEventListener('touchcancel', this.onTouchCancel)
  }

  /** The offsets now, with turns round the scene taken as the shortest way back. */
  offsets(): Offsets {
    const dTheta = this.dTheta - 2 * Math.PI * Math.round(this.dTheta / (2 * Math.PI))
    return { dTheta, dPhi: this.dPhi, dRadius: this.dRadius, dPanX: this.dPanX, dPanY: this.dPanY }
  }

  /** Sets the offsets to `o`, scaled by `k`: easing them back to none, say. */
  setOffsets(o: Offsets, k: number) {
    this.dTheta = o.dTheta * k
    this.dPhi = o.dPhi * k
    this.dRadius = o.dRadius * k
    this.dPanX = o.dPanX * k
    this.dPanY = o.dPanY * k
  }

  dispose() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this.onTouchCancel)
    clearTimeout(this.holdTimer)
  }

  private startDrag(mode: DragMode, x: number, y: number) {
    this.mode = mode
    this.dragging = true
    this.dragLast = { x, y }
    this.base = { dTheta: this.dTheta, dPhi: this.dPhi, dPanX: this.dPanX, dPanY: this.dPanY }
  }

  private drag(x: number, y: number) {
    const dx = x - this.dragLast.x, dy = y - this.dragLast.y
    if (this.mode === 'orbit') {
      this.dTheta = this.base.dTheta - dx * TURN
      this.dPhi = this.base.dPhi + dy * TURN
    } else {
      // The scene follows the pointer.
      const s = this.opts.panScale()
      this.dPanX = this.base.dPanX - dx * s
      this.dPanY = this.base.dPanY + dy * s
    }
  }

  /**
   * Zooms to `radius`, kept within the limits around the view's own distance. While dragging pans,
   * the point under (clientX, clientY) stays put; otherwise zoom is about the middle of the view.
   */
  private zoomTo(radius: number, clientX: number, clientY: number) {
    const base = this.opts.baseRadius(), before = base + this.dRadius
    const after = Math.max(base * MIN_ZOOM, Math.min(base * MAX_ZOOM, radius))
    if (this.opts.dragMode() === 'pan') {
      // That point is this far from the middle, in world units; the view shrinks around the middle by
      // after / before, so panning makes up the rest.
      const rect = this.canvas.getBoundingClientRect(), s = this.opts.panScale(), k = 1 - after / before
      this.dPanX += (clientX - rect.left - rect.width / 2) * s * k
      this.dPanY -= (clientY - rect.top - (rect.height / 2 - this.opts.middleRaised())) * s * k
    }
    this.dRadius = after - base
  }

  private endHold() {
    clearTimeout(this.holdTimer)
    if (!this.holding) return
    this.holding = false
    this.opts.onHold(null)
  }

  private onMouseDown = (e: MouseEvent) => {
    const mode = this.opts.dragMode()
    if (!mode) return
    this.startDrag(mode, e.clientX, e.clientY)
    this.opts.onOrbiting(true)
    e.preventDefault()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.dragging) this.drag(e.clientX, e.clientY)
  }

  private onMouseUp = () => {
    this.dragging = false
    this.opts.onOrbiting(false)
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.opts.canZoom()) return
    this.zoomTo(this.opts.baseRadius() + this.dRadius + e.deltaY * 0.6, e.clientX, e.clientY)
    e.preventDefault()
  }

  private onTouchStart = (e: TouchEvent) => {
    const mode = this.opts.dragMode()
    if (!mode) return
    if (e.touches.length === 1) {
      const { clientX: x, clientY: y } = e.touches[0]
      this.startDrag(mode, x, y)
      this.tapping = true
      this.pressAt = { x, y }
      this.holdTimer = setTimeout(() => {
        // Held: whatever the finger dragged within the slop is undone, and it no longer drags or taps.
        this.dTheta = this.base.dTheta
        this.dPhi = this.base.dPhi
        this.dPanX = this.base.dPanX
        this.dPanY = this.base.dPanY
        this.dragging = false
        this.tapping = false
        this.holding = true
        this.opts.onHold(this.pressAt)
      }, HOLD_MS)
    } else if (e.touches.length === 2) {
      this.endHold()
      this.dragging = false
      this.tapping = false
      this.lastTouchDist = touchDistance(e)
      this.lastTouchMid = touchMidpoint(e)
    }
    e.preventDefault()
  }

  private onTouchMove = (e: TouchEvent) => {
    if (!this.opts.dragMode()) return
    if (e.touches.length === 1 && this.holding) {
      this.pressAt = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      this.opts.onHold(this.pressAt)
    } else if (e.touches.length === 1 && this.dragging) {
      if (Math.hypot(e.touches[0].clientX - this.pressAt.x, e.touches[0].clientY - this.pressAt.y) > CLICK_SLOP) clearTimeout(this.holdTimer)
      this.drag(e.touches[0].clientX, e.touches[0].clientY)
    } else if (e.touches.length === 2 && this.opts.canZoom()) {
      // Spreading zooms, about the point between the fingers; moving them together pans, in any view.
      const d = touchDistance(e), mid = touchMidpoint(e)
      this.zoomTo((this.opts.baseRadius() + this.dRadius) * (this.lastTouchDist / d), mid.x, mid.y)
      const s = this.opts.panScale()
      this.dPanX -= (mid.x - this.lastTouchMid.x) * s
      this.dPanY += (mid.y - this.lastTouchMid.y) * s
      this.lastTouchDist = d
      this.lastTouchMid = mid
    }
    e.preventDefault()
  }

  private onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0]
    if (this.tapping && this.opts.dragMode() && e.touches.length === 0 && t && Math.hypot(t.clientX - this.dragLast.x, t.clientY - this.dragLast.y) <= CLICK_SLOP) {
      this.opts.onTap(t.clientX, t.clientY)
    }
    this.onTouchCancel(e)
  }

  private onTouchCancel = (e: TouchEvent) => {
    this.endHold()
    this.dragging = false
    if (e.touches.length === 0) this.tapping = false
    // A pinch let go of by one finger: the other carries on dragging from where it is.
    const mode = this.opts.dragMode()
    if (e.touches.length === 1 && mode) this.startDrag(mode, e.touches[0].clientX, e.touches[0].clientY)
  }
}

function touchMidpoint(e: TouchEvent) {
  return { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
}

function touchDistance(e: TouchEvent) {
  return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
}
