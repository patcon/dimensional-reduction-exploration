import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { RGB } from '../palette'
import type { Playhead } from '../playhead'
import { valenceAt, type Traces } from '../signal'
import { MAX_CHORDS, type GeoMode, type ViewMode, type VizStyle } from '../vizSettings'

// Ported from the reaction canvas's valence cross-section (plugins/valenceCrossSection in
// patcon/polislike-partykit-reaction-canvas, itself from valence-onboarding-v3.html): each
// participant is a chord, rooted at the centre and displaced by its valence, laid out in one
// of several geometries and seen in three views. Here the valence comes from reading a digit's
// pixels rather than a live cursor, so a chord's whole past is known: trails are drawn from the
// trace itself, which also lets them follow a scrub backwards. Added: group colouring (by
// digit or Leiden cluster), chord order, and a reaction-canvas geometry ("cursors").

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
const DOT_SIZE = 10
const TRANS_SPEED = 0.04
/** How fast chords glide to a new slot, or cursors to a new spot, per frame. */
const REORDER_EASE = 0.08
const BG: RGB = [15, 15, 14]

const COLORS = { pos: [80, 255, 140] as RGB, neg: [255, 80, 60] as RGB, neutral: BG }

// The reaction canvas's anchors (0–100, y down), as in its voteRegion.ts DEFAULT_ANCHORS.
const ANCHORS = { positive: { x: 95, y: 5 }, negative: { x: 5, y: 95 }, neutral: { x: 95, y: 95 } }

// Where each anchor's label goes: just outside its corner of the canvas (agree, disagree, pass).
const LABEL_CORNERS = [
  { x: 100, y: 0, shift: 'translate(-100%, -130%)' },
  { x: 0, y: 100, shift: 'translate(0, 30%)' },
  { x: 100, y: 100, shift: 'translate(-100%, 30%)' },
]

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

/** The reaction canvas, 0–100 with y down, laid over the circle's square. */
function canvasX(x: number) { return CENTER - R + (x / 100) * 2 * R }
function canvasY(y: number) { return CENTER - R + (y / 100) * 2 * R }

/**
 * On the reaction canvas, every point on one chord has the same valence (from its voteRegion.ts):
 * A(v) on an edge beside the pass corner, B(v) on the agree–disagree diagonal. A cursor sits at
 * `spot` along it. out = [Ax, Ay, Bx, By, cursorX, cursorY], in canvas space.
 */
function cursorPoints(v: number, spot: number, out: Float64Array) {
  const { positive: p, negative: q, neutral: z } = ANCHORS
  const a = v >= 0 ? v : -v
  const end = v >= 0 ? p : q
  const ax = z.x + (end.x - z.x) * a, ay = z.y + (end.y - z.y) * a
  const b = (v + 1) / 2
  const bx = q.x + (p.x - q.x) * b, by = q.y + (p.y - q.y) * b
  out[0] = canvasX(ax); out[1] = canvasY(ay); out[2] = canvasX(bx); out[3] = canvasY(by)
  out[4] = canvasX(ax + (bx - ax) * spot); out[5] = canvasY(ay + (by - ay) * spot)
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
  /** Where along its valence chord each participant's cursor sits, in the cursors geometry. */
  spots: Float32Array
  groupOf: Int32Array
  colors: RGB[]
  focus: number | null
  view: ViewMode
  geometry: GeoMode
  style: VizStyle
  /** How far back trails reach, in pixels read. */
  trailPixels: number
}

export function ChordViz(props: ChordVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<(HTMLDivElement | null)[]>([])
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
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(53.13, 1, 0.1, 10000)

    // ── Scene objects ──
    const outerRing = makeRingLine(R, 0, 0x383835)
    const midRing = makeRingLine(R_MID, 0, 0x2a2a28)
    const ghostRings = [-120, -240, -360].map((z) => makeRingLine(R, z, 0x1e1e1c))
    const zAxis = makeLine([[0, 0], [0, 0]], 0, 0x404040, false)
    zAxis.geometry.attributes.position.setZ(1, -420)
    // The reaction canvas, for the cursors geometry: its square and the agree/disagree/pass triangle.
    const toWorld = (x: number, y: number): [number, number] => [canvasX(x) - CENTER, CENTER - canvasY(y)]
    const square = makeLine([toWorld(0, 0), toWorld(100, 0), toWorld(100, 100), toWorld(0, 100)], 0, 0x383835, true)
    const { positive, negative, neutral } = ANCHORS
    const triangle = makeLine([positive, negative, neutral].map((a) => toWorld(a.x, a.y)), 0, 0x2a2a28, true)
    const labelPoint = new THREE.Vector3()
    const guides = [outerRing, midRing, ...ghostRings, zAxis, square, triangle]
    guides.forEach((g) => scene.add(g))
    const ringDotsArr = new Float32Array(48 * 3)
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; ringDotsArr[i * 3] = Math.cos(a) * R; ringDotsArr[i * 3 + 1] = Math.sin(a) * R }
    const ringDotsGeo = new THREE.BufferGeometry()
    ringDotsGeo.setAttribute('position', new THREE.BufferAttribute(ringDotsArr, 3))
    const ringDotsMat = new THREE.PointsMaterial({ color: 0x3a3935, size: 3, sizeAttenuation: true, transparent: true })
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
    const chord = buffer(MAX_CHORDS * 2)
    const chordMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    const chordLines = new THREE.LineSegments(chord.geo, chordMat)
    chordLines.renderOrder = 7
    chordLines.frustumCulled = false
    scene.add(chordLines)

    const dotTex = dotTexture(false)
    const dot = buffer(MAX_CHORDS)
    const dotMat = new THREE.PointsMaterial({ vertexColors: true, size: DOT_SIZE, sizeAttenuation: true, transparent: true, depthWrite: false, map: dotTex, alphaTest: 0.05 })
    const dotPoints = new THREE.Points(dot.geo, dotMat)
    dotPoints.renderOrder = 10
    dotPoints.frustumCulled = false
    scene.add(dotPoints)

    // The followed digit: a ring around its cursor.
    const ringTex = dotTexture(true)
    const focusGeo = new THREE.BufferGeometry()
    focusGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    const focusMat = new THREE.PointsMaterial({ color: 0xffffff, size: DOT_SIZE * 2.6, sizeAttenuation: true, transparent: true, depthTest: false, map: ringTex })
    const focusPoint = new THREE.Points(focusGeo, focusMat)
    focusPoint.renderOrder = 11
    focusPoint.frustumCulled = false
    scene.add(focusPoint)

    const trace = buffer(MAX_CHORDS * TRACE_SEGS * 2)
    const traceMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    const traceLines = new THREE.LineSegments(trace.geo, traceMat)
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
    // Side on, far enough back to see a whole trail, looking at its middle; from the left, so time
    // runs left to right with now at the right edge, like a strip chart.
    const CAM_2D_TS = { radius: 820, theta: -Math.PI / 2, phi: 0, targetZ: -TRACE_DEPTH / 2 }
    const CAM_3D = { radius: 560, theta: Math.PI / 5, phi: Math.PI / 9 }
    let transT = 0, transTts = 0
    let orbitDTheta = 0, orbitDPhi = 0, orbitDRadius = 0
    // Opens on whatever view is chosen, without animating there from 2d.
    if (live.current.view === '3d') transT = 1
    if (live.current.view === '2d-ts') transTts = 1

    function applyCam() {
      const theta = camTheta + orbitDTheta
      const phi = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPhi + orbitDPhi))
      const effR = camRadius + orbitDRadius
      camera.position.set(effR * Math.sin(theta) * Math.cos(phi), effR * Math.sin(phi), camTargetZ + effR * Math.cos(theta) * Math.cos(phi))
      camera.lookAt(0, 0, camTargetZ)
      camera.up.set(0, 1, 0)
    }

    // ── Per-participant animation: chords grow in, and glide to new slots / spots ──
    let n = 0
    let shownSlot = new Float32Array(0)
    let shownSpot = new Float32Array(0)
    let arrival = new Float32Array(0)
    let lastPick: unknown = undefined
    const geoTarget: Record<GeoMode, number> = { radial: 1, diametric: 0, linear: -1, parallel: -2, cursors: 0 }
    let morphT = geoTarget[live.current.geometry === 'cursors' ? 'diametric' : live.current.geometry]
    let chordGeo: GeoMode = live.current.geometry === 'cursors' ? 'diametric' : live.current.geometry
    let cursorsT = live.current.geometry === 'cursors' ? 1 : 0

    const morph: Morph = { p1: 0, p2: 0, pp1: 0, pp2: 0, lp1: 0, lp2: 0 }
    const cp = new Float64Array(4)
    const kp = new Float64Array(6)
    // Root, tip and cursor of one chord at valence v, blended between chord geometry and reaction canvas.
    const pts = new Float64Array(6)
    function points(slot: number, spot: number, v: number) {
      chordPoints(slot, Math.max(n, 1), v, morph, cp)
      const c = ease(cursorsT)
      if (c <= 0) {
        pts[0] = cp[0]; pts[1] = cp[1]; pts[2] = cp[2]; pts[3] = cp[3]; pts[4] = cp[2]; pts[5] = cp[3]
        return
      }
      cursorPoints(v, spot, kp)
      pts[0] = cp[0] + (kp[0] - cp[0]) * c; pts[1] = cp[1] + (kp[1] - cp[1]) * c
      pts[2] = cp[2] + (kp[2] - cp[2]) * c; pts[3] = cp[3] + (kp[3] - cp[3]) * c
      pts[4] = cp[2] + (kp[4] - cp[2]) * c; pts[5] = cp[3] + (kp[5] - cp[3]) * c
    }

    const rgb = [0, 0, 0]
    // An element's colour at valence v, by valence or by group, into rgb (0–1).
    function colour(by: 'valence' | 'group', v: number, group: RGB) {
      if (by === 'valence') valenceRGB(v, rgb, 0)
      else for (let c = 0; c < 3; c++) rgb[c] = group[c] / 255
    }
    const bg = BG.map((c) => c / 255)
    const hist = new Float64Array(TRACE_LEN * 5)

    let animFrameId = 0
    function animate() {
      animFrameId = requestAnimationFrame(animate)
      const { traces, pickKey, playhead, slotOf, spots, groupOf, colors, focus, view, geometry, style, trailPixels } = live.current

      // A new set of digits: chords start over from nothing; otherwise each keeps its place and glides.
      if (pickKey !== lastPick || traces.n !== n) {
        lastPick = pickKey
        n = Math.min(traces.n, MAX_CHORDS)
        shownSlot = Float32Array.from(slotOf.subarray(0, n))
        shownSpot = Float32Array.from(spots.subarray(0, n))
        arrival = new Float32Array(n)
      }

      // ── Camera between views ──
      transT = clamp01(transT + ((view === '3d' ? 1 : 0) - transT) * TRANS_SPEED * 3)
      if (view !== '3d') {
        orbitDRadius += (0 - orbitDRadius) * TRANS_SPEED * 3
        orbitDTheta += (0 - orbitDTheta) * TRANS_SPEED * 3
        orbitDPhi += (0 - orbitDPhi) * TRANS_SPEED * 3
      }
      transTts = clamp01(transTts + ((view === '2d-ts' ? 1 : 0) - transTts) * TRANS_SPEED * 3)
      const et3 = ease(transT)
      camRadius = CAM_2D.radius + (CAM_3D.radius - CAM_2D.radius) * et3
      camTheta = CAM_2D.theta + (CAM_3D.theta - CAM_2D.theta) * et3
      camPhi = CAM_2D.phi + (CAM_3D.phi - CAM_2D.phi) * et3
      if (transTts > 0) {
        const et = ease(transTts)
        camRadius += (CAM_2D_TS.radius - camRadius) * et
        camTheta += (CAM_2D_TS.theta - camTheta) * et
        camPhi += (CAM_2D_TS.phi - camPhi) * et
      }
      camTargetZ = CAM_2D_TS.targetZ * ease(transTts)
      applyCam()

      // ── Geometry: the chord geometries morph into one another; the reaction canvas fades over them ──
      if (geometry !== 'cursors') chordGeo = geometry
      cursorsT = clamp01(cursorsT + ((geometry === 'cursors' ? 1 : 0) - cursorsT) * 0.05)
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
      const depthA = ease(transT), depthTs = ease(transTts)
      const cEase = ease(cursorsT), circle = 1 - cEase
      outerRing.material.opacity = 0.8 * circle
      ringDotsMat.opacity = circle
      midRing.material.opacity = morph.p1 * 0.35 * circle
      zAxis.material.opacity = Math.max(depthA, depthTs) * 0.45
      ghostRings.forEach((r, i) => { r.material.opacity = depthA * (0.12 - i * 0.03); r.visible = depthA > 0.02 })
      square.material.opacity = 0.8 * cEase
      triangle.material.opacity = 0.5 * cEase
      // Agree / disagree / pass labels by their corners of the canvas, wherever the camera sees them.
      labelRefs.current.forEach((el, i) => {
        if (!el) return
        const [x, y] = toWorld(LABEL_CORNERS[i].x, LABEL_CORNERS[i].y)
        const p = labelPoint.set(x, y, 0).project(camera)
        el.style.opacity = String(cEase * (1 - depthTs))
        el.style.transform = `translate(${((p.x + 1) / 2) * wrap.clientWidth}px, ${((1 - p.y) / 2) * wrap.clientHeight}px) ${LABEL_CORNERS[i].shift}`
      })

      // ── Chords, cursors and trails ──
      const moment = playhead.moment
      const showTrace = view === '2d-ts' || view === '3d'
      const step = trailPixels / TRACE_SEGS
      const by = style.colorBy
      let focusShown = false
      for (let i = 0; i < n; i++) {
        shownSlot[i] += (slotOf[i] - shownSlot[i]) * REORDER_EASE
        shownSpot[i] += (spots[i] - shownSpot[i]) * REORDER_EASE
        arrival[i] = Math.min(1, arrival[i] + 1 / 30)
        const scale = arrival[i] * arrival[i]
        const group = colors[groupOf[i]] ?? BG
        const v = valenceAt(traces, i, moment) * scale
        points(shownSlot[i], shownSpot[i], v)
        const [rx, ry, tx, ty, dx, dy] = [pts[0] - CENTER, CENTER - pts[1], pts[2] - CENTER, CENTER - pts[3], pts[4] - CENTER, CENTER - pts[5]]
        chord.pos.set([rx, ry, 0, tx, ty, 0], i * 6)
        colour(by.chord, v, group)
        chord.col.set([bg[0], bg[1], bg[2], rgb[0], rgb[1], rgb[2]], i * 6)
        dot.pos.set([dx, dy, 0], i * 3)
        colour(by.cursor, v, group)
        dot.col.set(rgb, i * 3)
        if (i === focus) {
          focusGeo.attributes.position.setXYZ(0, dx, dy, 1)
          focusGeo.attributes.position.needsUpdate = true
          focusShown = true
        }

        if (!showTrace) continue
        // The trail: this chord's last `trailPixels` of trace, oldest first, receding into the screen.
        const hlen = step > 0 ? Math.min(TRACE_LEN, Math.floor(moment / step) + 1) : 1
        for (let k = 0; k < hlen; k++) {
          const hv = valenceAt(traces, i, moment - (hlen - 1 - k) * step) * scale
          points(shownSlot[i], shownSpot[i], hv)
          hist[k * 5] = pts[4] - CENTER; hist[k * 5 + 1] = CENTER - pts[5]
          hist[k * 5 + 2] = pts[0] - CENTER; hist[k * 5 + 3] = CENTER - pts[1]; hist[k * 5 + 4] = hv
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
          const zA = -(hlen - 1 - j) * TRACE_Z_STEP, zB = -(hlen - 2 - j) * TRACE_Z_STEP
          const fadeA = j / (hlen - 1), fadeB = (j + 1) / (hlen - 1)
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
      chord.geo.setDrawRange(0, n * 2)
      dot.geo.setDrawRange(0, n)
      trace.geo.setDrawRange(0, n * TRACE_SEGS * 2)
      fill.geo.setDrawRange(0, n * TRACE_SEGS * FILL_VERTS_PER_SEG)
      for (const b of [chord, dot, trace, fill]) {
        b.geo.attributes.position.needsUpdate = true
        b.geo.attributes.color.needsUpdate = true
      }
      focusPoint.visible = focusShown
      traceLines.visible = showTrace
      fillMesh.visible = showTrace
      chordMat.opacity = style.opacity.chord
      dotMat.opacity = style.opacity.cursor
      traceMat.opacity = style.opacity.trace
      fillMat.opacity = style.opacity.fill

      renderer.render(scene, camera)
    }
    animFrameId = requestAnimationFrame(animate)

    // ── Orbit (3d only): drag to turn, wheel or pinch to zoom ──
    let dragging = false, dragLast = { x: 0, y: 0 }, dtBase = 0, dpBase = 0
    const canOrbit = () => live.current.view === '3d' && transT > 0.7
    function onMouseDown(e: MouseEvent) {
      if (!canOrbit()) return
      dragging = true; dragLast = { x: e.clientX, y: e.clientY }
      dtBase = orbitDTheta; dpBase = orbitDPhi
      setIsOrbiting(true)
      e.preventDefault()
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return
      orbitDTheta = dtBase - (e.clientX - dragLast.x) * 0.009
      orbitDPhi = dpBase + (e.clientY - dragLast.y) * 0.009
    }
    function onMouseUp() { dragging = false; setIsOrbiting(false) }
    function onWheel(e: WheelEvent) {
      if (live.current.view !== '3d') return
      orbitDRadius = Math.max(250 - camRadius, Math.min(1400 - camRadius, orbitDRadius + e.deltaY * 0.6))
      e.preventDefault()
    }
    let lastTouchDist = 0, touchBase = { dt: 0, dp: 0 }, touchStart = { x: 0, y: 0 }
    function onTouchStart(e: TouchEvent) {
      if (!canOrbit()) return
      if (e.touches.length === 1) {
        dragging = true
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        touchBase = { dt: orbitDTheta, dp: orbitDPhi }
      } else if (e.touches.length === 2) {
        dragging = false
        lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      }
      e.preventDefault()
    }
    function onTouchMove(e: TouchEvent) {
      if (!canOrbit()) return
      if (e.touches.length === 1 && dragging) {
        orbitDTheta = touchBase.dt - (e.touches[0].clientX - touchStart.x) * 0.009
        orbitDPhi = touchBase.dp + (e.touches[0].clientY - touchStart.y) * 0.009
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        const eff = Math.max(250, Math.min(1400, (camRadius + orbitDRadius) * (lastTouchDist / d)))
        orbitDRadius = eff - camRadius
        lastTouchDist = d
      }
      e.preventDefault()
    }
    function onTouchEnd() { dragging = false }
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)

    // Fit the square authoring space to the panel, whichever side is shorter.
    const resize = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // Keep the whole circle in view on narrow panels too.
      camera.fov = w >= h ? 53.13 : (2 * Math.atan(Math.tan((53.13 * Math.PI) / 360) * (h / w)) * 180) / Math.PI
      camera.updateProjectionMatrix()
    })
    resize.observe(wrap)

    return () => {
      cancelAnimationFrame(animFrameId)
      resize.disconnect()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      renderer.dispose()
      for (const g of [chord.geo, dot.geo, trace.geo, fill.geo, focusGeo, ringDotsGeo, ...guides.map((l) => l.geometry)]) g.dispose()
      for (const m of [chordMat, dotMat, traceMat, fillMat, focusMat, ringDotsMat, ...guides.map((l) => l.material)]) m.dispose()
      dotTex.dispose()
      ringTex.dispose()
    }
  }, [])

  return (
    <div ref={wrapRef} className="viz-canvas" style={{ cursor: isOrbiting ? 'grabbing' : props.view === '3d' ? 'grab' : 'default' }}>
      <canvas ref={canvasRef} />
      {['agree', 'disagree', 'pass'].map((label, i) => (
        <div key={label} ref={(el) => void (labelRefs.current[i] = el)} className={`viz-anchor viz-anchor-${label}`}>
          {label}
        </div>
      ))}
    </div>
  )
}
