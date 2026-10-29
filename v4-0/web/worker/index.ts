import { DurableObject } from 'cloudflare:workers'
import { CALIBRATIONS, CLOSE_REPLACED, detectionOf, MAX_PARTICIPANTS, REMOTE_SILENCE_MS, type ParticipantState, type RemoteMessage, type ToRemote, type ToViz, type VizMessage } from '../src/protocol'

/**
 * Serves the pages (the participant remote at /, the visualiser at /viz) from static assets, and hands /ws to a room:
 * one Durable Object per room name (?room=, or "main"), which every page in it connects to.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') return env.ROOM.getByName(url.searchParams.get('room') || 'main').fetch(request)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

/** What each socket is, kept on it so it survives hibernation. */
type Attachment = { role: 'viz' } | { role: 'remote'; id: string; slot: number; evicted?: boolean }

/** Each participant's slot, and when they were last connected, so a slot can go to someone new once all are taken. */
type Slots = Record<string, { slot: number; seen: number }>

/** How often the room looks for remotes gone silent, while any are connected. */
const SILENCE_CHECK_MS = 5_000

/** The largest settings message relayed, well past what the visualiser's settings take. */
const MAX_SETTINGS_BYTES = 64 * 1024

/**
 * A room: participants' remotes send their phone's tilt and touches, which go on to every visualiser; visualisers
 * share their settings, kept here for whichever opens next, and the detection in them goes on to every remote, as do calibrations. Live tilt and touch are only held in memory, as remotes
 * resend them many times a second.
 */
export class Room extends DurableObject<Env> {
  /** By participant id: their tilt and touch now, and when they were last heard from. */
  private live = new Map<string, { valence: number; touching: boolean; heard: number }>()

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const id = url.searchParams.get('id') ?? ''
    if (role !== 'viz' && !(role === 'remote' && /^[\w-]{1,64}$/.test(id))) return new Response('Unknown role or id', { status: 400 })

    const [client, server] = Object.values(new WebSocketPair())
    if (role === 'viz') {
      this.ctx.acceptWebSocket(server, ['viz'])
      server.serializeAttachment({ role: 'viz' } satisfies Attachment)
      const settings = (await this.ctx.storage.get('settings')) ?? null
      send(server, { type: 'hello', settings, participants: this.participants() } satisfies ToViz)
    } else {
      // One socket per participant: a newer one (a reload, another tab) replaces the older.
      for (const old of this.ctx.getWebSockets(id)) old.close(CLOSE_REPLACED, 'Connected again elsewhere')
      const slot = await this.slotFor(id)
      this.ctx.acceptWebSocket(server, ['remote', id])
      server.serializeAttachment({ role: 'remote', id, slot } satisfies Attachment)
      // Tilt carries over from a socket this one replaces; a touch is resent by the remote if it's still held.
      this.live.set(id, { valence: this.live.get(id)?.valence ?? 0, touching: false, heard: Date.now() })
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SILENCE_CHECK_MS)
      send(server, { type: 'welcome', slot, detection: detectionOf(await this.ctx.storage.get('settings')) } satisfies ToRemote)
      this.toViz({ type: 'join', participant: this.participant(id, slot) })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const at = ws.deserializeAttachment() as Attachment
    let msg: RemoteMessage | VizMessage
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (at.role === 'remote') {
      const state = this.live.get(at.id) ?? { valence: 0, touching: false, heard: 0 }
      state.heard = Date.now()
      this.live.set(at.id, state)
      if (msg.type === 'valence' && Number.isFinite(msg.valence)) {
        state.valence = Math.max(-1, Math.min(1, msg.valence))
        this.toViz({ type: 'valence', id: at.id, valence: state.valence })
      } else if (msg.type === 'touch') {
        state.touching = msg.touching === true
        this.toViz({ type: 'touch', id: at.id, touching: state.touching })
      }
    } else if (msg.type === 'settings' && message.length <= MAX_SETTINGS_BYTES) {
      const detection = detectionOf(msg.settings)
      const changed = detection !== detectionOf(await this.ctx.storage.get('settings'))
      await this.ctx.storage.put('settings', msg.settings)
      this.toViz({ type: 'settings', settings: msg.settings, from: String(msg.from), seq: Number(msg.seq) })
      if (changed) this.toRemotes({ type: 'detection', detection })
    } else if (msg.type === 'calibrate' && CALIBRATIONS.includes(msg.set)) {
      this.toRemotes({ type: 'calibrate', set: msg.set })
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.closed(ws)
  }

  async webSocketError(ws: WebSocket) {
    await this.closed(ws)
  }

  /** A socket closed: a participant's leaves, unless it was evicted for silence, which has said so already. */
  private async closed(ws: WebSocket) {
    const at = ws.deserializeAttachment() as Attachment | null
    if (at?.role === 'remote' && !at.evicted) await this.gone(ws)
  }

  /**
   * Closes remotes not heard from for a while: a phone that died or lost its network may never close its socket. Runs
   * while any remote is connected. (After hibernation nothing's been heard, so each remote is given until the next check.)
   */
  async alarm() {
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets('remote')) {
      const at = ws.deserializeAttachment() as Extract<Attachment, { role: 'remote' }>
      const state = this.live.get(at.id)
      if (!state) this.live.set(at.id, { valence: 0, touching: false, heard: now })
      else if (now - state.heard > REMOTE_SILENCE_MS) {
        // It's left now; its socket closing, if that ever comes, says nothing new.
        ws.serializeAttachment({ ...at, evicted: true } satisfies Attachment)
        ws.close(1001, 'Silent')
        await this.gone(ws)
      }
    }
    if (this.connectedRemotes().length) await this.ctx.storage.setAlarm(now + SILENCE_CHECK_MS)
  }

  /** A participant leaves once their last open socket has closed (not when a newer one replaced it). */
  private async gone(ws: WebSocket) {
    const at = ws.deserializeAttachment() as Attachment | null
    if (at?.role !== 'remote') return
    if (this.ctx.getWebSockets(at.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN)) return
    this.live.delete(at.id)
    const slots = (await this.ctx.storage.get<Slots>('slots')) ?? {}
    if (slots[at.id]) {
      slots[at.id].seen = Date.now()
      await this.ctx.storage.put('slots', slots)
    }
    this.toViz({ type: 'leave', id: at.id })
  }

  /**
   * The participant's slot: theirs from before, or the lowest one free; with all taken, the one whose participant
   * was connected longest ago (and isn't now).
   */
  private async slotFor(id: string) {
    const slots = (await this.ctx.storage.get<Slots>('slots')) ?? {}
    if (!slots[id]) {
      const taken = new Set(Object.values(slots).map((s) => s.slot))
      let slot = 0
      while (taken.has(slot)) slot++
      if (slot >= MAX_PARTICIPANTS) {
        const connected = new Set(this.connectedRemotes().map((a) => a.id))
        const [oldest] = Object.entries(slots)
          .filter(([other]) => !connected.has(other))
          .sort((a, b) => a[1].seen - b[1].seen)
        // Everyone's here: share the last slot rather than turn anyone away.
        slot = oldest ? oldest[1].slot : MAX_PARTICIPANTS - 1
        if (oldest) delete slots[oldest[0]]
      }
      slots[id] = { slot, seen: Date.now() }
    }
    slots[id].seen = Date.now()
    await this.ctx.storage.put('slots', slots)
    return slots[id].slot
  }

  private connectedRemotes() {
    return this.ctx
      .getWebSockets('remote')
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => ws.deserializeAttachment() as Extract<Attachment, { role: 'remote' }>)
  }

  private participant(id: string, slot: number): ParticipantState {
    const state = this.live.get(id)
    return { id, slot, valence: state?.valence ?? 0, touching: state?.touching ?? false }
  }

  private participants() {
    return this.connectedRemotes().map(({ id, slot }) => this.participant(id, slot))
  }

  private toViz(msg: ToViz) {
    this.broadcast('viz', msg)
  }

  private toRemotes(msg: ToRemote) {
    this.broadcast('remote', msg)
  }

  private broadcast(tag: 'viz' | 'remote', msg: ToViz | ToRemote) {
    const text = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets(tag)) {
      try {
        ws.send(text)
      } catch {
        // Closing already.
      }
    }
  }
}

function send(ws: WebSocket, msg: ToViz | ToRemote) {
  ws.send(JSON.stringify(msg))
}
