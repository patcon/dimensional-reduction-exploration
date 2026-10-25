/** Every setting on the page as one plain object, remembered in the browser. What's played (the forces, autopilot) isn't. */

import { useEffect, useState } from 'react'
import { DEFAULT_SCALE, type ForceScale } from './forceScale.ts'
import { DEFAULT_OPTIMISER, type OptimiserSettings } from './optimisers.ts'
import type { Dim, PairType } from './types.ts'
import { SAMPLE_SIZES, type SampleSize } from './useData.ts'

export interface Settings {
  size: SampleSize
  dim: Dim
  autoRotate: boolean
  /** Which digit labels are drawn. */
  digitsShown: boolean[]
  /** Each force's slider: its range, whether it springs back to 0, and whether it's split (up attracts, down repels). */
  scale: Record<PairType, ForceScale>
  spring: Record<PairType, boolean>
  split: Record<PairType, boolean>
  /** Iterations per second. */
  rate: number
  /** Glide between steps. */
  interpolate: boolean
  optimiser: OptimiserSettings
  /** Keep the screen from dimming or locking while the page is open. */
  wakeLock: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  size: '20k',
  dim: 3,
  autoRotate: true,
  digitsShown: Array<boolean>(10).fill(true),
  scale: { nb: DEFAULT_SCALE, mn: DEFAULT_SCALE, fp: DEFAULT_SCALE },
  spring: { nb: false, mn: false, fp: false },
  split: { nb: true, mn: true, fp: true },
  rate: 10,
  interpolate: true,
  optimiser: DEFAULT_OPTIMISER,
  wakeLock: false,
}

/** Fills in whatever saved settings lack (from an older version, say) with the defaults. */
function completeSettings(partial: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS
  const o = partial.optimiser
  return {
    ...d,
    ...partial,
    size: partial.size && SAMPLE_SIZES.includes(partial.size) ? partial.size : d.size,
    scale: { ...d.scale, ...partial.scale },
    spring: { ...d.spring, ...partial.spring },
    split: { ...d.split, ...partial.split },
    optimiser: { ...d.optimiser, ...o, momentum: { ...d.optimiser.momentum, ...o?.momentum }, speed: { ...d.optimiser.speed, ...o?.speed } },
  }
}

const SETTINGS_KEY = 'playable-pacmap-mobile:settings'

/** The settings this browser last had, or the defaults. */
function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? completeSettings(JSON.parse(stored) as Partial<Settings>) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** The page's settings, remembered in the browser, with a way to change one (to a value, or from the last), or reset them all. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Storage is blocked or full: settings last only as long as the page.
    }
  }, [settings])
  const set = <K extends keyof Settings>(key: K, value: Settings[K] | ((prev: Settings[K]) => Settings[K])) =>
    setSettings((s) => ({ ...s, [key]: typeof value === 'function' ? (value as (prev: Settings[K]) => Settings[K])(s[key]) : value }))
  const reset = () => setSettings(DEFAULT_SETTINGS)
  return { settings, set, reset }
}

export type SetSetting = ReturnType<typeof useSettings>['set']
