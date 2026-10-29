/**
 * What the room (the worker's Durable Object), the participant remotes (/) and the visualisers (/viz) say to each
 * other over their WebSockets, as JSON. Shared by the worker and both pages.
 */

/** Participants taking part at once; each holds a slot, which sets their colour and where their drawing is kept. */
export const MAX_PARTICIPANTS = 50

/** One colour per slot, bright against the visualiser's dark background, and unlike the digits' hues. */
export const PARTICIPANT_COLORS = [
  '#ff3df5', '#00e5ff', '#ffe600', '#7cff3d', '#ff8a00', '#b18cff',
  '#ff4f7b', '#3dffc5', '#ffffff', '#4f8bff', '#c6ff00', '#ff9ecb',
]

export const participantColor = (slot: number) => PARTICIPANT_COLORS[slot % PARTICIPANT_COLORS.length]

/** A participant as the visualisers see them. */
export interface ParticipantState {
  id: string
  slot: number
  /** Their phone's tilt, as the room's detection reads it: −1 paper … +1 ink. */
  valence: number
  /** A finger is on their screen. */
  touching: boolean
}

/** A remote → the room. Remotes send something at least every second (a ping, with no tilt to send), to show they're still there. */
export type RemoteMessage = { type: 'valence'; valence: number } | { type: 'touch'; touching: boolean } | { type: 'ping' }

/** A remote heard nothing from for this long has gone (its phone died, or lost its network), whether its socket has closed or not. */
export const REMOTE_SILENCE_MS = 15_000

/**
 * Calibrating every phone at once, from a visualiser: each takes where it's turned now as its +1 (high) or its −1
 * (low), or goes back to its detection's own range (reset). Each phone keeps its own, for each detection.
 */
export type Calibration = 'high' | 'low' | 'reset'
export const CALIBRATIONS: readonly Calibration[] = ['high', 'low', 'reset']

/**
 * A visualiser → the room: its settings, tagged with who sent them and their count, to tell its own echo; or a
 * calibration, passed on to every phone.
 */
export type VizMessage = { type: 'settings'; settings: unknown; from: string; seq: number } | { type: 'calibrate'; set: Calibration }

/**
 * Which way of turning a phone reads as valence, set for the whole room by its visualisers: the axis it turns about.
 * Flip: face up +1, face down −1. Invert: upright +1, upside down −1. Spin, as a steering wheel with
 * the screen to you: upright +1, landscape 0, upside down −1.
 */
export type Detection = 'flip' | 'invert' | 'spin'
export const DETECTIONS: readonly Detection[] = ['flip', 'invert', 'spin']

/** The detection in a visualiser's settings, or flip for none (or one from a version before there was a choice). */
export function detectionOf(settings: unknown): Detection {
  const d = (settings as { detection?: unknown } | null)?.detection
  return DETECTIONS.includes(d as Detection) ? (d as Detection) : 'flip'
}

/** The room → a remote: its slot on joining, the room's detection then and whenever it changes, and calibrations. */
export type ToRemote =
  | { type: 'welcome'; slot: number; detection: Detection }
  | { type: 'detection'; detection: Detection }
  | { type: 'calibrate'; set: Calibration }

/** The room → a visualiser. Settings go to every visualiser, the one that sent them included. */
export type ToViz =
  | { type: 'hello'; settings: unknown | null; participants: ParticipantState[] }
  | { type: 'join'; participant: ParticipantState }
  | { type: 'leave'; id: string }
  | { type: 'valence'; id: string; valence: number }
  | { type: 'touch'; id: string; touching: boolean }
  | { type: 'settings'; settings: unknown; from: string; seq: number }

/** Closing a remote's socket because the same participant connected again elsewhere: it shouldn't reconnect. */
export const CLOSE_REPLACED = 4000
