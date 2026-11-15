import { useEffect, useRef, useState } from 'react'
import { gradientRGB, rgbCss, type RGB } from '../palette'
import { DEFAULT_GRADIENT, participantColor, type Detection, type Gradient, type RemoteMessage, type TiltDetection, type ToRemote } from '../protocol'
import { connectRoom, type RoomSocket } from '../room'
import { canWakeLock, useWakeLock } from '../useWakeLock'
import { calibrated, NO_SETPOINTS, NO_TOUCH_POINTS, TOUCH_ENDS, touchCalibrated, touchValence, upOf, valenceOf, type Setpoints, type TouchPoints, type Vec } from './valence'

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

const TOUCH_POINTS_KEY = 'phone-flip-crowd:touch-points'

/** This phone's setpoints for each tilt detection, kept across reloads. */
function storedSetpoints(): Partial<Record<TiltDetection, Setpoints>> {
  try {
    return JSON.parse(localStorage.getItem(SETPOINTS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Where this phone's high and low are for touch, kept across reloads. */
function storedTouchPoints(): TouchPoints {
  try {
    return { ...NO_TOUCH_POINTS, ...JSON.parse(localStorage.getItem(TOUCH_POINTS_KEY) ?? '{}') }
  } catch {
    return NO_TOUCH_POINTS
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Kept until the page reloads.
  }
}

/** What to do, as the remote says it once joined. */
const HOW: Record<Detection, string> = {
  flip: 'Face up for +1, face down for −1',
  invert: 'Upright for +1, upside down for −1',
  spin: 'Screen to you, steer upright for +1, upside down for −1',
  touch: 'Touch higher for +1, lower for −1',
}

export function Remote() {
  const [joined, setJoined] = useState(false)
  const [permission, setPermission] = useState<Permission>(initialPermission)
  const [status, setStatus] = useState<'connecting' | 'open' | 'replaced'>('connecting')
  const [slot, setSlot] = useState<number | null>(null)
  const [touching, setTouching] = useState(false)
  const [noSensor, setNoSensor] = useState(false)
  const [detection, setDetection] = useState<Detection>('flip')
  const touchMode = detection === 'touch'
  const screenRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const fingerRef = useRef<HTMLDivElement>(null)
  const socket = useRef<RoomSocket | null>(null)
  /** Which way is up now, and the detection it's read in, for a calibration to take. */
  const up = useRef<Vec | null>(null)
  const upDetection = useRef<Detection>(detection)
  const setpoints = useRef(storedSetpoints())
  /** Touch: where the finger is (or last was), as a share of the screen's height down from the top, and the setpoints. */
  const fingerY = useRef<number | null>(null)
  const [touchPoints, setTouchPoints] = useState(storedTouchPoints)
  const touchPointsRef = useRef(touchPoints)
  /** The room's gradient, for the screen's colour; read as readings come in, so changing it doesn't restart the reading. */
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
          if (d === 'touch') {
            // Where the finger is, or last was.
            const next = touchCalibrated(touchPointsRef.current, m.set, fingerY.current)
            touchPointsRef.current = next
            setTouchPoints(next)
            store(TOUCH_POINTS_KEY, next)
          } else {
            setpoints.current = { ...setpoints.current, [d]: calibrated(setpoints.current[d] ?? NO_SETPOINTS, m.set, d, up.current) }
            store(SETPOINTS_KEY, setpoints.current)
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

  // What's read, however it's read: shown on the screen, in the room's gradient, and sent to the room (at most every
  // SEND_MS, and again every KEEPALIVE_MS while it holds).
  const out = useRef({ valence: null as number | null, sent: null as number | null, sentAt: 0 })
  const send = (force: boolean) => {
    const o = out.current
    if (o.valence === null || !socket.current) return
    const now = performance.now()
    if (!force && (now - o.sentAt < SEND_MS || (o.sent !== null && Math.abs(o.valence - o.sent) < SEND_EPSILON))) return
    socket.current.send({ type: 'valence', valence: o.valence } satisfies RemoteMessage)
    o.sent = o.valence
    o.sentAt = now
  }
  const report = (v: number) => {
    out.current.valence = v
    if (screenRef.current) screenRef.current.style.backgroundColor = rgbCss(gradientRGB(gradient.current, v).map(Math.round) as RGB)
    if (readoutRef.current) readoutRef.current.textContent = `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
    send(false)
  }
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })
  useEffect(() => {
    if (!joined) return
    const keepalive = setInterval(() => sendRef.current(performance.now() - out.current.sentAt >= KEEPALIVE_MS), KEEPALIVE_MS / 4)
    return () => clearInterval(keepalive)
  }, [joined])

  // Tilt → valence, in the tilt detections.
  useEffect(() => {
    upDetection.current = detection
    if (!joined || permission !== 'granted' || detection === 'touch') return
    up.current = null
    let heard = false
    const onOrientation = (e: DeviceOrientationEvent) => {
      const now = upOf(e.beta, e.gamma)
      if (now === null) return
      up.current = now
      const v = valenceOf(detection, setpoints.current[detection] ?? NO_SETPOINTS, now)
      if (v === null) return
      heard = true
      setNoSensor(false)
      reportRef.current(v)
    }
    window.addEventListener('deviceorientation', onOrientation)
    const noSensorTimer = setTimeout(() => !heard && setNoSensor(true), NO_SENSOR_MS)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      clearTimeout(noSensorTimer)
    }
  }, [joined, permission, detection])
  const reportRef = useRef(report)
  useEffect(() => {
    reportRef.current = report
  })

  // Touch → valence, in touch detection: the finger's height on the screen, held where it last was once it lifts.
  const onFinger = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!touchMode || (e.type === 'pointermove' && !fingers.current.has(e.pointerId))) return
    const y = Math.max(0, Math.min(1, e.clientY / window.innerHeight))
    fingerY.current = y
    if (fingerRef.current) fingerRef.current.style.top = `${y * 100}%`
    report(touchValence(touchPointsRef.current, y))
  }
  // Coming into touch, read from where the finger last was (or the middle).
  useEffect(() => {
    if (!joined || !touchMode) return
    reportRef.current(touchValence(touchPointsRef.current, fingerY.current ?? ((touchPointsRef.current.low ?? TOUCH_ENDS.low) + (touchPointsRef.current.high ?? TOUCH_ENDS.high)) / 2))
  }, [joined, touchMode, touchPoints])

  // Touch, the highlight: any finger down anywhere, until the last lifts. In touch detection a finger is the reading,
  // so it doesn't also ring this phone on the visualiser.
  const fingers = useRef(new Set<number>())
  const touch = (down: boolean, pointer: number) => {
    if (down) fingers.current.add(pointer)
    else fingers.current.delete(pointer)
    const now = fingers.current.size > 0 && !touchMode
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
  const high = touchPoints.high ?? TOUCH_ENDS.high, low = touchPoints.low ?? TOUCH_ENDS.low

  if (!joined)
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-black p-8 text-center text-white">
        <h1 className="text-2xl font-semibold">Join the crowd</h1>
        <ol className="max-w-sm list-decimal space-y-2 pl-5 text-left text-white/75">
          <li>The big screen keeps a beat, four steps to a bar: 1 e &amp; a.</li>
          <li>Flip your phone to it (or move your finger up and down it), between +1 and −1, in any rhythm you like: your screen will say how.</li>
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
      onPointerDown={(e) => {
        touch(true, e.pointerId)
        onFinger(e)
      }}
      onPointerMove={onFinger}
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
      {touchMode && (
        <>
          {/* Where +1 and −1 are, and the finger. */}
          {[
            { at: high, label: '+1' },
            { at: low, label: '−1' },
          ].map(({ at, label }) => (
            <div key={label} className="pointer-events-none absolute inset-x-6 border-t-2 border-dashed border-white mix-blend-difference" style={{ top: `${at * 100}%` }}>
              <span className="absolute -top-6 left-0 font-mono text-sm text-white">{label}</span>
            </div>
          ))}
          <div ref={fingerRef} className="pointer-events-none absolute inset-x-0 h-0 border-t-4 mix-blend-difference" style={{ borderColor: 'white', top: fingerY.current === null ? '-10%' : `${fingerY.current * 100}%` }} />
        </>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-1 text-sm text-white mix-blend-difference">
        <span ref={readoutRef} className="font-mono text-2xl tabular-nums">
          ·
        </span>
        <span>{HOW[detection]}</span>
        <span>
          {status === 'open' ? 'connected' : status === 'replaced' ? 'opened on another tab or phone' : 'connecting…'}
          {joined && !canWakeLock && ' · screen may sleep'}
        </span>
        {!touchMode && permission === 'denied' && <span>Tilt permission was refused; reload to ask again.</span>}
        {!touchMode && permission === 'insecure' && <span>Tilt needs a secure (https) page.</span>}
        {!touchMode && noSensor && permission === 'granted' && <span>No tilt readings from this phone.</span>}
      </div>
    </div>
  )
}
