/** A press that moves further than this, in pixels, is a drag (orbiting), not a click. */
export const CLICK_SLOP = 5
/** How near and far the camera can zoom, in the authoring space's units. */
const MIN_RADIUS = 250
const MAX_RADIUS = 1400
/** Radians turned per pixel dragged. */
const TURN = 0.009

export interface OrbitOptions {
  /** Whether dragging turns the camera now (in the 3d view, once it's mostly there). */
  canOrbit: () => boolean
  /** Whether the wheel zooms now. */
  canZoom: () => boolean
  /** The camera's distance before zooming, which zoom limits are measured against. */
  baseRadius: () => number
  /** A one-finger tap that didn't move, at these client coordinates (orbiting cancels its click). */
  onTap: (clientX: number, clientY: number) => void
  onOrbiting: (orbiting: boolean) => void
}

/**
 * Drag to turn the camera, and wheel or pinch to zoom, as offsets from where the view puts it:
 * `dTheta` and `dPhi` (radians) and `dRadius`.
 */
export class Orbit {
  dTheta = 0
  dPhi = 0
  dRadius = 0
  dragging = false
  private readonly canvas: HTMLCanvasElement
  private readonly opts: OrbitOptions
  private dragLast = { x: 0, y: 0 }
  private base = { dTheta: 0, dPhi: 0 }
  private lastTouchDist = 0
  /** Whether this touch is still one finger that could be a tap. */
  private tapping = false

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

  /** Eases the offsets back towards none, by `rate` of the way. */
  relax(rate: number) {
    this.dRadius -= this.dRadius * rate
    this.dTheta -= this.dTheta * rate
    this.dPhi -= this.dPhi * rate
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

  private startDrag(x: number, y: number) {
    this.dragging = true
    this.dragLast = { x, y }
    this.base = { dTheta: this.dTheta, dPhi: this.dPhi }
  }

  private drag(x: number, y: number) {
    this.dTheta = this.base.dTheta - (x - this.dragLast.x) * TURN
    this.dPhi = this.base.dPhi + (y - this.dragLast.y) * TURN
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.opts.canOrbit()) return
    this.startDrag(e.clientX, e.clientY)
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
    const base = this.opts.baseRadius()
    this.dRadius = Math.max(MIN_RADIUS - base, Math.min(MAX_RADIUS - base, this.dRadius + e.deltaY * 0.6))
    e.preventDefault()
  }

  private onTouchStart = (e: TouchEvent) => {
    if (!this.opts.canOrbit()) return
    if (e.touches.length === 1) {
      this.startDrag(e.touches[0].clientX, e.touches[0].clientY)
      this.tapping = true
    } else if (e.touches.length === 2) {
      this.dragging = false
      this.tapping = false
      this.lastTouchDist = touchDistance(e)
    }
    e.preventDefault()
  }

  private onTouchMove = (e: TouchEvent) => {
    if (!this.opts.canOrbit()) return
    if (e.touches.length === 1 && this.dragging) {
      this.drag(e.touches[0].clientX, e.touches[0].clientY)
    } else if (e.touches.length === 2) {
      const d = touchDistance(e), base = this.opts.baseRadius()
      const radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, (base + this.dRadius) * (this.lastTouchDist / d)))
      this.dRadius = radius - base
      this.lastTouchDist = d
    }
    e.preventDefault()
  }

  private onTouchEnd = (e: TouchEvent) => {
    this.dragging = false
    const t = e.changedTouches[0]
    if (this.tapping && this.opts.canOrbit() && e.touches.length === 0 && t && Math.hypot(t.clientX - this.dragLast.x, t.clientY - this.dragLast.y) <= CLICK_SLOP) {
      this.opts.onTap(t.clientX, t.clientY)
    }
    if (e.touches.length === 0) this.tapping = false
  }
}

function touchDistance(e: TouchEvent) {
  return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
}
