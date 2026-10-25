import { useState } from 'react'
import { describeBinding, sameBinding, SIGN_TARGETS, type Binding, type MidiTarget, type Zero } from '../midi'
import { MIDI_SURF_SETUPS, type MidiSurfSetup } from '../midiSurf'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import { ALL_DEVICES, type useMidi } from '../useMidi'
import { cn } from '@/lib/utils'
import { Section, Segmented } from './controls'
import { Button } from './ui/button'

type Midi = ReturnType<typeof useMidi>

const TARGET_LABELS: Record<MidiTarget, string> = {
  ...FORCE_LABELS,
  speed: 'Speed',
  nbSign: 'sign',
  mnSign: 'sign',
  fpSign: 'sign',
}

const ZERO_LABELS: Record<Zero, string> = { centre: 'centre (±)', bottom: 'bottom, + sign switch' }

/** A link in running text. */
const linkClass = 'underline underline-offset-2'

const same = (a: Binding | null, b: Binding | null) => (a && b ? sameBinding(a, b) : a === b)

/** Whether the current bindings are exactly what this setup makes. */
function inUse(midi: Midi, setup: MidiSurfSetup) {
  return (Object.keys(setup.bindings) as (keyof MidiSurfSetup['bindings'])[]).every((t) => same(midi.bindings[t], setup.bindings[t])) &&
    PAIR_TYPES.every((type) => midi.zeros[type] === setup.zeros[type])
}

/** Ready-made MIDI Surf pages: open one on the phone, and match the bindings here in one click. */
function MidiSurfSetups({ midi }: { midi: Midi }) {
  // Open to start with when nothing's bound yet; after that it's yours to open and close.
  const [open] = useState(() => !Object.values(midi.bindings).some(Boolean))
  return (
    <details className="text-sm" open={open}>
      <summary className="cursor-pointer text-highlight">Use your phone as the controller (MIDI Surf)</summary>
      <ol className="my-2 list-decimal space-y-1 pl-5 leading-normal">
        <li>
          <strong>Android phone, plugged into this computer by USB.</strong> On the phone, tap the USB notification (or
          find USB under Settings → Connected devices) and choose <strong>MIDI</strong>. Menu names vary by phone (
          <a className={linkClass} href="https://midi.org/developing-midi-applications-on-android" target="_blank" rel="noreferrer">
            more on Android USB MIDI
          </a>
          ).
        </li>
        <li>
          <strong>Pick a layout below.</strong> Scan its QR code with the phone (or open the link in Chrome there) and
          accept MIDI Surf's offer to import the page, then press <strong>Use this layout</strong> here.
        </li>
        <li>In MIDI Surf, send to the USB port (usually "Android USB Peripheral").</li>
        <li>
          Here, press <strong>Connect MIDI</strong> and move a control: it shows up beside the MIDI menu.
        </li>
      </ol>
      <div className="my-3 flex flex-wrap gap-3">
        {MIDI_SURF_SETUPS.map((setup) => {
          const active = inUse(midi, setup)
          return (
            <figure key={setup.id} className={cn('m-0 flex max-w-105 flex-[1_1_300px] gap-2.5 rounded-lg border p-2', active && 'border-highlight')}>
              <a href={setup.link} target="_blank" rel="noreferrer" title="Open in MIDI Surf" className="shrink-0">
                {/* QR codes stay black on white in either theme, so phones can read them. */}
                <img
                  src={setup.qr}
                  alt={`QR code opening the ${setup.title} page in MIDI Surf`}
                  width={160}
                  height={160}
                  className="block size-30 rounded bg-white [image-rendering:pixelated]"
                />
              </a>
              <figcaption className="flex flex-col items-start gap-1 leading-snug">
                <strong>{setup.title}</strong>
                <span>{setup.description}</span>
                <span className="text-muted-foreground">
                  <a className={linkClass} href={setup.link} target="_blank" rel="noreferrer">
                    open in MIDI Surf
                  </a>
                  {' · '}
                  <a className={linkClass} href={setup.file} download>
                    page file
                  </a>
                </span>
                <Button size="sm" variant={active ? 'default' : 'outline'} onClick={() => midi.applySetup(setup)} disabled={active}>
                  {active ? 'In use' : 'Use this layout'}
                </Button>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <p className="leading-normal">
        <strong>iPhone or iPad:</strong> browsers on iOS don't support Web MIDI, so MIDI Surf can't run there. Use a
        MIDI controller app from the App Store with a Mac instead: plug in by USB, open Audio MIDI Setup, choose Window →
        Show Audio Devices and click Enable under your device (
        <a className={linkClass} href="https://support.apple.com/guide/audio-midi-setup/set-up-audio-devices-ams59f301fda/mac" target="_blank" rel="noreferrer">
          Apple's guide
        </a>
        ), or connect over Wi-Fi with a{' '}
        <a className={linkClass} href="https://support.apple.com/guide/audio-midi-setup/share-midi-information-over-a-network-ams1012/mac" target="_blank" rel="noreferrer">
          network MIDI session
        </a>
        . Then learn its controls below.
      </p>
    </details>
  )
}

/** One target's binding: what's bound, learn, and unbind. */
function BindingControl({ midi, target, color }: { midi: Midi; target: MidiTarget; color?: string }) {
  const learning = midi.learning === target
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-22 shrink-0 font-semibold" style={color ? { color } : undefined}>
        {TARGET_LABELS[target]}
      </span>
      <span className="num min-w-0 flex-1 text-muted-foreground">{learning ? 'move a control…' : describeBinding(midi.bindings[target])}</span>
      {midi.bindings[target] && !learning && (
        <Button variant="ghost" size="icon-sm" aria-label={`Unbind ${TARGET_LABELS[target]}`} onClick={() => midi.unbind(target)}>
          ×
        </Button>
      )}
      <Button size="sm" variant={learning ? 'default' : 'outline'} onClick={() => midi.setLearning(learning ? null : target)}>
        {learning ? 'cancel' : 'learn'}
      </Button>
    </div>
  )
}

/** A force's binding, where its control reads 0, and its sign switch when 0 is at the bottom. */
function ForceBinding({ midi, type }: { midi: Midi; type: PairType }) {
  return (
    <div className="flex flex-col gap-2">
      <BindingControl midi={midi} target={type} color={FORCE_COLORS[type]} />
      <div className="flex items-center gap-2 text-sm">
        <span className="w-22 shrink-0 text-muted-foreground">0 at</span>
        <Segmented options={['centre', 'bottom'] as const} value={midi.zeros[type]} onChange={(zero) => midi.setZero(type, zero)} labels={ZERO_LABELS} />
      </div>
      {midi.zeros[type] === 'bottom' && <BindingControl midi={midi} target={SIGN_TARGETS[type]} />}
    </div>
  )
}

/** Connect a MIDI device and bind its controls: learn, then move the control you want. */
export function MidiPanel({ midi }: { midi: Midi }) {
  if (midi.status === 'unsupported')
    return (
      <Section title="MIDI" description="MIDI isn't available in this browser; try Chrome, Edge or Firefox. The sliders work everywhere.">
        <MidiSurfSetups midi={midi} />
      </Section>
    )

  if (midi.status !== 'on')
    return (
      <Section title="MIDI" description="Play the forces from a MIDI controller, or a phone running MIDI Surf.">
        <Button variant="outline" className="self-start" onClick={midi.enable} disabled={midi.status === 'requesting'}>
          {midi.status === 'requesting' ? 'Waiting for permission…' : 'Connect MIDI'}
        </Button>
        {midi.status === 'denied' && <p className="text-sm text-muted-foreground">MIDI access was refused. Allow it in the site settings, then try again.</p>}
        <MidiSurfSetups midi={midi} />
      </Section>
    )

  return (
    <Section title="MIDI" description="Learn a control for each force, then move it to bind it.">
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-center gap-2">
          <span className="w-22 shrink-0 text-muted-foreground">device</span>
          <select
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm shadow-xs"
            value={midi.deviceId}
            onChange={(e) => midi.setDeviceId(e.target.value)}
          >
            <option value={ALL_DEVICES}>All devices ({midi.inputs.length})</option>
            {midi.inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <span className="num pl-24 text-xs text-muted-foreground">{midi.last || 'move a control to see it here'}</span>
      </div>
      <div className="flex flex-col gap-4">
        {PAIR_TYPES.map((type) => (
          <ForceBinding key={type} midi={midi} type={type} />
        ))}
        <BindingControl midi={midi} target="speed" />
      </div>
      <p className="text-xs text-muted-foreground">With 0 at the centre, up attracts and down repels: pitch bend springs back to 0 when you let go (the force stops); a fader stays put. With 0 at the bottom, the control sets only the strength and its sign switch (a toggle button) flips between attract and repel, starting as PaCMAP does (far pairs repel).</p>
      <MidiSurfSetups midi={midi} />
    </Section>
  )
}
