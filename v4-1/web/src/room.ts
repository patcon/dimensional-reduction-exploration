/** A WebSocket to this page's room, reconnecting whenever it drops. */

import { CLOSE_REPLACED } from './protocol'

/** The room this page is in: ?room= on its URL, or the one everyone shares. */
export const ROOM = new URLSearchParams(location.search).get('room') || 'main'

/** Waits between reconnection attempts: doubling, up to this. */
const MAX_RETRY_MS = 5000

export interface RoomSocket {
  /** Sends a message, if connected; dropped otherwise. */
  send(msg: unknown): void
  close(): void
}

/**
 * Connects to the room as `params` say (role, and a remote's id), calling `onMessage` with each message and
 * `onStatus` as it connects and drops. A socket replaced by a newer one for the same participant stays closed.
 */
export function connectRoom(
  params: Record<string, string>,
  onMessage: (msg: unknown) => void,
  onStatus: (status: 'connecting' | 'open' | 'replaced') => void,
): RoomSocket {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${new URLSearchParams({ room: ROOM, ...params })}`
  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 250
  let timer: ReturnType<typeof setTimeout> | undefined
  const open = () => {
    onStatus('connecting')
    ws = new WebSocket(url)
    ws.onopen = () => {
      retryMs = 250
      onStatus('open')
    }
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string))
      } catch {
        // Not ours.
      }
    }
    ws.onclose = (e) => {
      if (closed) return
      if (e.code === CLOSE_REPLACED) {
        closed = true
        onStatus('replaced')
        return
      }
      onStatus('connecting')
      timer = setTimeout(open, retryMs)
      retryMs = Math.min(MAX_RETRY_MS, retryMs * 2)
    }
  }
  open()
  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    },
    close() {
      closed = true
      clearTimeout(timer)
      ws?.close()
    },
  }
}
