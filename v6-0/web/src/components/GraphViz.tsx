import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { CrowdEngine } from '../engine'
import { gradientRGB, OTHER_COLOR, patternColor, slotColor, type RGB } from '../palette'
import type { Gradient } from '../protocol'
import type { ColorBy, ViewSettings } from '../settings'
import { CLICK_SLOP, Orbit, type Offsets } from '../viz/orbit'
import { pickDigit } from '../viz/picking'

// The force-directed graph of phones, drawn as v4's valence visualiser draws its chords: on a dark field, inside a ring,
// each phone a dot coloured by its facing, with its trail behind it receding into the screen as time goes back, and
// seen in its three views: the 2d time slice (front on, flat), the 2d time series (side on, time running left to
// right) and 3d (from the front left and above, in perspective by a dolly zoom). The camera sweeps between them.

/** The layout fills a circle this big, in world units, as v4's ring. */
const R = 180
/** Samples along each trail, oldest to newest. */
const TRACE_LEN = 160
const TRACE_SEGS = TRACE_LEN - 1
/** How far back (into the screen) a trail reaches per second of song time, so trails keep their proportions. */
const Z_PER_SECOND = 48
/** Phones drawn at most. */
const MAX_PHONES = 200
const MAX_EDGES = 8000
const FOCUS_RING_SCALE = 2.6
/** Each dot's group ring, and a live phone's ring in its participant colour (while touched, or with group rings), relative to the dot. */
const GROUP_RING_SCALE = 1.75
const LIVE_RING_SCALE = 2.3
/** Selected for painting: a white ring just outside the group ring. */
const SELECTED_RING_SCALE = 2
const TOUCH_RING_SCALE = 4
const TOUCH_PULSE = 0.18
const TOUCH_PULSE_RATE = 7
const RING_DOT_SIZE = 3
const VIEW_FRAMES = 40
const FOV = 53.13
const FLAT_FOV = 1
const BG: RGB = [15, 15, 14]

function ease(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }

function makeLine(points: [number, number][], z: number, color: number, closed: boolean) {
  const arr = new Float32Array(points.length * 3)
  points.forEach(([x, y], i) => arr.set([x, y, z], i * 3))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })
  return closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat)
}

function makeRingLine(radius: number, z: number, color: number) {
  return makeLine(Array.from({ length: 128 }, (_, i) => [Math.cos((i / 128) * Math.PI * 2) * radius, Math.sin((i / 128) * Math.PI * 2) * radius]), z, color, true)
}

/** A round sprite for points; `ring` draws just its outline. */
function dotTexture(ring: boolean) {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - (ring ? 5 : 1), 0, Math.PI * 2)
  if (ring) {
    ctx.lineWidth = 6
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  } else {
    ctx.fillStyle = '#fff'
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Five values per trail sample: x, y, facing, detected slot, true pattern. */
const SAMPLE = 5

/**
 * Trails, recorded on a grid of song time (every `step` seconds) as a ring of samples per phone, kept by key so a
 * phone keeps its trail as others come and go. A phone joining has no samples before it did (NaN), and isn't drawn there.
 */
class Trails {
  private byKey = new Map<string, Float32Array>()
  readonly grid = new Float64Array(TRACE_LEN)
  head = 0
  count = 0
  private lastGrid = -Infinity
  private step = 0

  clear() {
    this.count = 0
    this.lastGrid = -Infinity
  }

  of(key: string) {
    let h = this.byKey.get(key)
    if (!h) this.byKey.set(key, (h = new Float32Array(TRACE_LEN * SAMPLE).fill(NaN)))
    return h
  }

  /** Records a sample when t reaches the next grid point; a jump back starts over. */
  record(t: number, step: number, keys: string[], write: (i: number, out: Float32Array, at: number) => void) {
    if (step !== this.step) { this.step = step; this.clear() }
    const grid = Math.floor(t / step)
    if (grid < this.lastGrid) this.clear()
    if (grid === this.lastGrid) return
    this.lastGrid = grid
    const here = new Set(keys)
    for (const key of [...this.byKey.keys()]) if (!here.has(key)) this.byKey.delete(key)
    keys.forEach((key, i) => write(i, this.of(key), this.head * SAMPLE))
    this.grid[this.head] = grid
    this.head = (this.head + 1) % TRACE_LEN
    this.count = Math.min(this.count + 1, TRACE_LEN - 1)
    while (this.count > 0 && t / step - this.grid[this.slot(0)] > TRACE_LEN - 1) this.count--
  }

  /** The ring slot of the k-th sample, oldest first. */
  slot(k: number) {
    return (this.head - this.count + k + TRACE_LEN) % TRACE_LEN
  }
}

export interface GraphVizProps {
  engine: CrowdEngine
  view: ViewSettings
  gradient: Gradient
  /** The followed phone's index, or null. */
  focus: number | null
  /** Live phones' colours, by phone index: those touching their screen are ringed in them, and bigger, pulsing; all are, with group rings on. */
  liveColors: Map<number, RGB>
  touching: Set<number>
  /** Phones selected for painting, ringed in white. */
  selected: Set<number>
  /** Changes when the camera should ease back from wherever it was dragged or zoomed to. */
  cameraReset: unknown
  onFocus: (phone: number | null) => void
  /** Pixels covered at the panel's bottom, read every frame: the view centres in what's left. */
  coveredBottom?: () => number
}

export function GraphViz(props: GraphVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const live = useRef(props)
  useEffect(() => {
    live.current = props
  })
  const [isOrbiting, setIsOrbiting] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x0f0f0e, 1)
    // Colours pass straight through, as v4's do.
    THREE.ColorManagement.enabled = false
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10000)

    // ── Guides: the ring, rings receding behind it, and the time axis ──
    const outerRing = makeRingLine(R, 0, 0x383835)
    const ghostRings = [-120, -240, -360].map((z) => makeRingLine(R, z, 0x1e1e1c))
    const zAxis = makeLine([[0, 0], [0, 0]], 0, 0x404040, false)
    const guides = [outerRing, ...ghostRings, zAxis]
    guides.forEach((g) => scene.add(g))
    const ringDotsArr = new Float32Array(48 * 3)
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; ringDotsArr[i * 3] = Math.cos(a) * R; ringDotsArr[i * 3 + 1] = Math.sin(a) * R }
    const ringDotsGeo = new THREE.BufferGeometry()
    ringDotsGeo.setAttribute('position', new THREE.BufferAttribute(ringDotsArr, 3))
    const ringDotsMat = new THREE.PointsMaterial({ color: 0x3a3935, size: RING_DOT_SIZE, sizeAttenuation: true, transparent: true })
    scene.add(new THREE.Points(ringDotsGeo, ringDotsMat))

    const buffer = (verts: number) => {
      const geo = new THREE.BufferGeometry()
      const pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3)
      const col = new THREE.BufferAttribute(new Float32Array(verts * 3), 3)
      pos.setUsage(THREE.DynamicDrawUsage)
      col.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('position', pos)
      geo.setAttribute('color', col)
      return { geo, pos: pos.array as Float32Array, col: col.array as Float32Array }
    }
    const points = (verts: number, tex: THREE.Texture, order: number) => {
      const b = buffer(verts)
      const mat = new THREE.PointsMaterial({ vertexColors: true, size: 12, sizeAttenuation: true, transparent: true, depthWrite: false, depthTest: false, map: tex, alphaTest: 0.05 })
      const obj = new THREE.Points(b.geo, mat)
      obj.renderOrder = order
      obj.frustumCulled = false
      scene.add(obj)
      return { ...b, mat, obj }
    }

    // The graph's edges, on the now plane, fading by how alike their phones are.
    const edges = buffer(MAX_EDGES * 2)
    const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    const edgeLines = new THREE.LineSegments(edges.geo, edgeMat)
    edgeLines.renderOrder = 6
    edgeLines.frustumCulled = false
    scene.add(edgeLines)

    const dotTex = dotTexture(false), ringTex = dotTexture(true)
    const dots = points(MAX_PHONES, dotTex, 10)
    const rings = points(MAX_PHONES, ringTex, 9)
    const liveRings = points(MAX_PHONES, ringTex, 11)
    const touchRings = points(MAX_PHONES, ringTex, 12)
    const focus = points(1, ringTex, 13)
    const selectedRings = points(MAX_PHONES, ringTex, 12)

    // Trails: wide lines in world units, so they taper into the distance, writing depth so newer segments hide the
    // faded ends behind them.
    const trace = { pos: new Float32Array(MAX_PHONES * TRACE_SEGS * 6), col: new Float32Array(MAX_PHONES * TRACE_SEGS * 6) }
    const traceGeo = new LineSegmentsGeometry()
    traceGeo.setPositions(trace.pos)
    traceGeo.setColors(trace.col)
    const traceBuffers = ['instanceStart', 'instanceColorStart'].map((a) => (traceGeo.getAttribute(a) as THREE.InterleavedBufferAttribute).data)
    for (const b of traceBuffers) b.setUsage(THREE.DynamicDrawUsage)
    const traceMat = new LineMaterial({ vertexColors: true, transparent: true, depthFunc: THREE.LessDepth, worldUnits: true, linewidth: 3 })
    const traceLines = new LineSegments2(traceGeo, traceMat)
    traceLines.renderOrder = 5
    traceLines.frustumCulled = false
    scene.add(traceLines)

    let viewWidth = 1, viewHeight = 1, shownCovered = 0
    function shiftLens() {
      if (shownCovered > 0) camera.setViewOffset(viewWidth, viewHeight, 0, shownCovered / 2, viewWidth, viewHeight)
      else camera.clearViewOffset()
    }

    // ── Camera, as v4's: three views, swept between, with perspective as a dolly zoom in 3d ──
    let camRadius = 480, camTheta = 0, camPhi = 0, camTargetZ = 0
    const CAM_2D = { radius: 480, theta: 0, phi: 0 }
    const CAM_2D_TS = { radius: 820, theta: -Math.PI / 2, phi: 0, nowAcross: 0.5 }
    const CAM_3D = { radius: 560, theta: -Math.PI / 5, phi: Math.PI / 9 }
    const tsTargetZ = (trailDepth: number) => {
      const halfWidth = CAM_2D_TS.radius * Math.tan((baseFov * Math.PI) / 360) * camera.aspect
      return -Math.min(trailDepth / 2, CAM_2D_TS.nowAcross * halfWidth)
    }
    let to3d = 0, toTs = 0
    let baseFov = FOV, dolly = 1
    function setLens() {
      const half = (deg: number) => Math.tan((deg * Math.PI) / 360)
      const t = half(FLAT_FOV) + (half(baseFov) - half(FLAT_FOV)) * to3d
      camera.fov = (2 * Math.atan(t) * 180) / Math.PI
      dolly = half(baseFov) / t
      camera.near = 0.1 * dolly * dolly
      camera.far = 1e6 * dolly
      camera.updateProjectionMatrix()
    }
    if (live.current.view.mode === '3d') to3d = 1
    if (live.current.view.mode === '2d-ts') toTs = 1
    let sweep = { u: 1, from3d: to3d, fromTs: toTs, offsets: null as Offsets | null, fade: 1 }
    let sweepView = live.current.view.mode

    const orbit = new Orbit(canvas, {
      dragMode: () => (sweep.u < 1 ? null : live.current.view.mode === '3d' ? 'orbit' : 'pan'),
      canZoom: () => sweep.u >= 1,
      baseRadius: () => camRadius,
      panScale: (): number => (2 * (camRadius + orbit.dRadius) * Math.tan((baseFov * Math.PI) / 360)) / viewHeight,
      middleRaised: () => shownCovered / 2,
      onTap: (x, y) => live.current.onFocus(pickAt(x, y)),
      onOrbiting: setIsOrbiting,
      onHold: () => {},
    })
    const panBy = new THREE.Vector3()
    function applyCam() {
      const theta = camTheta + orbit.dTheta
      const phi = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPhi + orbit.dPhi))
      const effR = (camRadius + orbit.dRadius) * dolly
      camera.position.set(effR * Math.sin(theta) * Math.cos(phi), effR * Math.sin(phi), camTargetZ + effR * Math.cos(theta) * Math.cos(phi))
      camera.lookAt(0, 0, camTargetZ)
      camera.position.add(panBy.set(orbit.dPanX, orbit.dPanY, 0).applyQuaternion(camera.quaternion))
    }
    let lastCameraReset = live.current.cameraReset

    const trails = new Trails()
    const bg = BG.map((c) => c / 255)
    const rgb = [0, 0, 0]
    /** A colour by facing, group slot or pattern, into rgb (0–1). Facing is eased away from 0, so a little already shows. */
    function colour(by: ColorBy, v: number, slot: number, pattern: number) {
      if (by === 'valence') {
        gradientRGB(live.current.gradient, Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 0.55), rgb, 0)
        for (let c = 0; c < 3; c++) rgb[c] /= 255
        return
      }
      const c = by === 'group' ? (slot >= 0 ? slotColor(slot) : OTHER_COLOR) : pattern >= 0 ? patternColor(pattern) : OTHER_COLOR
      for (let k = 0; k < 3; k++) rgb[k] = c[k] / 255
    }
    /** Where phone i is drawn, in world units. */
    const world = new Float32Array(MAX_PHONES * 2)

    let animFrameId = 0
    function animate() {
      animFrameId = requestAnimationFrame(animate)
      const { engine, view, focus: focused, liveColors, touching, selected, cameraReset } = live.current
      const n = Math.min(engine.phones.length, MAX_PHONES)
      const trailDepth = view.trailSeconds * Z_PER_SECOND

      // ── Camera between views ──
      if (view.mode !== sweepView || cameraReset !== lastCameraReset) {
        sweep = { u: 0, from3d: to3d, fromTs: toTs, offsets: orbit.offsets(), fade: view.mode !== sweepView ? 2 : 1 }
        sweepView = view.mode
        lastCameraReset = cameraReset
      }
      if (sweep.u < 1) {
        sweep.u = Math.min(1, sweep.u + 1 / VIEW_FRAMES)
        const s = ease(sweep.u)
        to3d = sweep.from3d + ((view.mode === '3d' ? 1 : 0) - sweep.from3d) * s
        toTs = sweep.fromTs + ((view.mode === '2d-ts' ? 1 : 0) - sweep.fromTs) * s
        if (sweep.offsets) orbit.setOffsets(sweep.offsets, (1 - s) ** sweep.fade)
      }
      camRadius = CAM_2D.radius + (CAM_3D.radius - CAM_2D.radius) * to3d
      camTheta = CAM_2D.theta + (CAM_3D.theta - CAM_2D.theta) * to3d
      camPhi = CAM_2D.phi + (CAM_3D.phi - CAM_2D.phi) * to3d
      camRadius += (CAM_2D_TS.radius - camRadius) * toTs
      camTheta += (CAM_2D_TS.theta - camTheta) * toTs
      camPhi += (CAM_2D_TS.phi - camPhi) * toTs
      camTargetZ = tsTargetZ(trailDepth) * toTs
      const covered = Math.max(0, Math.min(viewHeight, Math.round(live.current.coveredBottom?.() ?? 0)))
      if (covered !== shownCovered) {
        shownCovered = covered
        shiftLens()
      }
      setLens()
      applyCam()

      const depth = Math.max(to3d, toTs)
      outerRing.material.opacity = 0.8
      zAxis.geometry.attributes.position.setZ(1, -trailDepth)
      zAxis.geometry.attributes.position.needsUpdate = true
      zAxis.material.opacity = depth * 0.45
      ghostRings.forEach((r, i) => {
        r.position.z = (-trailDepth * (i + 1)) / 3 - r.geometry.attributes.position.getZ(0)
        r.material.opacity = to3d * (0.12 - i * 0.03)
        r.visible = to3d > 0.02
      })

      // ── Phones: where they are, and their colours ──
      const { layout, view: lv } = engine
      const scale = (R * 0.92) / lv.span
      for (let i = 0; i < n; i++) {
        let x = (layout.x[i] - lv.cx) * scale, y = (layout.y[i] - lv.cy) * scale
        // Stragglers are kept inside the ring.
        const r = Math.hypot(x, y)
        if (r > R) { x *= R / r; y *= R / r }
        world[i * 2] = x
        world[i * 2 + 1] = y
      }
      const keys = engine.phones.slice(0, n).map((p) => p.key)
      const step = view.trailSeconds / TRACE_SEGS
      const t = engine.t
      trails.record(t, step, keys, (i, out, at) => {
        out[at] = world[i * 2]
        out[at + 1] = world[i * 2 + 1]
        out[at + 2] = engine.value(i)
        out[at + 3] = engine.slot(i)
        out[at + 4] = engine.pattern(i)
      })

      let nLive = 0, nTouch = 0, nSelected = 0, focusShown = false
      /** Now, in trail steps: each sample's age is how far it's behind. */
      const now = t / step
      for (let i = 0; i < n; i++) {
        const x = world[i * 2], y = world[i * 2 + 1], v = engine.value(i), slot = engine.slot(i), pattern = engine.pattern(i)
        dots.pos[i * 3] = x; dots.pos[i * 3 + 1] = y; dots.pos[i * 3 + 2] = 0
        colour(view.dots, v, slot, pattern)
        dots.col.set(rgb, i * 3)
        rings.pos.set([x, y, 0], i * 3)
        colour(view.dots === 'group' ? 'pattern' : 'group', v, slot, pattern)
        rings.col.set(rgb, i * 3)
        const lc = liveColors.get(i)
        if (lc && (view.groupRings || touching.has(i))) {
          liveRings.pos.set([x, y, 1], nLive * 3)
          liveRings.col.set([lc[0] / 255, lc[1] / 255, lc[2] / 255], nLive * 3)
          nLive++
          if (touching.has(i)) {
            touchRings.pos.set([x, y, 2], nTouch * 3)
            touchRings.col.set([lc[0] / 255, lc[1] / 255, lc[2] / 255], nTouch * 3)
            nTouch++
          }
        }
        if (selected.has(i)) {
          selectedRings.pos.set([x, y, 2], nSelected * 3)
          selectedRings.col.set([1, 1, 1], nSelected * 3)
          nSelected++
        }
        if (i === focused) {
          focus.pos.set([x, y, 3], 0)
          focus.col.set([1, 1, 1], 0)
          focusShown = true
        }

        // The trail: recorded samples, oldest first, then where it is now, receding and fading with age.
        const h = trails.of(keys[i])
        const len = trails.count + 1
        for (let j = 0; j < TRACE_SEGS; j++) {
          const base = (i * TRACE_SEGS + j) * 6
          if (j + 1 >= len || depth < 0.01) { trace.pos.fill(0, base, base + 6); continue }
          const sa = trails.slot(j), sb = j + 1 === len - 1 ? -1 : trails.slot(j + 1)
          const ax = h[sa * SAMPLE], ay = h[sa * SAMPLE + 1]
          if (Number.isNaN(ax) || (sb >= 0 && Number.isNaN(h[sb * SAMPLE]))) { trace.pos.fill(0, base, base + 6); continue }
          const ageA = now - trails.grid[sa], ageB = sb < 0 ? 0 : now - trails.grid[sb]
          const bx = sb < 0 ? x : h[sb * SAMPLE], by = sb < 0 ? y : h[sb * SAMPLE + 1]
          const zA = -(ageA * step) * Z_PER_SECOND, zB = -(ageB * step) * Z_PER_SECOND
          const fadeA = Math.max(0, 1 - ageA / TRACE_SEGS) ** 2, fadeB = Math.max(0, 1 - ageB / TRACE_SEGS) ** 2
          const tp = trace.pos, tc = trace.col
          tp[base] = ax; tp[base + 1] = ay; tp[base + 2] = zA
          tp[base + 3] = bx; tp[base + 4] = by; tp[base + 5] = zB
          colour(view.trails, h[sa * SAMPLE + 2], h[sa * SAMPLE + 3], h[sa * SAMPLE + 4])
          for (let c = 0; c < 3; c++) {
            tc[base + c] = bg[c] + (rgb[c] - bg[c]) * fadeA
            tc[base + 3 + c] = bg[c] + (rgb[c] - bg[c]) * fadeB
          }
        }
      }
      dots.geo.setDrawRange(0, n)
      rings.geo.setDrawRange(0, view.groupRings ? n : 0)
      liveRings.geo.setDrawRange(0, nLive)
      touchRings.geo.setDrawRange(0, nTouch)
      focus.geo.setDrawRange(0, focusShown ? 1 : 0)
      selectedRings.geo.setDrawRange(0, nSelected)
      for (const b of [dots, rings, liveRings, touchRings, focus, selectedRings]) {
        b.geo.attributes.position.needsUpdate = true
        b.geo.attributes.color.needsUpdate = true
      }
      traceGeo.instanceCount = n * TRACE_SEGS
      for (const b of traceBuffers) b.needsUpdate = true
      traceLines.visible = depth > 0.01
      traceMat.opacity = 0.85 * depth
      traceMat.linewidth = view.trailWidth

      // ── Edges ──
      const a = engine.analysis
      let ne = 0
      if (view.edges && a && a.keys.length === engine.phones.length) {
        const E = a.edges
        for (let q = 0; q + 2 < E.length && ne < MAX_EDGES; q += 3) {
          const i = E[q], j = E[q + 1], w = E[q + 2]
          if (i >= n || j >= n) continue
          const si = a.slots[i], sj = a.slots[j]
          const c = si === sj ? slotColor(si) : [170, 170, 160]
          const k = 0.08 + 0.45 * w * w
          for (const [e, p] of [[ne * 2, i], [ne * 2 + 1, j]]) {
            edges.pos.set([world[p * 2], world[p * 2 + 1], -0.5], e * 3)
            for (let ch = 0; ch < 3; ch++) edges.col[e * 3 + ch] = bg[ch] + (c[ch] / 255 - bg[ch]) * k
          }
          ne++
        }
      }
      edges.geo.setDrawRange(0, ne * 2)
      edges.geo.attributes.position.needsUpdate = true
      edges.geo.attributes.color.needsUpdate = true

      // Points shrink with distance but not with the field of view, so they make up for the dolly.
      const size = view.dotSize * dolly
      dots.mat.size = size
      rings.mat.size = size * GROUP_RING_SCALE
      liveRings.mat.size = size * LIVE_RING_SCALE
      touchRings.mat.size = size * TOUCH_RING_SCALE * (1 + TOUCH_PULSE * Math.sin((performance.now() / 1000) * TOUCH_PULSE_RATE))
      focus.mat.size = size * FOCUS_RING_SCALE
      selectedRings.mat.size = size * SELECTED_RING_SCALE
      ringDotsMat.size = RING_DOT_SIZE * dolly

      renderer.render(scene, camera)
    }
    animFrameId = requestAnimationFrame(animate)

    function pickAt(clientX: number, clientY: number): number | null {
      const rect = canvas.getBoundingClientRect()
      const n = Math.min(live.current.engine.phones.length, MAX_PHONES)
      return pickDigit(clientX - rect.left, clientY - rect.top, rect.width, rect.height, camera, n, dots.pos, null)
    }
    let pressAt = { x: 0, y: 0 }
    const isClick = (x: number, y: number) => Math.hypot(x - pressAt.x, y - pressAt.y) <= CLICK_SLOP
    function onPointerDown(e: PointerEvent) { pressAt = { x: e.clientX, y: e.clientY } }
    function onClick(e: MouseEvent) { if (isClick(e.clientX, e.clientY)) live.current.onFocus(pickAt(e.clientX, e.clientY)) }
    function onMove(e: MouseEvent) { canvas.style.cursor = !orbit.dragging && pickAt(e.clientX, e.clientY) !== null ? 'pointer' : '' }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mousemove', onMove)

    const resize = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      if (!w || !h) return
      viewWidth = w
      viewHeight = h
      renderer.setSize(w, h, false)
      shiftLens()
      traceMat.resolution.set(w, h)
      camera.aspect = w / h
      baseFov = w >= h ? FOV : (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * (h / w)) * 180) / Math.PI
      setLens()
    })
    resize.observe(wrap)

    return () => {
      cancelAnimationFrame(animFrameId)
      resize.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMove)
      orbit.dispose()
      renderer.dispose()
      for (const g of [edges.geo, dots.geo, rings.geo, liveRings.geo, touchRings.geo, focus.geo, selectedRings.geo, traceGeo, ringDotsGeo, ...guides.map((l) => l.geometry)]) g.dispose()
      for (const m of [edgeMat, dots.mat, rings.mat, liveRings.mat, touchRings.mat, focus.mat, selectedRings.mat, traceMat, ringDotsMat, ...guides.map((l) => l.material)]) m.dispose()
      dotTex.dispose()
      ringTex.dispose()
    }
  }, [])

  return (
    <div ref={wrapRef} className="viz-canvas" style={{ cursor: isOrbiting ? 'grabbing' : 'grab' }}>
      <canvas ref={canvasRef} />
    </div>
  )
}
