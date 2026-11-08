import type { Binding, Bindings, Zeros } from './midi'
import { MIDI_SURF_LINKS } from './midiSurfLinks'

/**
 * A ready-made MIDI Surf page and the bindings that match it here. The pages are written by
 * scripts/midi-surf-pages.py; its CC numbers and channels must match these.
 */
export interface MidiSurfSetup {
  id: keyof typeof MIDI_SURF_LINKS
  title: string
  description: string
  /** Opens MIDI Surf and offers to import the page. */
  link: string
  /** A QR code of the link, for opening it on a phone. */
  qr: string
  /** The page itself, for MIDI Surf's New page → Import page. */
  file: string
  bindings: Pick<Bindings, 'nb' | 'mn' | 'fp' | 'nbSign' | 'mnSign' | 'fpSign'>
  zeros: Zeros
}

const cc = (controller: number): Binding => ({ kind: 'cc', channel: 0, controller })
const bend = (channel: number): Binding => ({ kind: 'pitchbend', channel })
const page = (id: MidiSurfSetup['id']) => ({
  id,
  link: MIDI_SURF_LINKS[id],
  qr: `${import.meta.env.BASE_URL}midi-surf/${id}.png`,
  file: `${import.meta.env.BASE_URL}midi-surf/${id}.json`,
})
const NO_SIGNS = { nbSign: null, mnSign: null, fpSign: null }

export const MIDI_SURF_SETUPS: MidiSurfSetup[] = [
  {
    ...page('centre-faders'),
    title: 'PaCMAP 🎚️',
    description: 'Three faders parked half way. Up attracts, down repels, and each stays where you leave it.',
    bindings: { nb: cc(20), mn: cc(21), fp: cc(22), ...NO_SIGNS },
    zeros: { nb: 'centre', mn: 'centre', fp: 'centre' },
  },
  {
    ...page('bottom-faders'),
    title: 'PaCMAP 🎚️±',
    description: 'Three faders starting at the bottom, which is no force, so up is stronger. The 🧲± button under each flips it between attract and repel.',
    bindings: { nb: cc(23), mn: cc(24), fp: cc(25), nbSign: cc(26), mnSign: cc(27), fpSign: cc(28) },
    zeros: { nb: 'bottom', mn: 'bottom', fp: 'bottom' },
  },
  {
    ...page('pitch-bends'),
    title: 'PaCMAP 🎯',
    description: 'Three pitch-bend strips that spring back to the centre, so a force stops the moment you let go.',
    bindings: { nb: bend(0), mn: bend(1), fp: bend(2), ...NO_SIGNS },
    zeros: { nb: 'centre', mn: 'centre', fp: 'centre' },
  },
]
