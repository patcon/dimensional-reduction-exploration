/** The visualiser's view of its room: the participants there now, their tilt and touch, and the settings it shares. */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { completeSettings, LOCAL_SETTINGS, type Settings } from './presets'
import { MAX_PARTICIPANTS, type ParticipantState, type ToViz, type VizMessage } from './protocol'
import { connectRoom, type RoomSocket } from './room'

export interface Participant {
  id: string
  slot: number
  touching: boolean
}

/**
 * The participants in the room, by slot. Tilt changes many times a second, so it's read from `valence` as it's needed
 * rather than through React; who's here and who's touching are a snapshot, `roster`, that re-renders.
 */
export class LiveRoom {
  /** Each slot's tilt now, −1 … +1. */
  readonly valence = new Float32Array(MAX_PARTICIPANTS)
  roster: Participant[] = []
  /** Whether the room has said hello: until it has, settings aren't shared, so as not to override the room's. */
  connected = false
  private byId = new Map<string, Participant>()
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getSnapshot = () => this.roster

  private changed() {
    this.roster = [...this.byId.values()].sort((a, b) => a.slot - b.slot)
    this.listeners.forEach((fn) => fn())
  }

  private put(p: ParticipantState) {
    this.byId.set(p.id, { id: p.id, slot: p.slot, touching: p.touching })
    this.valence[p.slot] = p.valence
  }

  /** Takes in a message from the room; settings are handed back for the page to apply. */
  receive(msg: ToViz) {
    switch (msg.type) {
      case 'hello':
        this.byId.clear()
        msg.participants.forEach((p) => this.put(p))
        this.connected = true
        this.changed()
        break
      case 'join':
        this.put(msg.participant)
        this.changed()
        break
      case 'leave':
        this.byId.delete(msg.id)
        this.changed()
        break
      case 'valence': {
        const p = this.byId.get(msg.id)
        if (p) this.valence[p.slot] = msg.valence
        break
      }
      case 'touch': {
        const p = this.byId.get(msg.id)
        if (!p || p.touching === msg.touching) break
        this.byId.set(p.id, { ...p, touching: msg.touching })
        this.changed()
        break
      }
    }
  }

  disconnected() {
    if (!this.connected) return
    this.connected = false
    this.byId.clear()
    this.changed()
  }
}

/** This page, to tell its own settings from others' as the room relays them. */
const SELF = Math.random().toString(36).slice(2)

/** What's shared of the settings: all of them but this page's own (whether its screen stays awake, say). */
function shared(settings: Settings) {
  const rest: Partial<Settings> = { ...settings }
  for (const key of LOCAL_SETTINGS) delete rest[key]
  return JSON.stringify(rest)
}

/** This page's own settings, kept as they are when the room's come in. */
const localOf = (settings: Settings) => Object.fromEntries(LOCAL_SETTINGS.map((key) => [key, settings[key]])) as Partial<Settings>

/**
 * Connects the visualiser to its room: the participants there, and the settings, shared with every other visualiser
 * in it (a phone's, say, to change the big screen's). A visualiser opening takes the room's settings, if it has any.
 *
 * Every visualiser hears every settings change, its own included, in the one order the room saw them in. While its
 * own are on their way it ignores others' (they came before its own, which will win), then takes whatever comes
 * after, so all of them end up with the same settings even when two change them at once.
 */
export function useLiveRoom(settings: Settings, setSettings: (settings: Settings) => void) {
  const room = useMemo(() => new LiveRoom(), [])
  const roster = useSyncExternalStore(room.subscribe, room.getSnapshot)
  const socket = useRef<RoomSocket | null>(null)
  const latest = useRef(settings)
  useEffect(() => {
    latest.current = settings
  })
  /** The settings last sent or taken, as shared. */
  const synced = useRef<string | null>(null)
  /**
   * Settings taken from the room that haven't reached this page's state yet: until they do, nothing's sent, as what
   * the page has is older (the room's roster can re-render before its settings land).
   */
  const taking = useRef<string | null>(null)
  const sent = useRef(0)
  /** The last of this visualiser's own changes heard back. */
  const heard = useRef(0)

  useEffect(() => {
    const take = (incoming: unknown) => {
      const next = completeSettings({ ...(incoming as Partial<Settings>), ...localOf(latest.current) })
      const json = shared(next)
      synced.current = json
      if (json === shared(latest.current)) return
      taking.current = json
      setSettings(next)
    }
    const ws = connectRoom(
      { role: 'viz' },
      (raw) => {
        const msg = raw as ToViz
        if (msg.type === 'settings') {
          if (msg.from === SELF) heard.current = msg.seq
          else if (heard.current >= sent.current) take(msg.settings)
          return
        }
        if (msg.type === 'hello') {
          heard.current = sent.current
          // The room's settings, or none yet: then this visualiser's are sent, as they differ from nothing.
          if (msg.settings) take(msg.settings)
          else synced.current = null
        }
        room.receive(msg)
      },
      (status) => status !== 'open' && room.disconnected(),
    )
    socket.current = ws
    return () => {
      socket.current = null
      ws.close()
    }
  }, [room, setSettings])

  // Changes made here go to the room once it has said hello.
  const connected = room.connected
  useEffect(() => {
    if (!connected) return
    const json = shared(settings)
    if (taking.current !== null) {
      if (json === taking.current) taking.current = null
      return
    }
    if (json === synced.current) return
    synced.current = json
    socket.current?.send({ type: 'settings', settings: JSON.parse(json), from: SELF, seq: ++sent.current } satisfies VizMessage)
  }, [settings, connected, roster])

  return { room, roster, connected }
}
