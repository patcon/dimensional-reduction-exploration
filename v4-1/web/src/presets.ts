/** Every setting on the page as one plain object, remembered in the browser, and named presets of it kept there or in files. */

import { useEffect, useState } from 'react'
import { DEFAULT_GRADIENT, type Detection, type Gradient } from './protocol.ts'
import { DEFAULT_MUSIC, type MusicSettings } from './windowMusic.ts'
import type { ChordOrder, ClusterOver, GroupBy } from './selection.ts'
import type { SignalSettings } from './signal.ts'
import type { BeatPattern } from './useMetronome.ts'
import { DEFAULT_PARTICLES, DEFAULT_STYLE, type GeoMode, type ParticleSettings, type ViewMode, type VizStyle } from './vizSettings.ts'

export interface Settings {
  digits: number[]
  count: number
  seed: number
  groupBy: GroupBy
  resolution: number
  neighbours: number
  clusterOver: ClusterOver
  clusterRate: number
  /** The window that Leiden and neighbour forces compare digits over, comparing over the window, and that the digit images and matrix shade, in pixels read. */
  windowPixels: number
  order: ChordOrder
  signal: SignalSettings
  view: ViewMode
  geometry: GeoMode
  style: VizStyle
  /** How far back trails reach, in seconds of playback; they keep their proportions, reaching further back for longer. */
  trailSeconds: number
  particles: ParticleSettings
  /** The followed digit, by its place in the sample. */
  focus: number | null
  /** The digit every other digit reacts to, by its pool row, or null for none: each digit then speaks for itself. */
  speaker: number | null
  /** Playback, in pixels per second. */
  speed: number
  /** How participants' phones read their turning as valence, the same for everyone in the room. */
  detection: Detection
  /** The colours valence runs through, everywhere it's shown, phones included. */
  gradient: Gradient
  /** Keep the screen from dimming or locking while the page is open. */
  wakeLock: boolean
  /** Beep on each beat while playing: every `beatPixels` pixels read, accented by `beatPattern`. */
  metronome: boolean
  beatPixels: number
  beatPattern: BeatPattern
  /** Play the walk's music (see music.ts) while playing. */
  musicOn: boolean
  music: MusicSettings
}

/** Settings each page keeps to itself, rather than sharing with the room's other visualisers. */
export const LOCAL_SETTINGS = ['wakeLock', 'metronome', 'beatPixels', 'beatPattern', 'musicOn'] as const

export const DEFAULT_SETTINGS: Settings = {
  digits: [0, 1],
  count: 100,
  seed: 0,
  groupBy: 'leiden',
  resolution: 0.4,
  neighbours: 30,
  clusterOver: 'window',
  clusterRate: 1,
  windowPixels: 140,
  order: 'grouped',
  signal: { skipBlank: false, smoothing: 'blur', smoothingPixels: 1.5, mapping: 'ink' },
  view: '3d',
  geometry: 'particle',
  style: { ...DEFAULT_STYLE, colorBy: { ...DEFAULT_STYLE.colorBy, chord: 'group' } },
  trailSeconds: 10,
  particles: { ...DEFAULT_PARTICLES, cohesion: 0.2, separation: -0.2, spread: 0.4, radius: 150, damping: 0.7 },
  focus: 0,
  speaker: null,
  speed: 14,
  detection: 'flip',
  gradient: DEFAULT_GRADIENT,
  wakeLock: false,
  metronome: true,
  // A beat a row, and a bar every four.
  beatPixels: 28,
  beatPattern: '2111',
  musicOn: false,
  music: DEFAULT_MUSIC,
}

const withoutReading = (signal?: Partial<SignalSettings> & { reading?: unknown }) => {
  const { reading: _, ...rest } = signal ?? {}
  return rest
}

/** Fills in whatever a saved or imported preset lacks (from an older version, say) with the defaults. */
export function completeSettings(partial: Partial<Settings> & { lineClicks?: boolean }): Settings {
  const d = DEFAULT_SETTINGS
  // What an older version called clicking at each line.
  const { lineClicks, ...rest } = partial
  if (lineClicks !== undefined) rest.metronome ??= lineClicks
  partial = rest
  const style = partial.style ?? d.style
  return {
    ...d,
    ...partial,
    // Dropping what an older version read in, `reading`: only rows are read now.
    signal: { ...d.signal, ...withoutReading(partial.signal) },
    style: { ...d.style, ...style, colorBy: { ...d.style.colorBy, ...style.colorBy }, opacity: { ...d.style.opacity, ...style.opacity } },
    particles: { ...d.particles, ...partial.particles },
    music: { ...d.music, ...partial.music },
  }
}

/** Settings that are objects of their own, changed a field at a time. */
type Nested = 'signal' | 'style' | 'particles' | 'music'

const SETTINGS_KEY = 'mnist-valence-participation:settings'

/** The settings this browser last had, or the defaults. */
function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? completeSettings(JSON.parse(stored) as Partial<Settings>) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** The page's settings, remembered in the browser, with ways to change one, or some fields of a nested one, or reset them all. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Storage is blocked or full: settings last only as long as the page.
    }
  }, [settings])
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }))
  const patch = <K extends Nested>(key: K, fields: Partial<Settings[K]>) => setSettings((s) => ({ ...s, [key]: { ...s[key], ...fields } }))
  const reset = () => setSettings(DEFAULT_SETTINGS)
  return { settings, setSettings, set, patch, reset }
}

/** What a panel of controls gets: the settings and ways to change them. */
export type SettingsEditor = Pick<ReturnType<typeof useSettings>, 'settings' | 'set' | 'patch'>

export type Presets = Record<string, Settings>

const STORAGE_KEY = 'mnist-valence-participation:presets'

export function loadPresets(): Presets {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<Settings>>
    return Object.fromEntries(Object.entries(stored).map(([name, s]) => [name, completeSettings(s)]))
  } catch {
    return {}
  }
}

export function storePresets(presets: Presets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // Storage is blocked or full: presets last only as long as the page.
  }
}

/** The file a preset is exported as, and read back from. */
interface PresetFile {
  name: string
  settings: Partial<Settings>
}

export function exportPreset(name: string, settings: Settings) {
  const file: PresetFile = { name, settings }
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w-]+/g, '-') || 'preset'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Reads an exported preset; a bare settings object works too, named after its file. */
export async function importPreset(file: File): Promise<{ name: string; settings: Settings }> {
  const parsed = JSON.parse(await file.text())
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not a preset')
  const isWrapped = typeof parsed.settings === 'object' && parsed.settings !== null
  return {
    name: isWrapped && typeof parsed.name === 'string' ? parsed.name : file.name.replace(/\.json$/i, ''),
    settings: completeSettings(isWrapped ? parsed.settings : parsed),
  }
}
