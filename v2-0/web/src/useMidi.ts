import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CENTRE_ZEROS,
  decode,
  describeBinding,
  MIDI_TARGETS,
  NO_BINDINGS,
  sameBinding,
  SIGN_TARGETS,
  type Bindings,
  type MidiTarget,
  type Zero,
  type Zeros,
  PACMAP_SIGNS,
} from './midi'
import type { MidiSurfSetup } from './midiSurf'
import { PAIR_TYPES, type PairType } from './types'

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
  zeros: Zeros
}

// Browser storage can be missing or throw (private windows, blocked site data); MIDI works without it.
function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null
    if (saved) return { enabled: !!saved.enabled, deviceId: saved.deviceId ?? ALL_DEVICES, bindings: { ...NO_BINDINGS, ...saved.bindings }, zeros: { ...CENTRE_ZEROS, ...saved.zeros } }
  } catch {
    // Fall through to defaults.
  }
  return { enabled: false, deviceId: ALL_DEVICES, bindings: NO_BINDINGS, zeros: CENTRE_ZEROS }
}

function save(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Bindings just won't survive a reload.
  }
}

const NO_STRENGTH: Record<PairType, number> = { nb: 0, mn: 0, fp: 0 }

/**
 * Web MIDI input: pick a device, MIDI-learn a control for each target, and hear about every
 * bound control as it moves, as u in [-1, 1] (see midi.ts). A force whose control reads 0 at
 * the bottom takes its sign from its sign switch, starting as PaCMAP's (far pairs repel).
 * Bindings and zero points persist across reloads.
 */
export function useMidi(onControl: (target: PairType | 'speed', u: number) => void) {
  const [initial] = useState(load)
  const supported = 'requestMIDIAccess' in navigator
  // If MIDI was on last time, start out asking again (no prompt once permission has been granted).
  const [status, setStatus] = useState<MidiStatus>(() => (!supported ? 'unsupported' : initial.enabled ? 'requesting' : 'off'))
  const [access, setAccess] = useState<MIDIAccess | null>(null)
  const [inputs, setInputs] = useState<{ id: string; name: string }[]>([])
  const [deviceId, setDeviceId] = useState(initial.deviceId)
  const [bindings, setBindings] = useState<Bindings>(initial.bindings)
  const [zeros, setZeros] = useState<Zeros>(initial.zeros)
  const [learning, setLearning] = useState<MidiTarget | null>(null)
  /** The last control message heard, so you can see the device is talking. */
  const [last, setLast] = useState('')

  // The message handler is attached once per input; it reads the latest of these through refs.
  const onControlRef = useRef(onControl)
  const bindingsRef = useRef(bindings)
  const learningRef = useRef(learning)
  const zerosRef = useRef(zeros)
  // For bottom-zero forces: each one's sign, and the strength its control last sent.
  const signs = useRef({ ...PACMAP_SIGNS })
  const strengths = useRef({ ...NO_STRENGTH })
  useEffect(() => {
    onControlRef.current = onControl
    bindingsRef.current = bindings
    learningRef.current = learning
    zerosRef.current = zeros
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
    save({ enabled: status === 'on' || (status === 'requesting' && initial.enabled), deviceId, bindings, zeros })
  }, [status, deviceId, bindings, zeros, initial.enabled])

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
      const zeros = zerosRef.current
      for (const t of MIDI_TARGETS) {
        const b = current[t]
        if (!b || !sameBinding(b, message.binding)) continue
        if (t === 'speed') onControlRef.current(t, message.u)
        for (const type of PAIR_TYPES) {
          if (t === type) {
            if (zeros[type] === 'centre') onControlRef.current(type, message.u)
            else {
              strengths.current[type] = message.travel
              onControlRef.current(type, signs.current[type] * message.travel)
            }
          } else if (t === SIGN_TARGETS[type]) {
            // A switch sends its top or its bottom; anywhere in the top half is positive.
            signs.current[type] = message.travel >= 0.5 ? 1 : -1
            if (zeros[type] === 'bottom') onControlRef.current(type, signs.current[type] * strengths.current[type])
          }
        }
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

  const setZero = useCallback((type: PairType, zero: Zero) => {
    setZeros((z) => ({ ...z, [type]: zero }))
    signs.current[type] = PACMAP_SIGNS[type]
    strengths.current[type] = 0
  }, [])

  /** Bind the forces and their signs as a MIDI Surf page sends them; speed keeps its control unless the page takes it. */
  const applySetup = useCallback((setup: MidiSurfSetup) => {
    setBindings((b) => {
      const taken = Object.values(setup.bindings).some((s) => s && b.speed && sameBinding(s, b.speed))
      return { ...b, ...setup.bindings, speed: taken ? null : b.speed }
    })
    setZeros(setup.zeros)
    setLearning(null)
    signs.current = { ...PACMAP_SIGNS }
    strengths.current = { ...NO_STRENGTH }
  }, [])

  return { status, enable, inputs, deviceId, setDeviceId, bindings, unbind, zeros, setZero, applySetup, learning, setLearning, last }
}
