import { useEffect, useRef, useState } from 'react'
import { participantColor, type Calibration, type Detection, type RemoteMessage, type ToRemote } from '../protocol'
import { connectRoom, type RoomSocket } from '../room'
import { canWakeLock, useWakeLock } from '../useWakeLock'

/**
 * The participant remote: the phone is a pen. Turned one way it's ink (+1), the other paper (−1), halfway between, as
 * the room's detection says: face up or down (flip), upright or upside down (invert), or turned as a steering wheel
 * is, screen to you (spin). The screen shows it as the visualiser draws digits, white for ink on black paper. Its tilt goes to the room many times a second, drawn on the
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
const RANGES_KEY = 'mnist-valence-participation:ranges'

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

/**
 * Valence from orientation, −1–1, or null without a reading. Flip: the screen's normal, upwards (face up +1, edge on 0,
 * face down −1), as the reaction canvas's horizontal mode. Invert: the phone's top edge, upwards (upright +1, on its
 * side 0, upside down −1), and towards 0 as it leans back. Spin: a steering wheel, the screen to you: how far it's turned
 * round in the screen's plane, however far it leans, evenly with the angle (upright +1, landscape either way 0, upside
 * down −1). Lying near flat, there's no telling, so it holds.
 */
function detector(detection: Detection) {
  return (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return null
    let v: number
    if (detection === 'flip') v = Math.cos(e.beta * RAD) * Math.cos(e.gamma * RAD)
    else if (detection === 'invert') v = Math.sin(e.beta * RAD)
    else {
      // How far up the phone's top and right edges point: its roll is the angle between them.
      const up = Math.sin(e.beta * RAD)
      const right = -Math.sin(e.gamma * RAD) * Math.cos(e.beta * RAD)
      if (Math.hypot(up, right) < SPIN_FLAT) return null
      v = 1 - Math.abs(Math.atan2(-right, up)) / (Math.PI / 2)
    }
    return Math.max(-1, Math.min(1, v))
  }
}

/** Where this phone reads −1 and +1, in its detection's own terms: by default, −1 and +1 themselves. */
type Range = { low: number; high: number }
const FULL_RANGE: Range = { low: -1, high: 1 }
/** A range narrower than this would make the slightest turn swing from paper to ink: such a calibration is ignored. */
const MIN_SPAN = 0.1

/** This phone's range for each detection, set by calibrating, kept across reloads. */
function storedRanges(): Partial<Record<Detection, Range>> {
  try {
    return JSON.parse(localStorage.getItem(RANGES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** The range after calibrating, with `raw` the reading now; unchanged if there's no reading, or the range would be too narrow. */
function calibrated(range: Range, set: Calibration, raw: number | null): Range {
  if (set === 'reset') return FULL_RANGE
  if (raw === null) return range
  const next = set === 'high' ? { ...range, high: raw } : { ...range, low: raw }
  return Math.abs(next.high - next.low) < MIN_SPAN ? range : next
}

/** A reading stretched from its range to −1–1, clamped. */
const inRange = (raw: number, { low, high }: Range) => Math.max(-1, Math.min(1, -1 + (2 * (raw - low)) / (high - low)))

/** What to do, as the remote says it once joined. */
const HOW: Record<Detection, string> = {
  flip: 'Face up to draw, face down for a gap',
  invert: 'Upright to draw, upside down for a gap',
  spin: 'Screen to you, steer upright to draw, upside down for a gap',
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
  /** The latest reading, before calibration, and the detection it's in, for a calibration to take. */
  const raw = useRef<number | null>(null)
  const rawDetection = useRef<Detection>(detection)
  const ranges = useRef(storedRanges())
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
        if (m.type === 'welcome' || m.type === 'detection') setDetection(m.detection)
        if (m.type === 'calibrate') {
          const d = rawDetection.current
          ranges.current = { ...ranges.current, [d]: calibrated(ranges.current[d] ?? FULL_RANGE, m.set, raw.current) }
          try {
            localStorage.setItem(RANGES_KEY, JSON.stringify(ranges.current))
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
    const tiltValence = detector(detection)
    raw.current = null
    rawDetection.current = detection
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
      const r = tiltValence(e)
      if (r === null) return
      raw.current = r
      const v = inRange(r, ranges.current[detection] ?? FULL_RANGE)
      valence = v
      setNoSensor(false)
      // As the visualiser draws this participant's digit: ink white, paper black.
      const shade = Math.round((v + 1) * 127.5)
      if (screenRef.current) screenRef.current.style.backgroundColor = `rgb(${shade} ${shade} ${shade})`
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
          <li>Turn your phone one way to draw, the other to leave a gap, to trace a digit out row by row: your screen will say which way.</li>
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
