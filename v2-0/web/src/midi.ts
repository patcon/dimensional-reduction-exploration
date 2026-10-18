import type { PairType } from './types.ts'

/** What a MIDI control can drive: one of the three forces, or the optimiser's speed. */
export type MidiTarget = PairType | 'speed'

export const MIDI_TARGETS: MidiTarget[] = ['nb', 'mn', 'fp', 'speed']

/**
 * A pitch-bend wheel on one channel (springs back to centre, so its force stops when released),
 * or a control change (CC) such as a fader (stays where it's left).
 */
export type Binding = { kind: 'pitchbend'; channel: number } | { kind: 'cc'; channel: number; controller: number }

export type Bindings = Record<MidiTarget, Binding | null>

export const NO_BINDINGS: Bindings = { nb: null, mn: null, fp: null, speed: null }

/** A decoded message: which control moved, and its position as u in [-1, 1] with centre at 0. */
export interface ControlMessage {
  binding: Binding
  u: number
}

/**
 * Decode a raw MIDI message, or null if it isn't pitch bend or CC.
 * Pitch bend is 14-bit with centre 8192; CC is 7-bit with centre 64. Each half maps
 * separately so both the centre and the ends land exactly on 0 and ±1.
 */
export function decode(data: ArrayLike<number>): ControlMessage | null {
  if (data.length < 3) return null
  const type = data[0] & 0xf0
  const channel = data[0] & 0x0f
  if (type === 0xe0) {
    const v = data[1] | (data[2] << 7)
    return { binding: { kind: 'pitchbend', channel }, u: v >= 8192 ? (v - 8192) / 8191 : (v - 8192) / 8192 }
  }
  if (type === 0xb0) {
    const v = data[2]
    return { binding: { kind: 'cc', channel, controller: data[1] }, u: v >= 64 ? (v - 64) / 63 : (v - 64) / 64 }
  }
  return null
}

export function sameBinding(a: Binding, b: Binding) {
  return a.kind === b.kind && a.channel === b.channel && (a.kind === 'pitchbend' || a.controller === (b as typeof a).controller)
}

/** A binding as people write it, with 1-based channels. */
export function describeBinding(b: Binding | null) {
  if (!b) return '—'
  return b.kind === 'pitchbend' ? `pitch bend · ch ${b.channel + 1}` : `CC ${b.controller} · ch ${b.channel + 1}`
}
