import type { PairType } from './types.ts'

/** A switch for one force's sign, used when that force's control reads 0 at the bottom. */
export type SignTarget = 'nbSign' | 'mnSign' | 'fpSign'

export const SIGN_TARGETS: Record<PairType, SignTarget> = { nb: 'nbSign', mn: 'mnSign', fp: 'fpSign' }

/** What a MIDI control can drive: one of the three forces, a force's sign, or the optimiser's speed. */
export type MidiTarget = PairType | 'speed' | SignTarget

export const MIDI_TARGETS: MidiTarget[] = ['nb', 'mn', 'fp', 'speed', 'nbSign', 'mnSign', 'fpSign']

/**
 * Where a force's control reads 0. centre: up attracts, down repels (a pitch bend, or a
 * fader parked at half way). bottom: the control sets only the strength, from 0 at the
 * bottom, and a sign switch (a toggle button) chooses attract or repel.
 */
export type Zero = 'centre' | 'bottom'

export type Zeros = Record<PairType, Zero>

export const CENTRE_ZEROS: Zeros = { nb: 'centre', mn: 'centre', fp: 'centre' }

/**
 * A pitch-bend wheel on one channel (springs back to centre, so its force stops when released),
 * or a control change (CC) such as a fader (stays where it's left).
 */
export type Binding = { kind: 'pitchbend'; channel: number } | { kind: 'cc'; channel: number; controller: number }

export type Bindings = Record<MidiTarget, Binding | null>

export const NO_BINDINGS: Bindings = { nb: null, mn: null, fp: null, speed: null, nbSign: null, mnSign: null, fpSign: null }

/**
 * A decoded message: which control moved, its position as u in [-1, 1] with centre at 0,
 * and as travel in [0, 1] from the bottom.
 */
export interface ControlMessage {
  binding: Binding
  u: number
  travel: number
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
    return { binding: { kind: 'pitchbend', channel }, u: v >= 8192 ? (v - 8192) / 8191 : (v - 8192) / 8192, travel: v / 16383 }
  }
  if (type === 0xb0) {
    const v = data[2]
    return { binding: { kind: 'cc', channel, controller: data[1] }, u: v >= 64 ? (v - 64) / 63 : (v - 64) / 64, travel: v / 127 }
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

/**
 * Where a fader sits, as a percentage of its travel, for a force at control value u: what
 * MIDI Surf shows on its faders. centre: the CC value decode() reads back as u (0 is about
 * 50%). bottom: the strength alone (0 is 0%); the sign switch sets attract or repel.
 */
export function faderPercent(u: number, zero: Zero) {
  if (zero === 'bottom') return Math.min(1, Math.abs(u)) * 100
  const v = u >= 0 ? 64 + Math.min(1, u) * 63 : 64 + Math.max(-1, u) * 64
  return (v / 127) * 100
}
