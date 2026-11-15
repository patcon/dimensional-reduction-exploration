/** The visualiser's settings: shared with every visualiser in the room (but for LOCAL_SETTINGS), and remembered here. */

import { useCallback, useEffect, useState } from 'react'
import type { AnalysisSettings } from './analysis'
import type { CrowdSettings } from './crowd'
import { DEFAULT_LAYOUT, type LayoutSettings } from './layout'
import type { SoundMode } from './music'
import { DEFAULT_GRADIENT, DETECTIONS, GRADIENTS, type Detection, type Gradient } from './protocol'

export type ViewMode = '2d' | '2d-ts' | '3d'
export const VIEW_LABELS: Record<ViewMode, string> = { '2d': '2d time slice', '2d-ts': '2d time series', '3d': '3d' }
export type ColorBy = 'valence' | 'group' | 'pattern'
export const COLOR_BY_LABELS: Record<ColorBy, string> = { valence: 'facing', group: 'detected group', pattern: 'true pattern' }

export interface ViewSettings {
  mode: ViewMode
  /** What fills each phone's dot, and colours its trail. */
  dots: ColorBy
  trails: ColorBy
  /** A ring round each dot in its detected group's colour. */
  groupRings: boolean
  edges: boolean
  /** How far back trails reach, in seconds of song time. */
  trailSeconds: number
  dotSize: number
  trailWidth: number
}

export interface Settings {
  crowd: CrowdSettings
  analysis: AnalysisSettings
  layout: LayoutSettings
  view: ViewSettings
  speed: number
  /** Smallest group that sounds, as a share of the phones. */
  minGroupShare: number
  soundMode: SoundMode
  volume: number
  /** Which way of turning a phone reads as its facing, for every phone in the room. */
  detection: Detection
  gradient: Gradient
  // This screen's own:
  soundOn: boolean
  metronome: boolean
}

/** Kept to each screen rather than shared: whether it makes sound. */
export const LOCAL_SETTINGS = ['soundOn', 'metronome'] as const

export const DEFAULT_SETTINGS: Settings = {
  crowd: { count: 60, jitter: 0.05, lagSpread: 0.06, noise: 0.05, miss: 0, sync: 0.85, shuffleSeats: false },
  analysis: { quality: 'cpm', gamma: 0.4, graph: 'full', k: 10, warm: true, align: false, lagTol: 0.15 },
  layout: DEFAULT_LAYOUT,
  view: { mode: '3d', dots: 'valence', trails: 'valence', groupRings: false, edges: true, trailSeconds: 8, dotSize: 12, trailWidth: 3 },
  speed: 1,
  minGroupShare: 0.1,
  soundMode: 'chord',
  volume: 0.7,
  detection: 'flip',
  gradient: DEFAULT_GRADIENT,
  soundOn: false,
  metronome: false,
}

/** Settings from anywhere (the room, storage, an older version), each part defaulting when missing. */
export function completeSettings(partial: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS
  const s = { ...d, ...partial }
  return {
    ...s,
    crowd: { ...d.crowd, ...partial.crowd },
    analysis: { ...d.analysis, ...partial.analysis },
    layout: { ...d.layout, ...partial.layout },
    view: { ...d.view, ...partial.view },
    detection: DETECTIONS.includes(s.detection) ? s.detection : d.detection,
    gradient: GRADIENTS.includes(s.gradient) ? s.gradient : d.gradient,
  }
}

const SETTINGS_KEY = 'phone-flip-crowd:settings'

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? completeSettings(JSON.parse(stored) as Partial<Settings>) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** The page's settings, remembered in the browser, with a way to change some fields of one of its parts. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Remembered only as long as the page.
    }
  }, [settings])
  const patch = useCallback((changes: Partial<Settings>) => setSettings((s) => ({ ...s, ...changes })), [])
  const reset = useCallback(() => setSettings((s) => ({ ...DEFAULT_SETTINGS, soundOn: s.soundOn, metronome: s.metronome })), [])
  return { settings, setSettings, patch, reset }
}

export type Patch = (changes: Partial<Settings>) => void
