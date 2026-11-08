// MIDI messages decode to the right control and position.
import { decode, describeBinding, faderPercent, sameBinding } from '../src/midi.ts'

let failures = 0
const expect = (ok: boolean, what: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const bend = (channel: number, v: number) => [0xe0 | channel, v & 0x7f, v >> 7]
const cc = (channel: number, controller: number, v: number) => [0xb0 | channel, controller, v]

expect(decode(bend(0, 8192))?.u === 0, 'pitch bend centre (8192) is 0')
expect(decode(bend(0, 16383))?.u === 1, 'pitch bend top (16383) is +1')
expect(decode(bend(0, 0))?.u === -1, 'pitch bend bottom (0) is -1')
expect(decode(bend(3, 8192))?.binding.channel === 3, 'pitch bend keeps its channel')
expect(describeBinding(decode(bend(3, 0))!.binding) === 'pitch bend · ch 4', 'channels are shown 1-based')

expect(decode(cc(0, 7, 64))?.u === 0, 'CC centre (64) is 0')
expect(decode(cc(0, 7, 127))?.u === 1, 'CC top (127) is +1')
expect(decode(cc(0, 7, 0))?.u === -1, 'CC bottom (0) is -1')
expect(decode(cc(0, 7, 0))?.travel === 0 && decode(cc(0, 7, 127))?.travel === 1, 'CC travel runs 0 to 1 from the bottom')
expect(decode(bend(0, 0))?.travel === 0 && decode(bend(0, 16383))?.travel === 1, 'pitch bend travel runs 0 to 1 from the bottom')
const m = decode(cc(2, 21, 100))!
expect(m.binding.kind === 'cc' && m.binding.controller === 21 && m.binding.channel === 2, 'CC keeps its controller and channel')

expect(decode([0x90, 60, 100]) === null, 'note-on is ignored')
expect(decode([0xb0, 7]) === null, 'a truncated message is ignored')

expect(sameBinding(decode(cc(0, 7, 1))!.binding, decode(cc(0, 7, 90))!.binding), 'same CC matches whatever its value')
expect(!sameBinding(decode(cc(0, 7, 1))!.binding, decode(cc(0, 8, 1))!.binding), 'different CC numbers differ')
expect(!sameBinding(decode(bend(0, 1))!.binding, decode(bend(1, 1))!.binding), 'pitch bend on different channels differs')
expect(!sameBinding(decode(bend(0, 1))!.binding, decode(cc(0, 0, 1))!.binding), 'pitch bend and CC differ')

const pct = (u: number, zero: 'centre' | 'bottom') => Math.round(faderPercent(u, zero))
expect(pct(0, 'centre') === 50 && pct(1, 'centre') === 100 && pct(-1, 'centre') === 0, 'centre faders: 0 is 50%, ends are 0% and 100%')
expect(pct(0, 'bottom') === 0 && pct(1, 'bottom') === 100 && pct(-1, 'bottom') === 100, 'bottom faders: 0 is 0%, either sign at full strength is 100%')
// A centre fader at a force's percentage sends a CC that decodes back to (nearly) that force.
const back = (u: number) => decode([0xb0, 20, Math.round((faderPercent(u, 'centre') / 100) * 127)])!.u
expect([0.263, 0.5, -0.263, -0.9].every((u) => Math.abs(back(u) - u) <= 1 / 63), 'a centre fader set to the shown percentage reads back as that force')

process.exit(failures ? 1 : 0)
