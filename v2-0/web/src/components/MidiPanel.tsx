import { describeBinding, MIDI_TARGETS, type MidiTarget } from '../midi'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { ALL_DEVICES, type useMidi } from '../useMidi'

const TARGET_LABELS: Record<MidiTarget, string> = { ...FORCE_LABELS, speed: 'Speed' }

/** How to play without a MIDI controller: a phone running MIDI Surf, plugged in over USB. */
function PhoneAsMidi() {
  return (
    <details className="midi-phone">
      <summary>Don't have a MIDI device? Use your phone as one</summary>
      <ol>
        <li>
          On an Android phone, open <a href="https://midisurf.app" target="_blank" rel="noreferrer">MIDI Surf</a> in
          Chrome: a MIDI controller with faders that runs in the browser.
        </li>
        <li>
          Plug the phone into this computer by USB. On the phone, tap the USB notification (or find USB under Settings
          → Connected devices) and choose <strong>MIDI</strong>. Menu names vary by phone (
          <a href="https://midi.org/developing-midi-applications-on-android" target="_blank" rel="noreferrer">
            more on Android USB MIDI
          </a>
          ).
        </li>
        <li>In MIDI Surf, send to the USB port (usually "Android USB Peripheral") and add a few faders.</li>
        <li>Here, connect MIDI, press learn beside a force and move a fader.</li>
      </ol>
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
        .
      </p>
    </details>
  )
}

/** Connect a MIDI device and bind its controls: learn, then move the control you want. */
export function MidiPanel({ midi }: { midi: ReturnType<typeof useMidi> }) {
  if (midi.status === 'unsupported')
    return (
      <section className="midi" aria-label="MIDI">
        <span className="muted">MIDI isn't available in this browser; try Chrome, Edge or Firefox. The sliders work everywhere.</span>
        <PhoneAsMidi />
      </section>
    )

  if (midi.status !== 'on')
    return (
      <section className="midi" aria-label="MIDI">
        <button type="button" onClick={midi.enable} disabled={midi.status === 'requesting'}>
          {midi.status === 'requesting' ? 'Waiting for permission…' : 'Connect MIDI'}
        </button>
        {midi.status === 'denied' && <span className="muted">MIDI access was refused. Allow it in the site settings, then try again.</span>}
        <PhoneAsMidi />
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
      <div className="midi-row">
        {MIDI_TARGETS.map((t) => {
          const learning = midi.learning === t
          return (
            <div key={t} className="midi-binding">
              <span className="midi-target" style={t === 'speed' ? undefined : { color: FORCE_COLORS[t] }}>
                {TARGET_LABELS[t]}
              </span>
              <span className="midi-bound">{learning ? 'move a control…' : describeBinding(midi.bindings[t])}</span>
              <button type="button" className={learning ? 'on' : ''} onClick={() => midi.setLearning(learning ? null : t)}>
                {learning ? 'cancel' : 'learn'}
              </button>
              {midi.bindings[t] && !learning && (
                <button type="button" aria-label={`Unbind ${TARGET_LABELS[t]}`} onClick={() => midi.unbind(t)}>
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="opt-help">Pitch bend springs back to 0 when you let go (the force stops); a fader stays put. Centre is 0 on both.</p>
      <PhoneAsMidi />
    </section>
  )
}
