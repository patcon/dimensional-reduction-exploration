import { useCallback, useEffect, useRef, useState } from 'react'
import { decode, describeBinding, MIDI_TARGETS, NO_BINDINGS, sameBinding, type Bindings, type MidiTarget } from './midi'

/**
 * unsupported: no Web MIDI in this browser (e.g. Safari).
 * off: not asked for yet. requesting: waiting on the permission prompt.
 * on: listening. denied: permission refused or access failed.
 */
export type MidiStatus = 'unsupported' | 'off' | 'requesting' | 'on' | 'denied'

/** Listen to every connected input, or just one. */
export const ALL_DEVICES = 'all'

const STORAGE_KEY = 'playable-pacmap.midi'

interface Saved {
  enabled: boolean
  deviceId: string
  bindings: Bindings
}

// Browser storage can be missing or throw (private windows, blocked site data); MIDI works without it.
function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null
    if (saved) return { enabled: !!saved.enabled, deviceId: saved.deviceId ?? ALL_DEVICES, bindings: { ...NO_BINDINGS, ...saved.bindings } }
  } catch {
    // Fall through to defaults.
  }
  return { enabled: false, deviceId: ALL_DEVICES, bindings: NO_BINDINGS }
}

function save(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Bindings just won't survive a reload.
  }
}

/**
 * Web MIDI input: pick a device, MIDI-learn a control for each target, and hear about every
 * bound control as it moves, as u in [-1, 1] (see midi.ts). Bindings persist across reloads.
 */
export function useMidi(onControl: (target: MidiTarget, u: number) => void) {
  const [initial] = useState(load)
  const supported = 'requestMIDIAccess' in navigator
  // If MIDI was on last time, start out asking again (no prompt once permission has been granted).
  const [status, setStatus] = useState<MidiStatus>(() => (!supported ? 'unsupported' : initial.enabled ? 'requesting' : 'off'))
  const [access, setAccess] = useState<MIDIAccess | null>(null)
  const [inputs, setInputs] = useState<{ id: string; name: string }[]>([])
  const [deviceId, setDeviceId] = useState(initial.deviceId)
  const [bindings, setBindings] = useState<Bindings>(initial.bindings)
  const [learning, setLearning] = useState<MidiTarget | null>(null)
  /** The last control message heard, so you can see the device is talking. */
  const [last, setLast] = useState('')

  // The message handler is attached once per input; it reads the latest of these through refs.
  const onControlRef = useRef(onControl)
  const bindingsRef = useRef(bindings)
  const learningRef = useRef(learning)
  useEffect(() => {
    onControlRef.current = onControl
    bindingsRef.current = bindings
    learningRef.current = learning
  })

  const request = useCallback(() => {
    navigator.requestMIDIAccess().then(
      (a) => {
        setAccess(a)
        setStatus('on')
      },
      () => setStatus('denied'),
    )
  }, [])
  const enable = useCallback(() => {
    if (!supported) return
    setStatus('requesting')
    request()
  }, [supported, request])

  useEffect(() => {
    if (supported && initial.enabled) request()
  }, [supported, initial.enabled, request])

  useEffect(() => {
    save({ enabled: status === 'on' || (status === 'requesting' && initial.enabled), deviceId, bindings })
  }, [status, deviceId, bindings, initial.enabled])

  useEffect(() => {
    if (!access) return
    const onMessage = (e: MIDIMessageEvent) => {
      if (!e.data) return
      const message = decode(e.data)
      if (!message) return
      setLast(`${describeBinding(message.binding)} → ${message.u.toFixed(2)}`)
      let current = bindingsRef.current
      const target = learningRef.current
      if (target) {
        // A control drives one target: learning it here unbinds it anywhere else.
        current = Object.fromEntries(
          MIDI_TARGETS.map((t) => [t, t === target ? message.binding : current[t] && sameBinding(current[t], message.binding) ? null : current[t]]),
        ) as Bindings
        bindingsRef.current = current
        learningRef.current = null
        setBindings(current)
        setLearning(null)
      }
      for (const t of MIDI_TARGETS) {
        const b = current[t]
        if (b && sameBinding(b, message.binding)) onControlRef.current(t, message.u)
      }
    }
    const detach = () => {
      for (const input of access.inputs.values()) input.removeEventListener('midimessage', onMessage)
    }
    // Rerun as devices come and go: listen to the chosen one, or all of them.
    const attach = () => {
      detach()
      const all = [...access.inputs.values()]
      setInputs(all.map((i) => ({ id: i.id, name: i.name ?? i.id })))
      for (const input of all) if (deviceId === ALL_DEVICES || input.id === deviceId) input.addEventListener('midimessage', onMessage)
    }
    attach()
    access.addEventListener('statechange', attach)
    return () => {
      access.removeEventListener('statechange', attach)
      detach()
    }
  }, [access, deviceId])

  const unbind = useCallback((target: MidiTarget) => setBindings((b) => ({ ...b, [target]: null })), [])

  return { status, enable, inputs, deviceId, setDeviceId, bindings, unbind, learning, setLearning, last }
}
