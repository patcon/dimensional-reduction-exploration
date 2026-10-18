import { describeBinding, MIDI_TARGETS, type MidiTarget } from '../midi'
import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { ALL_DEVICES, type useMidi } from '../useMidi'

const TARGET_LABELS: Record<MidiTarget, string> = { ...FORCE_LABELS, speed: 'Speed' }

/** Connect a MIDI device and bind its controls: learn, then move the control you want. */
export function MidiPanel({ midi }: { midi: ReturnType<typeof useMidi> }) {
  if (midi.status === 'unsupported')
    return (
      <section className="midi" aria-label="MIDI">
        <span className="muted">MIDI isn't available in this browser; try Chrome, Edge or Firefox. The sliders work everywhere.</span>
      </section>
    )

  if (midi.status !== 'on')
    return (
      <section className="midi" aria-label="MIDI">
        <button type="button" onClick={midi.enable} disabled={midi.status === 'requesting'}>
          {midi.status === 'requesting' ? 'Waiting for permission…' : 'Connect MIDI'}
        </button>
        {midi.status === 'denied' && <span className="muted">MIDI access was refused. Allow it in the site settings, then try again.</span>}
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
    </section>
  )
}
