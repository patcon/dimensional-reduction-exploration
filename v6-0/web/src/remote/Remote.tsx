import { useEffect, useRef, useState } from 'react'
import { gradientRGB, rgbCss, type RGB } from '../palette'
import { DEFAULT_GRADIENT, participantColor, type Detection, type Gradient, type RemoteMessage, type ToRemote } from '../protocol'
import { connectRoom, type RoomSocket } from '../room'
import { canWakeLock, useWakeLock } from '../useWakeLock'
import { calibrated, NO_SETPOINTS, upOf, valenceOf, type Setpoints, type Vec } from './valence'

/**
 * The participant remote: the phone joins the crowd, flipped to the beat. Turned one way it's +1, the other −1, and
 * between as it turns, as the room's detection says: face up or down (flip), upright or upside down (invert), or turned
 * as a steering wheel is, screen to you (spin); or between the ends set high and set low gave it. The screen shows
 * its facing in the room's gradient. Its facing goes to the room many times a second, where it's grouped with the
 * phones flipping like it; a finger anywhere on the screen rings this phone on the visualiser.
 */

/** Tilt is sent at most this often, and at least every KEEPALIVE_MS while it holds still; pings go as often, regardless. */
const SEND_MS = 50
const KEEPALIVE_MS = 1000
/** Tilt unchanged by more than this isn't worth sending again before the keepalive. */
const SEND_EPSILON = 0.004
/** With no orientation reading after this long, the phone isn't giving any. */
const NO_SENSOR_MS = 2500

const ID_KEY = 'phone-flip-crowd:id'
const SETPOINTS_KEY = 'phone-flip-crowd:setpoints'

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

/** This phone's setpoints for each detection, kept across reloads. */
function storedSetpoints(): Partial<Record<Detection, Setpoints>> {
  try {
    return JSON.parse(localStorage.getItem(SETPOINTS_KEY) ?? '{}')
  } catch {
    return {}
  }
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
      const now = upOf(e.beta, e.gamma)
      if (now === null) return
      up.current = now
      const v = valenceOf(detection, setpoints.current[detection] ?? NO_SETPOINTS, now)
      if (v === null) return
      valence = v
      setNoSensor(false)
      // Its facing, in the room's gradient.
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
        <h1 className="text-2xl font-semibold">Join the crowd</h1>
        <ol className="max-w-sm list-decimal space-y-2 pl-5 text-left text-white/75">
          <li>The big screen keeps a beat, four steps to a bar: 1 e &amp; a.</li>
          <li>Flip your phone to it, between its +1 and −1 (your screen will say which way), in any rhythm you like.</li>
          <li>You’ll be grouped with the phones flipping like yours, and heard as their chord. Touch your screen to find yourself.</li>
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
