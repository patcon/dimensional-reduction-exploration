import { useEffect, useRef, useState } from 'react'
import { participantColor, type RemoteMessage, type ToRemote } from '../protocol'
import { connectRoom, type RoomSocket } from '../room'
import { canWakeLock, useWakeLock } from '../useWakeLock'

/**
 * The participant remote: the phone is a pen. Held face up it's ink (+1), face down paper (−1), edge on between; the
 * screen shows it, black face up to white face down. Its tilt goes to the room many times a second, drawn on the
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

/** Face up +1, edge on (either way) 0, face down −1: the screen's normal, upwards. As the reaction canvas's horizontal mode. */
function tiltValence(e: DeviceOrientationEvent) {
  if (e.beta === null || e.gamma === null) return null
  const v = Math.cos((e.beta * Math.PI) / 180) * Math.cos((e.gamma * Math.PI) / 180)
  return Math.max(-1, Math.min(1, v))
}

export function Remote() {
  const [joined, setJoined] = useState(false)
  const [permission, setPermission] = useState<Permission>(initialPermission)
  const [status, setStatus] = useState<'connecting' | 'open' | 'replaced'>('connecting')
  const [slot, setSlot] = useState<number | null>(null)
  const [touching, setTouching] = useState(false)
  const [noSensor, setNoSensor] = useState(false)
  const screenRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const socket = useRef<RoomSocket | null>(null)
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
      const v = tiltValence(e)
      if (v === null) return
      valence = v
      setNoSensor(false)
      // Ink is black, paper white: face up black, face down white.
      const shade = Math.round(((1 - v) / 2) * 255)
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
  }, [joined, permission])

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
        <h1 className="text-2xl font-semibold">Be a digit</h1>
        <p className="max-w-sm text-white/75">
          Your phone is a pen. Face up is ink, face down is paper. As the playhead sweeps across the big screen, tilt to draw a digit, and
          watch your cursor find the digits like it. Touch the screen to light up your cursor.
        </p>
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
