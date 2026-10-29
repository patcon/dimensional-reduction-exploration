import { useEffect, useRef, useState } from 'react'
import { gradientRGB, rgbCss, type RGB } from '../palette'
import { DEFAULT_GRADIENT, participantColor, type Calibration, type Detection, type Gradient, type RemoteMessage, type ToRemote } from '../protocol'
import { connectRoom, type RoomSocket } from '../room'
import { canWakeLock, useWakeLock } from '../useWakeLock'

/**
 * The participant remote: the phone is a pen. Turned one way it's ink (+1), the other paper (−1), halfway between, as
 * the room's detection says: face up or down (flip), upright or upside down (invert), or turned as a steering wheel
 * is, screen to you (spin). The screen shows it as the visualiser draws digits, in the room's gradient. Its tilt goes to the room many times a second, drawn on the
 * visualiser along the playhead's path; a finger anywhere on the screen rings this participant's cursor there.
 */

/** Tilt is sent at most this often, and at least every KEEPALIVE_MS while it holds still; pings go as often, regardless. */
const SEND_MS = 50
const KEEPALIVE_MS = 1000
/** Tilt unchanged by more than this isn't worth sending again before the keepalive. */
const SEND_EPSILON = 0.004
/** With no orientation reading after this long, the phone isn't giving any. */
const NO_SENSOR_MS = 2500

const ID_KEY = 'mnist-valence-participation:id'
const SETPOINTS_KEY = 'mnist-valence-participation:setpoints'

/** This phone's participant id, kept across reloads so it keeps its slot and colour. */
function participantId() {
  const make = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id) localStorage.setItem(ID_KEY, (id = make()))
    return id
  } catch {
    return make()
  }
}

type Permission = 'needed' | 'granted' | 'denied' | 'insecure'

/** iOS asks for permission to read orientation, from a tap; other browsers don't, though they need a secure page. */
type OrientationWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

function initialPermission(): Permission {
  if (!window.isSecureContext) return 'insecure'
  const ctor = window.DeviceOrientationEvent as OrientationWithPermission | undefined
  return typeof ctor?.requestPermission === 'function' ? 'needed' : 'granted'
}

const RAD = Math.PI / 180
/** Spin can't be read from a phone this near flat (the screen's plane this near level). */
const SPIN_FLAT = 0.3

/** A direction in the phone's own axes: x to its right edge, y to its top, z out of its screen. */
type Vec = [number, number, number]

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const angle = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/** Which way is up, in the phone's own axes, or null without a reading. */
function upOf(e: DeviceOrientationEvent): Vec | null {
  if (e.beta === null || e.gamma === null) return null
  const b = e.beta * RAD, g = e.gamma * RAD
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]
}

/**
 * Valence from which way is up, −1–1, as the detection reads it, or null when it can't tell. Flip: the screen's
 * normal, upwards (face up +1, edge on 0, face down −1), as the reaction canvas's horizontal mode. Invert: the phone's
 * top edge, upwards (upright +1, on its side 0, upside down −1), and towards 0 as it leans back. Spin: a steering wheel,
 * the screen to you: how far it's turned round in the screen's plane, however far it leans, evenly with the angle
 * (upright +1, landscape either way 0, upside down −1). Lying near flat, there's no telling, so it holds.
 */
function detected(detection: Detection, [x, y, z]: Vec) {
  if (detection === 'flip') return z
  if (detection === 'invert') return y
  if (Math.hypot(x, y) < SPIN_FLAT) return null
  return 1 - Math.abs(Math.atan2(-x, y)) / (Math.PI / 2)
}

/**
 * Where this phone is −1 (low) and +1 (high), as which way is up then, set by calibrating; null for the detection's
 * own. Once either is set, valence runs from one to the other along whatever turn joins them, whichever way the phone
 * is held, rather than as the detection reads it: the detection's own end stands in for one that isn't set.
 */
type Setpoints = { low: Vec | null; high: Vec | null }
const NO_SETPOINTS: Setpoints = { low: null, high: null }
/** Each detection's own ends, as which way is up: face down and face up, or upside down and upright. */
const ENDS: Record<Detection, { low: Vec; high: Vec }> = {
  flip: { low: [0, 0, -1], high: [0, 0, 1] },
  invert: { low: [0, -1, 0], high: [0, 1, 0] },
  spin: { low: [0, -1, 0], high: [0, 1, 0] },
}
/** Setpoints closer than this (radians, about 6°) would swing from −1 to +1 on the slightest turn: they're ignored. */
const MIN_TURN = 0.1
/** Ends this near opposite are joined by every turn alike, so valence goes by how far from each the phone is. */
const OPPOSITE = Math.PI - 0.05
/** Turned this far out of the turn between the setpoints, how far along it the phone is can't be told: it holds. */
const OFF_TURN = 0.3

/** This phone's setpoints for each detection, kept across reloads. */
function storedSetpoints(): Partial<Record<Detection, Setpoints>> {
  try {
    return JSON.parse(localStorage.getItem(SETPOINTS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** The setpoints after calibrating, with `up` which way is up now; unchanged if there's no reading, or they'd be too close. */
function calibrated(points: Setpoints, set: Calibration, detection: Detection, up: Vec | null): Setpoints {
  if (set === 'reset') return NO_SETPOINTS
  if (up === null) return points
  const other = set === 'high' ? (points.low ?? ENDS[detection].low) : (points.high ?? ENDS[detection].high)
  if (angle(up, other) < MIN_TURN) return points
  return set === 'high' ? { ...points, high: up } : { ...points, low: up }
}

/** Valence with `up` which way is up, from the setpoints if any are set, else as the detection reads it. */
function valenceOf(detection: Detection, points: Setpoints, up: Vec) {
  if (!points.low && !points.high) return detected(detection, up)
  const a = points.low ?? ENDS[detection].low
  const b = points.high ?? ENDS[detection].high
  const ab = angle(a, b)
  let t: number
  if (ab > OPPOSITE) {
    const da = angle(up, a)
    t = da / (da + angle(up, b))
  } else {
    // Along the turn from a to b: the angle round from a, in the plane they share.
    const ab2 = dot(a, b)
    const e: Vec = [b[0] - ab2 * a[0], b[1] - ab2 * a[1], b[2] - ab2 * a[2]]
    const len = Math.hypot(...e)
    const across: Vec = [e[0] / len, e[1] / len, e[2] / len]
    const u = dot(up, a), w = dot(up, across)
    if (Math.hypot(u, w) < OFF_TURN) return null
    let phi = Math.atan2(w, u)
    // Past either end, whichever it's nearer, so past b stays +1 rather than wrapping round to −1.
    if (phi < -Math.PI + ab / 2) phi += 2 * Math.PI
    t = phi / ab
  }
  return Math.max(-1, Math.min(1, -1 + 2 * t))
}

/** What to do, as the remote says it once joined. */
const HOW: Record<Detection, string> = {
  flip: 'Face up for +1, face down for −1',
  invert: 'Upright for +1, upside down for −1',
  spin: 'Screen to you, steer upright for +1, upside down for −1',
}

export function Remote() {
  const [joined, setJoined] = useState(false)
  const [permission, setPermission] = useState<Permission>(initialPermission)
  const [status, setStatus] = useState<'connecting' | 'open' | 'replaced'>('connecting')
  const [slot, setSlot] = useState<number | null>(null)
  const [touching, setTouching] = useState(false)
  const [noSensor, setNoSensor] = useState(false)
  const [detection, setDetection] = useState<Detection>('flip')
  const screenRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const socket = useRef<RoomSocket | null>(null)
  /** Which way is up now, and the detection it's read in, for a calibration to take. */
  const up = useRef<Vec | null>(null)
  const upDetection = useRef<Detection>(detection)
  const setpoints = useRef(storedSetpoints())
  /** The room's gradient, for the screen's colour; read as tilt comes in, so changing it doesn't restart the reading. */
  const gradient = useRef<Gradient>(DEFAULT_GRADIENT)
  useWakeLock(joined)

  const join = async () => {
    const ctor = window.DeviceOrientationEvent as OrientationWithPermission | undefined
    if (permission === 'needed' && ctor?.requestPermission) {
      try {
        setPermission((await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied')
      } catch {
        setPermission('denied')
      }
    }
    setJoined(true)
  }

  // Joined, connect to the room as this participant.
  useEffect(() => {
    if (!joined) return
    const room = connectRoom(
      { role: 'remote', id: participantId() },
      (msg) => {
        const m = msg as ToRemote
        if (m.type === 'welcome') setSlot(m.slot)
        if (m.type === 'welcome' || m.type === 'phone') {
          setDetection(m.phone.detection)
          gradient.current = m.phone.gradient
        }
        if (m.type === 'calibrate') {
          const d = upDetection.current
          setpoints.current = { ...setpoints.current, [d]: calibrated(setpoints.current[d] ?? NO_SETPOINTS, m.set, d, up.current) }
          try {
            localStorage.setItem(SETPOINTS_KEY, JSON.stringify(setpoints.current))
          } catch {
            // Kept until the page reloads.
          }
        }
      },
      setStatus,
    )
    socket.current = room
    // Still here, tilting or not: a room closes remotes it hasn't heard from in a while.
    const ping = setInterval(() => room.send({ type: 'ping' } satisfies RemoteMessage), KEEPALIVE_MS)
    return () => {
      clearInterval(ping)
      socket.current = null
      room.close()
    }
  }, [joined])

  // Tilt → the screen's shade, and the room.
  useEffect(() => {
    if (!joined || permission !== 'granted') return
    up.current = null
    upDetection.current = detection
    let valence: number | null = null
    let sent: number | null = null
    let sentAt = 0
    const send = (force: boolean) => {
      if (valence === null || !socket.current) return
      const now = performance.now()
      if (!force && (now - sentAt < SEND_MS || (sent !== null && Math.abs(valence - sent) < SEND_EPSILON))) return
      socket.current.send({ type: 'valence', valence } satisfies RemoteMessage)
      sent = valence
      sentAt = now
    }
    const onOrientation = (e: DeviceOrientationEvent) => {
      const now = upOf(e)
      if (now === null) return
      up.current = now
      const v = valenceOf(detection, setpoints.current[detection] ?? NO_SETPOINTS, now)
      if (v === null) return
      valence = v
      setNoSensor(false)
      // As the visualiser draws this participant's digit, in the room's gradient.
      if (screenRef.current) screenRef.current.style.backgroundColor = rgbCss(gradientRGB(gradient.current, v).map(Math.round) as RGB)
      if (readoutRef.current) readoutRef.current.textContent = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
      send(false)
    }
    window.addEventListener('deviceorientation', onOrientation)
    const noSensorTimer = setTimeout(() => valence === null && setNoSensor(true), NO_SENSOR_MS)
    const keepalive = setInterval(() => send(performance.now() - sentAt >= KEEPALIVE_MS), KEEPALIVE_MS / 4)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      clearTimeout(noSensorTimer)
      clearInterval(keepalive)
    }
  }, [joined, permission, detection])

  // Touch: any finger down anywhere, until the last lifts.
  const fingers = useRef(new Set<number>())
  const touch = (down: boolean, pointer: number) => {
    if (down) fingers.current.add(pointer)
    else fingers.current.delete(pointer)
    const now = fingers.current.size > 0
    if (now === touching) return
    setTouching(now)
    socket.current?.send({ type: 'touch', touching: now } satisfies RemoteMessage)
  }
  // A remote that's lost its socket has lost its touch too, as far as the room knows.
  useEffect(() => {
    if (status === 'open' && touching) socket.current?.send({ type: 'touch', touching: true } satisfies RemoteMessage)
    // Only on reconnecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const color = slot === null ? '#888' : participantColor(slot)

  if (!joined)
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-black p-8 text-center text-white">
        <h1 className="text-2xl font-semibold">Draw a digit</h1>
        <ol className="max-w-sm list-decimal space-y-2 pl-5 text-left text-white/75">
          <li>The big screen reads a drawing row by row, top to bottom, to the beat of a metronome.</li>
          <li>Turn your phone between its minimum (−1) and maximum (+1) to trace a digit out row by row: your screen will say which way.</li>
          <li>Your cursor moves to the digits your drawing looks like. Touch your screen to highlight it.</li>
        </ol>
        <button className="rounded-full bg-white px-8 py-3 text-lg font-semibold text-black active:scale-95" onClick={join}>
          Join
        </button>
        {permission === 'insecure' && <p className="max-w-sm text-sm text-amber-300">Tilt needs a secure (https) page; this one isn't.</p>}
      </main>
    )

  return (
    <div
      ref={screenRef}
      className="fixed inset-0 touch-none bg-[rgb(128_128_128)] select-none"
      onPointerDown={(e) => touch(true, e.pointerId)}
      onPointerUp={(e) => touch(false, e.pointerId)}
      onPointerCancel={(e) => touch(false, e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* This participant's colour, as their cursor's ring on the visualiser: around the edge, and filling in while touched. */}
      <div className="pointer-events-none absolute inset-3 rounded-[2rem] border-[6px]" style={{ borderColor: color }} />
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 size-40 -translate-1/2 rounded-full border-[10px] transition-[opacity,scale] duration-150"
        style={{ borderColor: color, opacity: touching ? 1 : 0, scale: touching ? 1 : 0.6 }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-1 text-sm text-white mix-blend-difference">
        <span ref={readoutRef} className="font-mono text-2xl tabular-nums">
          ·
        </span>
        <span>{HOW[detection]}</span>
        <span>
          {status === 'open' ? 'connected' : status === 'replaced' ? 'opened on another tab or phone' : 'connecting…'}
          {joined && !canWakeLock && ' · screen may sleep'}
        </span>
        {permission === 'denied' && <span>Tilt permission was refused; reload to ask again.</span>}
        {permission === 'insecure' && <span>Tilt needs a secure (https) page.</span>}
        {noSensor && permission === 'granted' && <span>No tilt readings from this phone.</span>}
      </div>
    </div>
  )
}
