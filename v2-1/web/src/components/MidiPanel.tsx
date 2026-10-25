import { useState } from 'react'
import { describeBinding, sameBinding, SIGN_TARGETS, type Binding, type MidiTarget, type Zero } from '../midi'
import { MIDI_SURF_SETUPS, type MidiSurfSetup } from '../midiSurf'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType } from '../types'
import { ALL_DEVICES, type useMidi } from '../useMidi'

type Midi = ReturnType<typeof useMidi>

const TARGET_LABELS: Record<MidiTarget, string> = {
  ...FORCE_LABELS,
  speed: 'Speed',
  nbSign: 'sign',
  mnSign: 'sign',
  fpSign: 'sign',
}

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
    <details className="midi-phone" open={open}>
      <summary>Use your phone as the controller (MIDI Surf)</summary>
      <ol>
        <li>
          <strong>Android phone, plugged into this computer by USB.</strong> On the phone, tap the USB notification (or
          find USB under Settings → Connected devices) and choose <strong>MIDI</strong>. Menu names vary by phone (
          <a href="https://midi.org/developing-midi-applications-on-android" target="_blank" rel="noreferrer">
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
      <div className="surf-setups">
        {MIDI_SURF_SETUPS.map((setup) => {
          const active = inUse(midi, setup)
          return (
            <figure key={setup.id} className={`surf-setup${active ? ' active' : ''}`}>
              <a href={setup.link} target="_blank" rel="noreferrer" title="Open in MIDI Surf">
                <img src={setup.qr} alt={`QR code opening the ${setup.title} page in MIDI Surf`} width={160} height={160} />
              </a>
              <figcaption>
                <strong>{setup.title}</strong>
                <span>{setup.description}</span>
                <span className="surf-links">
                  <a href={setup.link} target="_blank" rel="noreferrer">
                    open in MIDI Surf
                  </a>
                  {' · '}
                  <a href={setup.file} download>
                    page file
                  </a>
                </span>
                <button type="button" className={active ? 'on' : ''} onClick={() => midi.applySetup(setup)} disabled={active}>
                  {active ? 'In use' : 'Use this layout'}
                </button>
              </figcaption>
            </figure>
          )
        })}
      </div>
      <p>
        <strong>iPhone or iPad:</strong> browsers on iOS don't support Web MIDI, so MIDI Surf can't run there. Use a
        MIDI controller app from the App Store with a Mac instead: plug in by USB, open Audio MIDI Setup, choose Window →
        Show Audio Devices and click Enable under your device (
        <a href="https://support.apple.com/guide/audio-midi-setup/set-up-audio-devices-ams59f301fda/mac" target="_blank" rel="noreferrer">
          Apple's guide
        </a>
        ), or connect over Wi-Fi with a{' '}
        <a href="https://support.apple.com/guide/audio-midi-setup/share-midi-information-over-a-network-ams1012/mac" target="_blank" rel="noreferrer">
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
    <div className="midi-binding">
      <span className="midi-target" style={color ? { color } : undefined}>
        {TARGET_LABELS[target]}
      </span>
      <span className="midi-bound">{learning ? 'move a control…' : describeBinding(midi.bindings[target])}</span>
      <button type="button" className={learning ? 'on' : ''} onClick={() => midi.setLearning(learning ? null : target)}>
        {learning ? 'cancel' : 'learn'}
      </button>
      {midi.bindings[target] && !learning && (
        <button type="button" aria-label={`Unbind ${TARGET_LABELS[target]}`} onClick={() => midi.unbind(target)}>
          ×
        </button>
      )}
    </div>
  )
}

/** A force's binding, where its control reads 0, and its sign switch when 0 is at the bottom. */
function ForceBinding({ midi, type }: { midi: Midi; type: PairType }) {
  return (
    <div className="midi-force">
      <BindingControl midi={midi} target={type} color={FORCE_COLORS[type]} />
      <label className="opt-field">
        <span>0 at</span>
        <select value={midi.zeros[type]} onChange={(e) => midi.setZero(type, e.target.value as Zero)}>
          <option value="centre">centre (±)</option>
          <option value="bottom">bottom, + sign switch</option>
        </select>
      </label>
      {midi.zeros[type] === 'bottom' && <BindingControl midi={midi} target={SIGN_TARGETS[type]} />}
    </div>
  )
}

/** Connect a MIDI device and bind its controls: learn, then move the control you want. */
export function MidiPanel({ midi }: { midi: Midi }) {
  if (midi.status === 'unsupported')
    return (
      <section className="midi" aria-label="MIDI">
        <span className="muted">MIDI isn't available in this browser; try Chrome, Edge or Firefox. The sliders work everywhere.</span>
        <MidiSurfSetups midi={midi} />
      </section>
    )

  if (midi.status !== 'on')
    return (
      <section className="midi" aria-label="MIDI">
        <button type="button" onClick={midi.enable} disabled={midi.status === 'requesting'}>
          {midi.status === 'requesting' ? 'Waiting for permission…' : 'Connect MIDI'}
        </button>
        {midi.status === 'denied' && <span className="muted">MIDI access was refused. Allow it in the site settings, then try again.</span>}
        <MidiSurfSetups midi={midi} />
      </section>
    )

  return (
    <section className="midi" aria-label="MIDI">
      <div className="midi-row">
        <label className="opt-field">
          <span>MIDI</span>
          <select value={midi.deviceId} onChange={(e) => midi.setDeviceId(e.target.value)}>
            <option value={ALL_DEVICES}>All devices ({midi.inputs.length})</option>
            {midi.inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <span className="midi-last muted">{midi.last || 'move a control to see it here'}</span>
      </div>
      <div className="midi-forces">
        {PAIR_TYPES.map((type) => (
          <ForceBinding key={type} midi={midi} type={type} />
        ))}
        <BindingControl midi={midi} target="speed" />
      </div>
      <p className="opt-help">With 0 at the centre, up attracts and down repels: pitch bend springs back to 0 when you let go (the force stops); a fader stays put. With 0 at the bottom, the control sets only the strength and its sign switch (a toggle button) flips between attract and repel, starting as PaCMAP does (far pairs repel).</p>
      <MidiSurfSetups midi={midi} />
    </section>
  )
}
