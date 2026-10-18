import { useSyncExternalStore } from 'react'
import type { PairType } from './types'

/** Each force's control value u in [-1, 1] (see forceScale.ts). */
export type ControlValues = Record<PairType, number>

/**
 * Where every input source (on-screen sliders, MIDI) writes its control values; the last
 * write wins. Lives outside React so the loop clock can read it every tick without re-renders.
 */
export class InputStore {
  private values: ControlValues = { nb: 0, mn: 0, fp: 0 }
  private listeners = new Set<() => void>()

  get = () => this.values

  set(type: PairType, u: number) {
    const clamped = Math.max(-1, Math.min(1, u))
    if (this.values[type] === clamped) return
    this.values = { ...this.values, [type]: clamped }
    this.listeners.forEach((l) => l())
  }

  setAll(values: ControlValues) {
    this.values = { ...values }
    this.listeners.forEach((l) => l())
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export function useControlValues(store: InputStore) {
  return useSyncExternalStore(store.subscribe, store.get)
}
