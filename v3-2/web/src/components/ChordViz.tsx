import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { RGB } from '../palette'
import type { Playhead } from '../playhead'
import { valenceAt, type Traces } from '../signal'
import { CLICK_SLOP, Orbit, type Offsets } from '../viz/orbit'
import { Particles } from '../viz/particles'
import { pickDigit } from '../viz/picking'
import { DEFAULT_STYLE, MAX_CHORDS, type GeoMode, type ParticleSettings, type ViewMode, type VizStyle } from '../vizSettings'

// Ported from the reaction canvas's valence cross-section (plugins/valenceCrossSection in
// patcon/polislike-partykit-reaction-canvas, itself from valence-onboarding-v3.html): each
// participant is a chord, rooted at the centre and displaced by its valence, laid out in one
// of several geometries and seen in three views. Here the valence comes from a precomputed
// trace rather than a live cursor, so trails are drawn from the trace itself, which also lets
// them follow a scrub backwards. Added: group colouring and chord order. The particle geometry is
// the prototype's charged particles, with its group force matrix replaced by one force within
// groups and one between them, and its speaker's per-group pull by each digit's valence.

// ── Layout, in the original's 480×480 authoring space ──
const CENTER = 240
const R = 180
const R_MID = 90
/** Samples along each trail, oldest to newest. */
const TRACE_LEN = 160
const TRACE_SEGS = TRACE_LEN - 1
/** How far back (into the screen) a whole trail reaches. */
const TRACE_DEPTH = 900
const TRACE_Z_STEP = TRACE_DEPTH / TRACE_SEGS
const FILL_VERTS_PER_SEG = 6
// A fill segment's two triangles, as offsets into the trail history (5 values per sample: cursor
// x, y, root x, y, valence): root then cursor at the earlier sample, roots fading to the background.
const FILL_CORNERS = [2, 0, 7, 0, 5, 7]
const FILL_LATER = [false, false, true, false, true, true]
const FILL_IS_ROOT = [true, false, true, false, false, true]
/** The focus ring's size, relative to a cursor dot. */
const FOCUS_RING_SCALE = 2.6
/** The outer ring's dots, in the authoring space's units. */
const RING_DOT_SIZE = 3
/** How far from its root a chord reaches full width; shorter chords never get there. */
const CHORD_TAPER = 60
/** A chord's ribbon: root, then the two corners where the taper ends, then the two at the tip. */
const CHORD_VERTS = 9
const TRANS_SPEED = 0.04
/** Frames the camera takes to sweep from one view to another, or back to a view's own place. */
const VIEW_FRAMES = 40
/** The camera's vertical field of view, in degrees, at full perspective on a panel at least as wide as it is tall. */
const FOV = 53.13
/** Its field of view at no perspective: narrow enough to look orthographic. */
const FLAT_FOV = 1
/** How fast chords glide to a new slot, per frame. */
const REORDER_EASE = 0.08
const BG: RGB = [15, 15, 14]

/** Frames a cursor takes to glide from its particle back onto its chord. */
const PARTICLE_EXIT_FRAMES = 30
/**
 * While a finger is held, a random spot this many pixels around it is picked every JITTER_MS, as if tapping all
 * round it, and whichever digit is there is hovered: so many digits nearby can be previewed, as a mouse could.
 */
const JITTER_RADIUS = 36
const JITTER_MS = 110
/** Spots tried per pick for a digit other than the one hovered, before keeping it. */
const JITTER_TRIES = 6

const COLORS = { pos: [80, 255, 140] as RGB, neg: [255, 80, 60] as RGB, neutral: BG }

function ease(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }
function clamp01(t: number) { return Math.min(1, Math.max(0, t)) }

function valenceRGB(v: number, out: number[], at: number) {
  const t = Math.pow(Math.abs(v), 0.55)
  const src = v >= 0 ? COLORS.pos : COLORS.neg
  for (let c = 0; c < 3; c++) out[at + c] = (BG[c] + (src[c] - BG[c]) * t) / 255
}

// Chord root and tip in canvas space for the four chord geometries (ported as is), blended in morph phases.
interface Morph { p1: number; p2: number; pp1: number; pp2: number; lp1: number; lp2: number }

function getPhases(mt: number, toRadial: boolean) {
  if (toRadial) return { p1: ease(clamp01(mt * 2)), p2: ease(clamp01((mt - 0.5) * 2)) }
  const rev = 1 - mt
  return { p2: 1 - ease(clamp01(rev * 2)), p1: 1 - ease(clamp01((rev - 0.5) * 2)) }
}

/** out = [rootX, rootY, tipX, tipY] */
function chordPoints(i: number, n: number, v: number, m: Morph, out: Float64Array) {
  const tilt = (Math.PI / n) * 0.5, absV = Math.abs(v)
  const dAx = (i / n) * Math.PI + tilt
  const dTA = v >= 0 ? dAx + Math.PI : dAx
  const dTX = CENTER + Math.cos(dTA) * R * absV, dTY = CENTER + Math.sin(dTA) * R * absV
  const rSA = (i / n) * 2 * Math.PI + tilt - Math.PI / 2
  let sd = rSA - dAx
  while (sd > Math.PI) sd -= 2 * Math.PI
  while (sd < -Math.PI) sd += 2 * Math.PI
  const sa = dAx + sd * m.p2, sc = Math.cos(sa), ss = Math.sin(sa)
  const rRX = CENTER + sc * R_MID, rRY = CENTER + ss * R_MID, rTR = R_MID * (1 - v)
  let rootX = CENTER + (rRX - CENTER) * m.p1, rootY = CENTER + (rRY - CENTER) * m.p1
  let tipX = dTX + (CENTER + sc * rTR - dTX) * m.p1, tipY = dTY + (CENTER + ss * rTR - dTY) * m.p1
  if (m.pp1 > 0 || m.pp2 > 0) {
    const pX = n > 1 ? CENTER + (i - (n - 1) / 2) / (n - 1) * 2 * R : CENTER
    rootX += (pX - rootX) * m.pp1; rootY += (CENTER - rootY) * m.pp1
    tipX += (pX - tipX) * m.pp2; tipY += (CENTER - R * v - tipY) * m.pp2
  }
  if (m.lp1 > 0 || m.lp2 > 0) {
    rootX += (CENTER - rootX) * m.lp1; rootY += (CENTER - rootY) * m.lp1
    tipX += (CENTER - tipX) * m.lp2; tipY += (CENTER - R * v - tipY) * m.lp2
  }
  out[0] = rootX; out[1] = rootY; out[2] = tipX; out[3] = tipY
}

function makeLine(points: [number, number][], z: number, color: number, closed: boolean) {
  const arr = new Float32Array(points.length * 3)
  points.forEach(([x, y], i) => arr.set([x, y, z], i * 3))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 })
  return closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat)
}

function makeRingLine(radius: number, z: number, color: number) {
  return makeLine(
    Array.from({ length: 128 }, (_, i) => [Math.cos((i / 128) * Math.PI * 2) * radius, Math.sin((i / 128) * Math.PI * 2) * radius]),
    z, color, true,
  )
}

/** A round sprite for points (PointsMaterial draws squares otherwise); `ring` draws just its outline. */
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

export interface ChordVizProps {
  traces: Traces
  /** Changes when a new set of digits takes part, so their chords grow in afresh. */
  pickKey: unknown
  playhead: Playhead
  /** slotOf[participant] = its chord's position in the geometry. */
  slotOf: Int32Array
  groupOf: Int32Array
  colors: RGB[]
  focus: number | null
  view: ViewMode
  geometry: GeoMode
  style: VizStyle
  /** How far back trails reach, in seconds of playback. */
  trailSeconds: number
  particles: ParticleSettings
  /** Changes when particles should be scattered afresh. */
  particleReset: unknown
  /** Changes when the camera should ease back from wherever it was dragged or zoomed to. */
  cameraReset: unknown
  /** A digit's cursor (or chord) was clicked, or nothing was (null), to follow no digit. */
  onFocus: (participant: number | null) => void
  /** The pointer is over a digit's cursor (or chord), or none. */
  onHover: (participant: number | null) => void
  /**
   * How many pixels at the panel's bottom something covers, read every frame: the view centres in what's left,
   * by shifting the lens rather than resizing the canvas, so it follows a drawer smoothly as it moves.
   */
  coveredBottom?: () => number
}

export function ChordViz(props: ChordVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const holdRingRef = useRef<HTMLDivElement>(null)
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
    // The prototype ran on three r128, before colour management: colours went to the screen as
    // given. Newer three treats them as linear and encodes them to sRGB, which pales every dark
    // tone (the reaction canvas's React port inherits that). Pass them through as r128 did.
    THREE.ColorManagement.enabled = false
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10000)

    // ── Scene objects ──
    const outerRing = makeRingLine(R, 0, 0x383835)
    const midRing = makeRingLine(R_MID, 0, 0x2a2a28)
    const ghostRings = [-120, -240, -360].map((z) => makeRingLine(R, z, 0x1e1e1c))
    const zAxis = makeLine([[0, 0], [0, 0]], 0, 0x404040, false)
    zAxis.geometry.attributes.position.setZ(1, -420)
    const guides = [outerRing, midRing, ...ghostRings, zAxis]
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
    // Chords are ribbons facing the camera, tapering to a point at the root, so the many that meet
    // there don't pile up into a blob; they're rebuilt each frame, with widths kept in pixels.
    const chord = buffer(MAX_CHORDS * CHORD_VERTS)
    const chordMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const chordMesh = new THREE.Mesh(chord.geo, chordMat)
    chordMesh.renderOrder = 7
    chordMesh.frustumCulled = false
    scene.add(chordMesh)
    let viewWidth = 1, viewHeight = 1
    /** The pixels covered at the bottom, as the lens is shifted for now. */
    let shownCovered = 0
    function shiftLens() {
      // The view's middle moves up by half what's covered; picking and panning go through the camera, so follow.
      if (shownCovered > 0) camera.setViewOffset(viewWidth, viewHeight, 0, shownCovered / 2, viewWidth, viewHeight)
      else camera.clearViewOffset()
    }

    // Cursors skip the depth test, so they're always drawn over chords and trails.
    const dotTex = dotTexture(false)
    const dot = buffer(MAX_CHORDS)
    const dotMat = new THREE.PointsMaterial({ vertexColors: true, size: DEFAULT_STYLE.cursorSize, sizeAttenuation: true, transparent: true, depthWrite: false, depthTest: false, map: dotTex, alphaTest: 0.05 })
    const dotPoints = new THREE.Points(dot.geo, dotMat)
    dotPoints.renderOrder = 10
    dotPoints.frustumCulled = false
    scene.add(dotPoints)

    // The followed digit: a ring around its cursor.
    const ringTex = dotTexture(true)
    const focusGeo = new THREE.BufferGeometry()
    focusGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    const focusMat = new THREE.PointsMaterial({ color: 0xffffff, size: DEFAULT_STYLE.cursorSize * FOCUS_RING_SCALE, sizeAttenuation: true, transparent: true, depthTest: false, map: ringTex })
    const focusPoint = new THREE.Points(focusGeo, focusMat)
    focusPoint.renderOrder = 11
    focusPoint.frustumCulled = false
    scene.add(focusPoint)

    // Wide lines too, so their width can be set; the buffers are handed over once and written in place.
    // Measured in world units, so trails taper into the distance. They write depth, so nearer, newer
    // segments hide the dark, faded ends of trails behind them rather than being painted over by them;
    // a strict depth test keeps a trail's overlapping joints from blending twice.
    const trace = { pos: new Float32Array(MAX_CHORDS * TRACE_SEGS * 6), col: new Float32Array(MAX_CHORDS * TRACE_SEGS * 6) }
    const traceGeo = new LineSegmentsGeometry()
    traceGeo.setPositions(trace.pos)
    traceGeo.setColors(trace.col)
    const traceBuffers = ['instanceStart', 'instanceColorStart'].map((a) => (traceGeo.getAttribute(a) as THREE.InterleavedBufferAttribute).data)
    for (const b of traceBuffers) b.setUsage(THREE.DynamicDrawUsage)
    const traceMat = new LineMaterial({ vertexColors: true, transparent: true, depthFunc: THREE.LessDepth, worldUnits: true, linewidth: DEFAULT_STYLE.traceWidth })
    const traceLines = new LineSegments2(traceGeo, traceMat)
    traceLines.renderOrder = 5
    traceLines.frustumCulled = false
    scene.add(traceLines)

    const fill = buffer(MAX_CHORDS * TRACE_SEGS * FILL_VERTS_PER_SEG)
    const fillMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const fillMesh = new THREE.Mesh(fill.geo, fillMat)
    fillMesh.renderOrder = 4
    fillMesh.frustumCulled = false
    scene.add(fillMesh)

    // ── Camera ──
    let camRadius = 480, camTheta = 0, camPhi = 0, camTargetZ = 0
    const CAM_2D = { radius: 480, theta: 0, phi: 0 }
    // Side on and from the left, so time runs left to right like a strip chart. Now sits right of centre, by
    // `nowAcross` of the half-width, or at the right end of a whole trail centred where the screen is wide enough.
    const CAM_2D_TS = { radius: 820, theta: -Math.PI / 2, phi: 0, nowAcross: 0.5 }
    /** How far back from now the time series camera looks, for the screen's shape. */
    const tsTargetZ = () => {
      // The plane at the target spans 2·radius·tan(fov/2) in height; now's plane is the same one, side on.
      const halfWidth = CAM_2D_TS.radius * Math.tan((baseFov * Math.PI) / 360) * camera.aspect
      return -Math.min(TRACE_DEPTH / 2, CAM_2D_TS.nowAcross * halfWidth)
    }
    // From the front left and above, so trails recede to the left, with time running left to right as
    // in the time series view.
    const CAM_3D = { radius: 560, theta: -Math.PI / 5, phi: Math.PI / 9 }
    /** How far the camera is towards the 3d view and the time series view (from 2d), eased. */
    let to3d = 0, toTs = 0
    // Perspective is a dolly zoom: the field of view narrows from `baseFov` (the panel's, at full
    // perspective) while the camera backs off by `dolly`, so the plane it looks at stays the same size.
    let baseFov = FOV, shownPerspective = live.current.style.perspective, dolly = 1
    function setLens() {
      const half = (deg: number) => Math.tan((deg * Math.PI) / 360)
      // Blended in tan(fov/2), not in degrees, so lines converge less in even steps along the slider.
      const t = half(FLAT_FOV) + (half(baseFov) - half(FLAT_FOV)) * shownPerspective
      camera.fov = (2 * Math.atan(t) * 180) / Math.PI
      dolly = half(baseFov) / t
      // Near grows with the square of the distance, keeping the depth buffer's precision at the scene
      // as it was (it goes as distance² / near); far just has to reach past the scene.
      camera.near = 0.1 * dolly * dolly
      camera.far = 10000 * dolly
      camera.updateProjectionMatrix()
    }
    // Opens on whatever view is chosen, without animating there from 2d.
    if (live.current.view === '3d') to3d = 1
    if (live.current.view === '2d-ts') toTs = 1
    // A move to another view, or back to this one's own place, is one eased sweep: `u` runs 0 to 1 over
    // VIEW_FRAMES, from where the camera was (`from3d`, `fromTs`, and dragged and zoomed `offsets`).
    let sweep = { u: 1, from3d: to3d, fromTs: toTs, offsets: null as Offsets | null, fade: 1 }
    let sweepView = live.current.view

    // Drag to turn (in 3d) or to pan (in 2d), and wheel or pinch to zoom; not mid-sweep.
    const orbit = new Orbit(canvas, {
      dragMode: () => (sweep.u < 1 ? null : live.current.view === '3d' ? 'orbit' : 'pan'),
      canZoom: () => sweep.u >= 1,
      // Orbit's radii are before the dolly, so its zoom limits and speed scale with it.
      baseRadius: () => camRadius,
      // The plane the camera looks at spans 2·distance·tan(fov/2) in height; the dolly cancels out.
      panScale: (): number => (2 * (camRadius + orbit.dRadius) * Math.tan((baseFov * Math.PI) / 360)) / viewHeight,
      onTap: (x, y) => live.current.onFocus(pickAt(x, y)),
      onOrbiting: setIsOrbiting,
      onHold,
    })

    function applyCam() {
      const theta = camTheta + orbit.dTheta
      const phi = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPhi + orbit.dPhi))
      const effR = (camRadius + orbit.dRadius) * dolly
      camera.position.set(effR * Math.sin(theta) * Math.cos(phi), effR * Math.sin(phi), camTargetZ + effR * Math.cos(theta) * Math.cos(phi))
      camera.lookAt(0, 0, camTargetZ)
      // Panning slides the camera across the screen, keeping its direction.
      camera.position.add(panBy.set(orbit.dPanX, orbit.dPanY, 0).applyQuaternion(camera.quaternion))
    }
    const panBy = new THREE.Vector3()
    let lastCameraReset = live.current.cameraReset

    // ── Per-participant animation: chords grow in, and glide to new slots ──
    let n = 0
    let shownSlot = new Float32Array(0)
    let arrival = new Float32Array(0)
    let lastPick: unknown = undefined
    type ChordGeo = Exclude<GeoMode, 'particle'>
    const geoTarget: Record<ChordGeo, number> = { radial: 1, diametric: 0, linear: -1, parallel: -2 }
    // The particle geometry has no chords of its own; they keep the last chord geometry's shape.
    let chordGeo: ChordGeo = live.current.geometry === 'particle' ? 'diametric' : live.current.geometry
    let morphT = geoTarget[chordGeo]
    /** Valence now, per participant, scaled by how far it has grown in. */
    let vNow = new Float32Array(0)
    /** Each chord's root (x, y), for picking; its tip is the cursor. */
    const chordRoot = new Float32Array(MAX_CHORDS * 2)

    // ── Particles ──
    const sim = new Particles(TRACE_LEN)
    /** 1 while particles are shown, falling to 0 as cursors glide back onto their chords. */
    let particleBlend = live.current.geometry === 'particle' ? 1 : 0
    let wasParticle = false
    let lastReset: unknown = live.current.particleReset
    const seedParticles = (scatter: boolean) => sim.seed(scatter, live.current.particles.spread, dot.pos)

    const morph: Morph = { p1: 0, p2: 0, pp1: 0, pp2: 0, lp1: 0, lp2: 0 }
    // Root and tip of one chord at valence v: [rootX, rootY, tipX, tipY].
    const pts = new Float64Array(4)

    const rgb = [0, 0, 0]
    // An element's colour at valence v, by valence or by group, into rgb (0–1).
    function colour(by: 'valence' | 'group', v: number, group: RGB) {
      if (by === 'valence') valenceRGB(v, rgb, 0)
      else for (let c = 0; c < 3; c++) rgb[c] = group[c] / 255
    }
    const bg = BG.map((c) => c / 255)
    const ribbon = new Float64Array(CHORD_VERTS * 3)
    const ribbonCol = new Float64Array(CHORD_VERTS * 3)
    /** Writes chord i's ribbon from (rx, ry) to (dx, dy), coloured rootCol to tipCol, `width` pixels wide. */
    function writeChord(i: number, rx: number, ry: number, dx: number, dy: number, rootCol: number[], tipCol: number[], width: number) {
      const len = Math.hypot(dx - rx, dy - ry)
      const ux = len > 1e-6 ? (dx - rx) / len : 0, uy = len > 1e-6 ? (dy - ry) / len : 0
      // Sideways is across the chord and across the line of sight, so the ribbon faces the camera.
      const cp = camera.position
      const vx = cp.x - dx, vy = cp.y - dy, vz = cp.z
      let px = uy * vz, py = -ux * vz, pz = ux * vy - uy * vx
      const pl = Math.hypot(px, py, pz) || 1
      const dist = Math.hypot(vx, vy, vz)
      const half = (width / 2) * ((2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / viewHeight) * Math.min(1, len / CHORD_TAPER)
      px *= half / pl; py *= half / pl; pz *= half / pl
      const tm = Math.min(len, CHORD_TAPER), mx = rx + ux * tm, my = ry + uy * tm
      const f = len > 1e-6 ? tm / len : 1
      const corners = [
        [rx, ry, 0], [mx + px, my + py, pz], [mx - px, my - py, -pz],
        [mx + px, my + py, pz], [dx + px, dy + py, pz], [dx - px, dy - py, -pz],
        [mx + px, my + py, pz], [dx - px, dy - py, -pz], [mx - px, my - py, -pz],
      ]
      // 0 at the root, f where the taper ends, 1 at the tip.
      const along = [0, f, f, f, 1, 1, f, 1, f]
      for (let q = 0; q < CHORD_VERTS; q++) {
        ribbon.set(corners[q], q * 3)
        for (let c = 0; c < 3; c++) ribbonCol[q * 3 + c] = rootCol[c] + (tipCol[c] - rootCol[c]) * along[q]
      }
      chord.pos.set(ribbon, i * CHORD_VERTS * 3)
      chord.col.set(ribbonCol, i * CHORD_VERTS * 3)
    }
    const hist = new Float64Array(TRACE_LEN * 5)
    /** Each trail sample's age, in steps. */
    const age = new Float64Array(TRACE_LEN)

    let animFrameId = 0
    function animate() {
      animFrameId = requestAnimationFrame(animate)
      const { traces, pickKey, playhead, slotOf, groupOf, colors, focus, view, geometry, style, trailSeconds, particles, particleReset, cameraReset } = live.current
      const inParticles = geometry === 'particle'

      // A new set of digits: chords start over from nothing; otherwise each keeps its place and glides.
      if (pickKey !== lastPick || traces.n !== n) {
        lastPick = pickKey
        n = Math.min(traces.n, MAX_CHORDS)
        shownSlot = Float32Array.from(slotOf.subarray(0, n))
        arrival = new Float32Array(n)
        vNow = new Float32Array(n)
        sim.resize(n)
        if (inParticles) seedParticles(true)
      }

      // ── Camera between views ──
      // A new view, or its button clicked again, starts a sweep from wherever the camera is. Moving to
      // another view, drags and zooms fade out sooner than the view changes, so the camera swings
      // through about where the old view puts it rather than cutting straight across.
      if (view !== sweepView || cameraReset !== lastCameraReset) {
        sweep = { u: 0, from3d: to3d, fromTs: toTs, offsets: orbit.offsets(), fade: view !== sweepView ? 2 : 1 }
        sweepView = view
        lastCameraReset = cameraReset
      }
      if (sweep.u < 1) {
        sweep.u = Math.min(1, sweep.u + 1 / VIEW_FRAMES)
        const s = ease(sweep.u)
        to3d = sweep.from3d + ((view === '3d' ? 1 : 0) - sweep.from3d) * s
        toTs = sweep.fromTs + ((view === '2d-ts' ? 1 : 0) - sweep.fromTs) * s
        if (sweep.offsets) orbit.setOffsets(sweep.offsets, (1 - s) ** sweep.fade)
      }
      camRadius = CAM_2D.radius + (CAM_3D.radius - CAM_2D.radius) * to3d
      camTheta = CAM_2D.theta + (CAM_3D.theta - CAM_2D.theta) * to3d
      camPhi = CAM_2D.phi + (CAM_3D.phi - CAM_2D.phi) * to3d
      camRadius += (CAM_2D_TS.radius - camRadius) * toTs
      camTheta += (CAM_2D_TS.theta - camTheta) * toTs
      camPhi += (CAM_2D_TS.phi - camPhi) * toTs
      camTargetZ = tsTargetZ() * toTs
      shownPerspective += (clamp01(style.perspective) - shownPerspective) * TRANS_SPEED * 3
      const covered = Math.max(0, Math.min(viewHeight, Math.round(live.current.coveredBottom?.() ?? 0)))
      if (covered !== shownCovered) {
        shownCovered = covered
        shiftLens()
      }
      setLens()
      applyCam()

      // ── Geometry: the chord geometries morph into one another ──
      if (!inParticles) chordGeo = geometry
      morphT = Math.max(-2, Math.min(1, morphT + (geoTarget[chordGeo] - morphT) * 0.05))
      if (morphT >= 0) {
        Object.assign(morph, getPhases(morphT, chordGeo === 'radial'), { pp1: 0, pp2: 0, lp1: 0, lp2: 0 })
      } else if (morphT >= -1) {
        const le = ease(-morphT)
        Object.assign(morph, { p1: 0, p2: 0, pp1: 0, pp2: 0, lp1: le, lp2: le })
      } else {
        const le = ease(2 + morphT)
        Object.assign(morph, { p1: 0, p2: 0, pp1: 1, pp2: 1, lp1: le, lp2: le })
      }
      const depthA = to3d, depthTs = toTs
      // Depth (trails, fills and the time axis) fades in as the camera leaves the 2d time slice, and out as it returns.
      const depth = Math.max(depthA, depthTs)
      outerRing.material.opacity = 0.8
      midRing.material.opacity = morph.p1 * 0.35 * (1 - particleBlend)
      zAxis.material.opacity = depth * 0.45
      ghostRings.forEach((r, i) => { r.material.opacity = depthA * (0.12 - i * 0.03); r.visible = depthA > 0.02 })
      // ── Chords, cursors and trails ──
      const moment = playhead.moment
      // Looping, trails run on through the loop (and, once it has looped, reach back round from the
      // start to the end; pinned, round the pinned window); trail grids count moments played through, so they
      // don't jump back when the playhead does.
      const elapsed = playhead.loop || playhead.pin ? playhead.elapsed : moment
      const showTrace = depth > 0.01
      // Trail samples are spread over the last `trailSeconds` of playback, in moments.
      const step = (trailSeconds * playhead.speed) / TRACE_SEGS
      const by = style.colorBy
      for (let i = 0; i < n; i++) {
        arrival[i] = Math.min(1, arrival[i] + 1 / 30)
        vNow[i] = valenceAt(traces, i, moment) * arrival[i] * arrival[i]
      }

      // ── Particles: entering starts them at the cursors; leaving glides cursors back onto chords ──
      if (inParticles && !wasParticle) seedParticles(false)
      if (particleReset !== lastReset) {
        lastReset = particleReset
        if (inParticles) seedParticles(true)
      }
      wasParticle = inParticles
      particleBlend = inParticles ? 1 : Math.max(0, particleBlend - 1 / PARTICLE_EXIT_FRAMES)
      const pb = ease(particleBlend)
      // Frozen while paused (scrubbing included), so a paused frame holds still.
      if (inParticles && playhead.playing) {
        sim.advance(groupOf, vNow, particles)
        sim.record(elapsed, step, vNow)
      }

      let focusShown = false
      for (let i = 0; i < n; i++) {
        shownSlot[i] += (slotOf[i] - shownSlot[i]) * REORDER_EASE
        const scale = arrival[i] * arrival[i]
        const group = colors[groupOf[i]] ?? BG
        const v = vNow[i]
        chordPoints(shownSlot[i], Math.max(n, 1), v, morph, pts)
        const [rx, ry] = [pts[0] - CENTER, CENTER - pts[1]]
        chordRoot[i * 2] = rx; chordRoot[i * 2 + 1] = ry
        let [dx, dy] = [pts[2] - CENTER, CENTER - pts[3]]
        if (pb > 0) { dx += (sim.x[i] - dx) * pb; dy += (sim.y[i] - dy) * pb }
        if (!inParticles) {
          colour(by.chord, v, group)
          // Valence is zero at the root, so a valence-coloured chord fades in from the background; a
          // group-coloured one is its group's colour all along.
          writeChord(i, rx, ry, dx, dy, by.chord === 'valence' ? bg : rgb, rgb, style.chordWidth)
        }
        dot.pos.set([dx, dy, 0], i * 3)
        colour(by.cursor, v, group)
        dot.col.set(rgb, i * 3)
        if (i === focus) {
          focusGeo.attributes.position.setXYZ(0, dx, dy, 1)
          focusGeo.attributes.position.needsUpdate = true
          focusShown = true
        }

        if (!showTrace) continue
        // The trail: this chord's recent trace, oldest first, receding into the screen and fading out.
        // Sampled on a fixed grid of moments (plus now, at the head) and slid back between grid
        // points, so a trail scrolls rather than being resampled into a new shape every frame.
        let hlen: number
        if (inParticles) {
          // A particle's recorded samples, oldest first, then where it is now. Particles have no
          // root, so the fill (hidden here) collapses onto the trail.
          hlen = sim.count + 1
          for (let k = 0; k < hlen; k++) {
            const head = k === hlen - 1
            const s = sim.slot(k)
            const o = (i * TRACE_LEN + s) * 3
            age[k] = head ? 0 : elapsed / step - sim.grid[s]
            hist[k * 5] = hist[k * 5 + 2] = head ? dx : sim.history[o]
            hist[k * 5 + 1] = hist[k * 5 + 3] = head ? dy : sim.history[o + 1]
            hist[k * 5 + 4] = head ? v : sim.history[o + 2]
          }
        } else {
          const grid = step > 0 ? Math.floor(elapsed / step) : 0
          const frac = step > 0 ? elapsed / step - grid : 0
          hlen = step > 0 ? (playhead.wraps ? TRACE_LEN : Math.min(TRACE_LEN, grid + 2)) : 1
          for (let k = 0; k < hlen; k++) {
            const head = k === hlen - 1
            age[k] = head ? 0 : hlen - 2 - k + frac
            const hv = valenceAt(traces, i, head ? moment : playhead.wrapMoment((grid - (hlen - 2 - k)) * step)) * scale
            chordPoints(shownSlot[i], Math.max(n, 1), hv, morph, pts)
            hist[k * 5] = pts[2] - CENTER; hist[k * 5 + 1] = CENTER - pts[3]
            hist[k * 5 + 2] = pts[0] - CENTER; hist[k * 5 + 3] = CENTER - pts[1]; hist[k * 5 + 4] = hv
          }
        }
        for (let j = 0; j < TRACE_SEGS; j++) {
          const base = (i * TRACE_SEGS + j) * 6
          const fbase = (i * TRACE_SEGS + j) * FILL_VERTS_PER_SEG * 3
          if (j + 1 >= hlen) {
            trace.pos.fill(0, base, base + 6)
            fill.pos.fill(0, fbase, fbase + FILL_VERTS_PER_SEG * 3)
            continue
          }
          const a = j * 5, b = (j + 1) * 5
          const zA = -age[j] * TRACE_Z_STEP, zB = -age[j + 1] * TRACE_Z_STEP
          // Fades by age over the whole trail, so it thins into the background rather than ending abruptly.
          const fadeA = Math.max(0, 1 - age[j] / TRACE_SEGS) ** 2, fadeB = Math.max(0, 1 - age[j + 1] / TRACE_SEGS) ** 2
          // Thousands of segments a frame, so written in place rather than through arrays.
          const tp = trace.pos, tc = trace.col
          tp[base] = hist[a]; tp[base + 1] = hist[a + 1]; tp[base + 2] = zA
          tp[base + 3] = hist[b]; tp[base + 4] = hist[b + 1]; tp[base + 5] = zB
          colour(by.trace, hist[a + 4], group)
          for (let c = 0; c < 3; c++) {
            tc[base + c] = bg[c] + (rgb[c] - bg[c]) * fadeA
            tc[base + 3 + c] = bg[c] + (rgb[c] - bg[c]) * fadeB
          }
          // The fill: a ribbon between the chord's root and its cursor, over time (two triangles).
          const fp = fill.pos, fc = fill.col
          for (let q = 0; q < 6; q++) {
            const h = a + FILL_CORNERS[q]
            fp[fbase + q * 3] = hist[h]; fp[fbase + q * 3 + 1] = hist[h + 1]; fp[fbase + q * 3 + 2] = FILL_LATER[q] ? zB : zA
          }
          colour(by.fill, hist[a + 4], group)
          for (let q = 0; q < 6; q++) {
            const fade = FILL_LATER[q] ? fadeB : fadeA
            for (let c = 0; c < 3; c++) fc[fbase + q * 3 + c] = FILL_IS_ROOT[q] ? bg[c] : bg[c] + (rgb[c] - bg[c]) * fade
          }
        }
      }
      chord.geo.setDrawRange(0, n * CHORD_VERTS)
      dot.geo.setDrawRange(0, n)
      traceGeo.instanceCount = n * TRACE_SEGS
      for (const b of traceBuffers) b.needsUpdate = true
      fill.geo.setDrawRange(0, n * TRACE_SEGS * FILL_VERTS_PER_SEG)
      for (const b of [chord, dot, fill]) {
        b.geo.attributes.position.needsUpdate = true
        b.geo.attributes.color.needsUpdate = true
      }
      focusPoint.visible = focusShown && style.focusRing
      traceLines.visible = showTrace
      fillMesh.visible = showTrace && !inParticles
      chordMesh.visible = !inParticles
      chordMat.opacity = style.opacity.chord
      dotMat.opacity = style.opacity.cursor
      traceMat.opacity = style.opacity.trace * depth
      fillMat.opacity = style.opacity.fill * depth
      // Points shrink with distance but not with the field of view, so they make up for the dolly.
      dotMat.size = style.cursorSize * dolly
      focusMat.size = style.cursorSize * FOCUS_RING_SCALE * dolly
      ringDotsMat.size = RING_DOT_SIZE * dolly
      traceMat.linewidth = style.traceWidth

      renderer.render(scene, camera)
    }
    animFrameId = requestAnimationFrame(animate)

    // ── Picking: a digit's cursor, or its chord while chords are drawn ──
    function pickAt(clientX: number, clientY: number): number | null {
      const rect = canvas.getBoundingClientRect()
      const { geometry, style } = live.current
      const chords = geometry === 'particle' || style.opacity.chord === 0 ? null : { roots: chordRoot, width: style.chordWidth }
      return pickDigit(clientX - rect.left, clientY - rect.top, rect.width, rect.height, camera, n, dot.pos, chords)
    }
    let hovered: number | null = null
    function setHovered(i: number | null) {
      if (i === hovered) return
      hovered = i
      canvas.style.cursor = i === null ? '' : 'pointer'
      live.current.onHover(i)
    }
    // Holding a finger down hovers digits picked at random around it (see JITTER_RADIUS), inside a ring drawn there.
    let jitter: ReturnType<typeof setInterval> | undefined
    let holdAt = { x: 0, y: 0 }
    function onHold(at: { x: number; y: number } | null) {
      const ring = holdRingRef.current!
      if (!at) {
        clearInterval(jitter)
        jitter = undefined
        ring.hidden = true
        setHovered(null)
        return
      }
      holdAt = at
      const rect = wrap.getBoundingClientRect()
      ring.style.transform = `translate(${at.x - rect.left}px, ${at.y - rect.top}px)`
      ring.hidden = false
      if (jitter === undefined) {
        jitterPick()
        jitter = setInterval(jitterPick, JITTER_MS)
      }
    }
    function jitterPick() {
      for (let t = 0; t < JITTER_TRIES; t++) {
        const r = JITTER_RADIUS * Math.sqrt(Math.random()), a = Math.random() * 2 * Math.PI
        const i = pickAt(holdAt.x + r * Math.cos(a), holdAt.y + r * Math.sin(a))
        if (i !== null && i !== hovered) return setHovered(i)
      }
    }

    let pressAt = { x: 0, y: 0 }
    const isClick = (x: number, y: number) => Math.hypot(x - pressAt.x, y - pressAt.y) <= CLICK_SLOP
    function onPointerDown(e: PointerEvent) { pressAt = { x: e.clientX, y: e.clientY } }
    function onCanvasMove(e: MouseEvent) { setHovered(orbit.dragging ? null : pickAt(e.clientX, e.clientY)) }
    function onCanvasLeave() { setHovered(null) }
    function onClick(e: MouseEvent) {
      if (!isClick(e.clientX, e.clientY)) return
      live.current.onFocus(pickAt(e.clientX, e.clientY))
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('mousemove', onCanvasMove)
    canvas.addEventListener('mouseleave', onCanvasLeave)
    canvas.addEventListener('click', onClick)

    // Fit the square authoring space to the panel, whichever side is shorter.
    const resize = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h, false)
      viewWidth = w
      viewHeight = h
      shiftLens()
      traceMat.resolution.set(w, h)
      camera.aspect = w / h
      // Keep the whole circle in view on narrow panels too.
      baseFov = w >= h ? FOV : (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * (h / w)) * 180) / Math.PI
      setLens()
    })
    resize.observe(wrap)

    return () => {
      cancelAnimationFrame(animFrameId)
      resize.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('mousemove', onCanvasMove)
      canvas.removeEventListener('mouseleave', onCanvasLeave)
      canvas.removeEventListener('click', onClick)
      orbit.dispose()
      clearInterval(jitter)
      renderer.dispose()
      for (const g of [chord.geo, dot.geo, traceGeo, fill.geo, focusGeo, ringDotsGeo, ...guides.map((l) => l.geometry)]) g.dispose()
      for (const m of [chordMat, dotMat, traceMat, fillMat, focusMat, ringDotsMat, ...guides.map((l) => l.material)]) m.dispose()
      dotTex.dispose()
      ringTex.dispose()
    }
  }, [])

  return (
    <div ref={wrapRef} className="viz-canvas" style={{ cursor: isOrbiting ? 'grabbing' : 'grab' }}>
      <canvas ref={canvasRef} />
      <div
        ref={holdRingRef}
        hidden
        className="pointer-events-none absolute top-0 left-0 rounded-full border border-white/60 bg-white/5"
        style={{ width: JITTER_RADIUS * 2, height: JITTER_RADIUS * 2, margin: -JITTER_RADIUS }}
      />
    </div>
  )
}
