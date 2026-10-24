/** A press that moves further than this, in pixels, is a drag (orbiting or panning), not a click. */
export const CLICK_SLOP = 5
/** How near and far the camera can zoom, relative to where the view puts it. */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5
/** Radians turned per pixel dragged. */
const TURN = 0.009
/** Offsets this small are none, once a reset has eased them back. */
const SETTLED = 1e-3

/** What dragging does: turn the camera around what it looks at, or slide the view sideways. */
export type DragMode = 'orbit' | 'pan'

export interface OrbitOptions {
  /** What dragging does now, if anything. */
  dragMode: () => DragMode | null
  /** Whether the wheel zooms now. */
  canZoom: () => boolean
  /** The camera's distance before zooming, which zoom limits are measured against. */
  baseRadius: () => number
  /** World units per pixel dragged, when panning. */
  panScale: () => number
  /** A one-finger tap that didn't move, at these client coordinates (dragging cancels its click). */
  onTap: (clientX: number, clientY: number) => void
  onOrbiting: (orbiting: boolean) => void
}

/**
 * Drag to turn or pan the camera, and wheel or pinch to zoom, as offsets from where the view puts it:
 * `dTheta` and `dPhi` (radians), `dPanX` and `dPanY` (world units, across the screen), and `dRadius`.
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
  /** Whether this touch is still one finger that could be a tap. */
  private tapping = false
  /** Whether the offsets are easing back to none; any drag or zoom stops it. */
  private resetting = false

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
  }

  /** Starts easing the offsets back to none, a step each `ease`. */
  reset() {
    this.resetting = true
  }

  /** While resetting, eases the offsets back towards none by `rate` of the way. */
  ease(rate: number) {
    if (!this.resetting) return
    this.dRadius -= this.dRadius * rate
    this.dTheta -= this.dTheta * rate
    this.dPhi -= this.dPhi * rate
    this.dPanX -= this.dPanX * rate
    this.dPanY -= this.dPanY * rate
    if (Math.max(Math.abs(this.dTheta), Math.abs(this.dPhi)) < SETTLED && Math.max(Math.abs(this.dRadius), Math.abs(this.dPanX), Math.abs(this.dPanY)) < SETTLED * 100) {
      this.dRadius = this.dTheta = this.dPhi = this.dPanX = this.dPanY = 0
      this.resetting = false
    }
  }

  dispose() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
  }

  private startDrag(mode: DragMode, x: number, y: number) {
    this.mode = mode
    this.dragging = true
    this.resetting = false
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
      this.dPanY -= (clientY - rect.top - rect.height / 2) * s * k
    }
    this.dRadius = after - base
    this.resetting = false
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
      this.startDrag(mode, e.touches[0].clientX, e.touches[0].clientY)
      this.tapping = true
    } else if (e.touches.length === 2) {
      this.dragging = false
      this.tapping = false
      this.lastTouchDist = touchDistance(e)
    }
    e.preventDefault()
  }

  private onTouchMove = (e: TouchEvent) => {
    if (!this.opts.dragMode()) return
    if (e.touches.length === 1 && this.dragging) {
      this.drag(e.touches[0].clientX, e.touches[0].clientY)
    } else if (e.touches.length === 2 && this.opts.canZoom()) {
      const d = touchDistance(e)
      const [a, b] = [e.touches[0], e.touches[1]]
      this.zoomTo((this.opts.baseRadius() + this.dRadius) * (this.lastTouchDist / d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
      this.lastTouchDist = d
    }
    e.preventDefault()
  }

  private onTouchEnd = (e: TouchEvent) => {
    this.dragging = false
    const t = e.changedTouches[0]
    if (this.tapping && this.opts.dragMode() && e.touches.length === 0 && t && Math.hypot(t.clientX - this.dragLast.x, t.clientY - this.dragLast.y) <= CLICK_SLOP) {
      this.opts.onTap(t.clientX, t.clientY)
    }
    if (e.touches.length === 0) this.tapping = false
  }
}

function touchDistance(e: TouchEvent) {
  return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
}
