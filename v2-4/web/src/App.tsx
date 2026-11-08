import { Box, Brush, ChevronDown, ChevronUp, Eye, Footprints, Gauge, Info, KeyboardMusic, Magnet, Plane, Scale, Shuffle, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DigitPicker } from './components/DigitPicker'
import { DigitPreview } from './components/DigitPreview'
import { ForceSliders } from './components/ForceSliders'
import { LeanPanel } from './components/LeanPanel'
import { LocalPanel, ResampleButton } from './components/LocalPanel'
import { MidiPanel } from './components/MidiPanel'
import { OptimiserPanel } from './components/OptimiserPanel'
import { Scatter } from './components/Scatter'
import { ScheduleGraph } from './components/ScheduleGraph'
import { Section, Segmented, Toggle } from './components/controls'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { PlaySection, TransportBar, ViewSection } from './components/Transport'
import { Engine } from './engine'
import { GLOBAL_FAR, type FarState } from './far'
import { FORCE_COLORS } from './palette'
import { spanning, toMultiplier, toU } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DEFAULT_OPTIMISER, OptimiserBank } from './optimisers'
import { clampBrushRatio, useSettings, type Algorithm, type SetSetting, type Settings } from './settings'
import { localmapAt, pacmapWeights, phaseOf, scheduleLength, Trail } from './schedule'
import { PAIR_TYPES, type Pairs, type PairType, type Weights } from './types'
import { useData, useDigits, type PacmapData, type SampleSize } from './useData'
import { useLoopClock } from './useLoopClock'
import type { Zero } from './midi'
import { useMidi } from './useMidi'
import { useWakeLock } from './useWakeLock'

/** How far a control must move before the kicking Adam forgets its state. */
const KICK_THRESHOLD = 0.02

/** vaul's own easing and duration, so what sits over the plot keeps clear of the drawer as it moves. */
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DRAWER_SECONDS = 0.5

/** How long the dimension button names what it moved to, as phones can't hover for a tooltip. */
const MODE_LABEL_MS = 1200

/** The drawer's tabs, in order. */
const TABS = [
  { value: 'forces', label: 'Forces', icon: Magnet },
  { value: 'lean', label: 'Lean', icon: Scale },
  { value: 'local', label: 'Local', icon: Shuffle },
  { value: 'play', label: 'Play', icon: Gauge },
  { value: 'view', label: 'View', icon: Eye },
  { value: 'optimiser', label: 'Optimiser', icon: Footprints },
  { value: 'midi', label: 'MIDI', icon: KeyboardMusic },
] as const

/**
 * Each force's lean on opening (see Engine.lean). A pair is its chooser's view of the data, so the chooser is the one
 * to react to it: the neighbours lean fully toward the digit that chose them. The mid-near and far pairs stay even:
 * each is a random draw, and leaning them moves the map about as much with who chose whom scrambled
 * (scripts/explore-lean.ts), so what they'd add is the draw's noise, not the data's.
 */
const DEFAULT_LEAN: Weights = { nb: 1, mn: 0, fp: 0 }

/** What autopilot plays, or manual: autopilot off, the forces are yours. */
type Pilot = Algorithm | 'manual'
const PILOTS: Pilot[] = ['localmap', 'pacmap', 'manual']
const PILOT_LABELS: Record<Pilot, string> = { localmap: 'LocalMAP', pacmap: 'PaCMAP', manual: 'manual' }

/** The window's height, kept up to date. */
function useWindowHeight() {
  const [height, setHeight] = useState(window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

const mapValues = <A, B>(r: Record<PairType, A>, f: (a: A, type: PairType) => B): Record<PairType, B> =>
  ({ nb: f(r.nb, 'nb'), mn: f(r.mn, 'mn'), fp: f(r.fp, 'fp') })

/**
 * Every partner of digit `i` in each pair type, whichever end of the pair it's at, as both ends feel its force; the
 * far pairs with those the brush added (`extraFp`).
 */
function partnersOf(pairs: Pairs, i: number, extraFp: Uint32Array) {
  return mapValues(pairs, (flat, type) => {
    const partners: number[] = []
    for (const list of type === 'fp' ? [flat, extraFp] : [flat])
      for (let k = 0; k < list.length; k += 2) {
        if (list[k] === i) partners.push(list[k + 1])
        else if (list[k + 1] === i) partners.push(list[k])
      }
    return Uint32Array.from(partners)
  })
}

/** A digit picked at random from those shown, or null if none are. */
function randomShown(labels: number[], shown: boolean[]) {
  const candidates = labels.flatMap((label, i) => (shown[label] ? [i] : []))
  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null
}

interface PlaygroundProps {
  data: PacmapData
  settings: Settings
  set: SetSetting
  /** Puts every setting back to its default. */
  onResetSettings: () => void
  /** The size `data` is, which lags `size` while it loads. */
  dataSize: SampleSize
  /** Whether `size` is still loading (`data` is the previous size's until it arrives). */
  loading: boolean
  loadError?: string
}

function Playground({ data, settings, set, onResetSettings, dataSize, loading, loadError }: PlaygroundProps) {
  const { meta } = data
  // Switching size swaps `data` once it has loaded, starting over on the new digits.
  const { size, dim, autoRotate, digitsShown, optimiser, scale, spring, split } = settings
  useWakeLock(settings.wakeLock)
  // The clicked digit, and the one hovered (by the mouse, or a held press), previewed in the plot's corner.
  // A digit is selected from the start, picked at random, so its pairs' edges show what the forces do.
  const [selected, setSelected] = useState<number | null>(() => randomShown(meta.labels, digitsShown))
  const [hovered, setHovered] = useState<number | null>(null)
  const pixels = useDigits(dataSize)
  // Other digits, so whatever was picked is gone; another is picked at random.
  const [pickedIn, setPickedIn] = useState(data)
  if (pickedIn !== data) {
    setPickedIn(data)
    setSelected(randomShown(data.meta.labels, digitsShown))
    setHovered(null)
  }
  if (selected !== null && !digitsShown[meta.labels[selected]]) setSelected(null)
  if (hovered !== null && !digitsShown[meta.labels[hovered]]) setHovered(null)
  const previewed = hovered ?? selected
  const optimisers = useMemo(() => new OptimiserBank(data.init[dim].length, meta.adam, dim), [data, meta.adam, dim])
  const engine = useMemo(
    () => new Engine(data.pairs, data.init[dim], optimisers.configure(DEFAULT_OPTIMISER), dim),
    [data, optimisers, dim],
  )
  const length = scheduleLength(meta.schedule)
  // Where LocalMAP redraws its far pairs over one loop, for the schedule graph.
  const localmapResamples = useMemo(
    () => Array.from({ length }, (_, k) => k).filter((k) => localmapAt(k, meta.schedule, meta.localmap.resampleEvery).resampleAfter),
    [length, meta.schedule, meta.localmap.resampleEvery],
  )
  const { local } = settings

  // Where the far pairs are (global, or redrawn), with the engine's count of changes to them, which the edges follow.
  const [far, setFar] = useState<FarState>(GLOBAL_FAR)
  const [fpVersion, setFpVersion] = useState(engine.fpVersion)
  // A new engine starts from PaCMAP's global far pairs.
  const [farFor, setFarFor] = useState(engine)
  if (farFor !== engine) {
    setFarFor(engine)
    setFar(GLOBAL_FAR)
    setFpVersion(engine.fpVersion)
  }
  const edges = useMemo(
    () => (selected === null ? null : partnersOf(engine.pairs, selected, engine.extraFar())),
    // fpVersion: the far pairs change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, fpVersion, selected],
  )
  const resample = useCallback(() => {
    const r = engine.resampleFar(local.thres)
    setFar({ global: false, last: { ...r, step: engine.steps }, extra: engine.extraCount })
    setFpVersion(engine.fpVersion)
  }, [engine, local.thres])
  // The brush: on, painting redraws only the far pairs of the digits under it, or (upsampling) adds one to each.
  const [brushOn, setBrushOn] = useState(false)
  const paintResample = useCallback(
    (points: number[]) => {
      const added = local.brushAdds
      const r = added ? engine.upsampleFar(local.thres, points) : engine.resampleFar(local.thres, points)
      setFar({ global: false, last: { ...r, step: engine.steps, painted: points.length, added }, extra: engine.extraCount })
      setFpVersion(engine.fpVersion)
    },
    [engine, local.thres, local.brushAdds],
  )
  const restore = () => {
    engine.restoreFar()
    setFar(GLOBAL_FAR)
    setFpVersion(engine.fpVersion)
  }
  // Played, like the forces, so not remembered: each force's lean, and whether who chose whom is scrambled.
  const [lean, setLean] = useState<Weights>(DEFAULT_LEAN)
  const [scrambled, setScrambled] = useState(false)
  useEffect(() => {
    engine.setLean(lean)
    engine.setScrambled(scrambled)
  }, [engine, lean, scrambled])
  const oneWay = useMemo(() => {
    const flags = engine.oneWayNeighbours()
    return { count: flags.reduce((a, b) => a + b, 0), of: flags.length }
  }, [engine])
  // Played, like the forces, so not remembered: LocalMAP's neighbour boost, and redrawing far pairs every so often.
  const [boost, setBoost] = useState(false)
  const [autoResample, setAutoResample] = useState(false)

  useEffect(() => {
    engine.setSpeed(optimiser.speed[optimiser.kind])
    const next = optimisers.configure(optimiser)
    if (engine.optimiser !== next) engine.setOptimiser(next)
  }, [optimiser, optimisers, engine])

  const store = useMemo(() => new InputStore(), [])
  const controls = useControlValues(store)
  // Opens on autopilot, paused at the start: press Play to watch its run (LocalMAP's or PaCMAP's).
  const [autopilot, setAutopilot] = useState(true)

  // Autopilot follows the iteration (steps since reset) rather than the looping playhead: once its run's schedule is
  // over, it stays in the last phase, as PaCMAP does given more iterations, so a leaning map can keep moving.
  const getWeights = useCallback(
    (): Weights =>
      autopilot ? pacmapWeights(engine.steps, meta.schedule) : mapValues(store.get(), (u, type) => toMultiplier(u, scale[type])),
    [autopilot, engine, meta.schedule, store, scale],
  )
  // LocalMAP's additions at an iteration under autopilot: none when it plays PaCMAP.
  const autopilotLocal = useCallback(
    (iteration: number) =>
      local.autopilotPlays === 'localmap'
        ? localmapAt(iteration, meta.schedule, meta.localmap.resampleEvery)
        : { boost: false, resampleAfter: false },
    [local.autopilotPlays, meta.schedule, meta.localmap.resampleEvery],
  )
  const beforeStep = useCallback(
    () => {
      const on = autopilot ? autopilotLocal(engine.steps).boost : boost
      engine.setBoost(on ? local.thres / 2 : null)
    },
    [autopilot, autopilotLocal, boost, engine, local.thres],
  )
  // What's been played this loop, for the schedule graph; cleared as the loop wraps. Then LocalMAP's redraws:
  // on its schedule under autopilot, or every so many steps when auto-resampling.
  const trail = useMemo(() => new Trail(length), [length])
  const onStep = useCallback(
    (playhead: number, w: Weights) => {
      trail.record(playhead, w)
      // The step just taken was iteration engine.steps - 1.
      if (autopilot ? autopilotLocal(engine.steps - 1).resampleAfter : autoResample && engine.steps % local.resampleEvery === 0) {
        resample()
        trail.recordResample(playhead)
      }
    },
    [trail, autopilot, autopilotLocal, autoResample, engine, local.resampleEvery, resample],
  )
  // The playhead loops, autopilot's run held in its last phase once over, as manual play does.
  const clock = useLoopClock(engine, length, getWeights, true, settings.rate, settings.interpolate, onStep, true, beforeStep)
  // The Reset button: back to the start (the initial layout, PaCMAP's far pairs), stopped there until Start simulation.
  const reset = () => {
    trail.clear()
    clock.reset(true)
    setFar(GLOBAL_FAR)
    setFpVersion(engine.fpVersion)
  }
  // A new engine (another dimension or sample size) starts from its own initial layout, so the
  // loop starts over too: in an effect, once the old engine's clock has stopped stepping.
  const lastEngine = useRef(engine)
  const resetClock = clock.reset
  useEffect(() => {
    if (engine === lastEngine.current) return
    lastEngine.current = engine
    trail.clear()
    resetClock()
  }, [engine, trail, resetClock])

  // Tell the optimiser when a control has moved far enough (only the kicking Adam listens).
  useEffect(() => {
    let last = store.get()
    return store.subscribe(() => {
      const now = store.get()
      if (PAIR_TYPES.some((type) => Math.abs(now[type] - last[type]) >= KICK_THRESHOLD)) {
        last = now
        engine.optimiser.onControlChange?.()
      }
    })
  }, [store, engine])

  // Under autopilot the sliders follow PaCMAP's forces (LocalMAP's are the same); grabbing one takes over from exactly there.
  const shown: ControlValues = autopilot
    ? mapValues(pacmapWeights(clock.steps, meta.schedule), (w, type) => toU(w, scale[type]))
    : controls
  const liveWeights = getWeights()
  const boostShown = autopilot ? autopilotLocal(clock.steps).boost : boost
  // Autopilot past its run's schedule, holding the last phase.
  const held = autopilot && clock.steps >= length
  const pacmapAutopilot = autopilot && local.autopilotPlays === 'pacmap'
  // Leaving autopilot, by grabbing a slider or pressing Manual, keeps its forces (and boost) where they are.
  const takeOver = () => {
    if (!autopilot) return
    store.setAll(shown)
    setBoost(boostShown)
    setAutopilot(false)
  }
  // Choosing an algorithm puts autopilot on, playing it; manual takes over from its forces.
  const choosePilot = (pilot: Pilot) => {
    if (pilot === 'manual') return takeOver()
    if (pilot !== local.autopilotPlays) set('local', (l) => ({ ...l, autopilotPlays: pilot }))
    setAutopilot(true)
  }
  const onBoost = (on: boolean) => {
    takeOver()
    setBoost(on)
  }

  // A redraw by hand (a button, or MIDI), marked on the schedule graph where the playhead is.
  const resampleNow = () => {
    resample()
    trail.recordResample(clock.playhead)
  }

  // A bound force behaves like its slider (including taking over from autopilot); speed drives
  // the current optimiser's speed on the speed slider's 0.1x-10x log scale.
  const midi = useMidi((target, u) => {
    if (target === 'speed')
      set('optimiser', (o) => ({ ...o, speed: { ...o.speed, [o.kind]: Number((10 ** u).toPrecision(2)) } }))
    else {
      takeOver()
      store.set(target, u)
    }
  }, resampleNow)
  // Each slider follows how its MIDI control behaves whenever that changes (a layout applied, a
  // control learnt, its 0 point moved): pitch bend springs back, and a control with 0 at the
  // bottom draws its slider unsplit. In between, spring and split are yours to change, and are remembered, so
  // the modes there are on opening count as seen.
  const modes = mapValues(midi.zeros, (zero, type) => `${midi.bindings[type]?.kind ?? 'none'}:${zero}`)
  const [seenModes, setSeenModes] = useState<Record<PairType, string>>(modes)
  const changed = PAIR_TYPES.filter((type) => seenModes[type] !== modes[type])
  if (changed.length) {
    setSeenModes(modes)
    const pick = <T,>(prev: Record<PairType, T>, f: (type: PairType) => T) =>
      mapValues(prev, (v, type) => (changed.includes(type) ? f(type) : v))
    set('spring', (prev) => pick(prev, (type) => midi.bindings[type]?.kind === 'pitchbend'))
    set('split', (prev) => pick(prev, (type) => midi.zeros[type] === 'centre'))
  }

  // Forces played from a fader (a CC) show where that fader sits, as MIDI Surf shows it.
  const faderZero = Object.fromEntries(
    PAIR_TYPES.map((type) => [type, midi.bindings[type]?.kind === 'cc' ? midi.zeros[type] : null]),
  ) as Record<PairType, Zero | null>

  // The drawer is always there, at one of two heights: closed, only the transport bar on its top edge shows; open,
  // its tabs show too.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<string>('forces')
  const [infoOpen, setInfoOpen] = useState(false)
  // The dimension last moved to, named for a moment over its button.
  const [modeLabelShown, setModeLabelShown] = useState(false)
  const modeLabelTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(modeLabelTimer.current), [])
  const otherDim = dim === 3 ? 2 : 3
  const switchDim = () => {
    set('dim', otherDim)
    setModeLabelShown(true)
    clearTimeout(modeLabelTimer.current)
    modeLabelTimer.current = setTimeout(() => setModeLabelShown(false), MODE_LABEL_MS)
  }
  const [barHeight, setBarHeight] = useState(64)
  // A callback ref, as the drawer's portal mounts its content after the page does.
  const barEl = useRef<HTMLDivElement | null>(null)
  const barRef = useCallback((bar: HTMLDivElement | null) => {
    barEl.current = bar
    if (!bar) return
    const observer = new ResizeObserver(() => setBarHeight(Math.ceil(bar.getBoundingClientRect().height)))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  const windowHeight = useWindowHeight()
  const panelHeight = Math.round(Math.min(windowHeight * 0.55, 560))
  const closedSnap = `${barHeight}px`
  const openSnap = `${barHeight + panelHeight}px`
  // Where the drawer's top edge is right now, mid-move or mid-drag too, as the plot centres above it.
  const drawerCovers = useCallback(() => {
    const drawer = barEl.current?.parentElement
    return drawer ? window.innerHeight - drawer.getBoundingClientRect().top : 0
  }, [])

  return (
    <>
      {/* The plot fills the window, behind the drawer, and centres in what the drawer leaves (as a map would), so it
          never resizes as the drawer moves. */}
      <div className="fixed inset-0">
        <Scatter
          className="h-full"
          coveredBottom={drawerCovers}
          Y={clock.display}
          dim={dim}
          labels={meta.labels}
          shown={digitsShown}
          version={clock.version}
          autoRotate={autoRotate}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={setHovered}
          edges={edges}
          weights={liveWeights}
          reach={!far.global || tab === 'local' ? local.thres : null}
          follow={settings.followSelected ? selected : null}
          // Painting takes over from autopilot, as touching a force does, and stops auto-resampling: from then on only
          // brushed digits' far pairs are redrawn.
          brush={
            brushOn
              ? {
                  radius: local.thres * local.brushRatio,
                  reach: local.thres,
                  // The wheel sizes the brush, as a share of the threshold, rather than zooming.
                  onScale: (factor) => set('local', (l) => ({ ...l, brushRatio: clampBrushRatio(l.brushRatio * factor) })),
                  onPaint: (points) => {
                    takeOver()
                    setAutoResample(false)
                    paintResample(points)
                  },
                }
              : null
          }
          corner={
            <DigitPreview
              pixels={pixels}
              index={previewed}
              label={previewed === null ? null : meta.labels[previewed]}
              hovering={previewed !== selected}
            />
          }
        >
          <DigitPicker shown={digitsShown} onShown={(v) => set('digitsShown', v)} />
        </Scatter>
      </div>
      {/* What sits over the plot, kept clear of the drawer. The buttons sit on the drawer's top edge, so they rise and
          fall with it. */}
      <main
        className="pointer-events-none fixed inset-x-0 top-0"
        style={{ bottom: drawerOpen ? openSnap : closedSnap, transition: `bottom ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto absolute bottom-0 left-3 rounded-b-none bg-background/85 text-muted-foreground hover:text-foreground"
          onClick={() => setInfoOpen(true)}
          aria-label="About"
        >
          <Info />
        </Button>
        {/* The brush: painting the plot redraws the far pairs of the digits under it, and no others; with + beside it on,
            it adds far pairs to them instead (upsampling), keeping those they have. */}
        <div className="pointer-events-auto absolute bottom-0 left-14 flex" role="group" aria-label="Brush">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-r-none rounded-b-none bg-background/85 text-muted-foreground hover:text-foreground"
            // On, it takes the far pairs' colour, as its ring does.
            style={brushOn ? { background: FORCE_COLORS.fp, color: 'white' } : undefined}
            onClick={() => setBrushOn(!brushOn)}
            aria-pressed={brushOn}
            aria-label={`${local.brushAdds ? 'Upsample' : 'Resample'} brush: paint the plot to ${local.brushAdds ? 'add far pairs to' : 'redraw the far pairs of'} the digits under it`}
            title={`${local.brushAdds ? 'Upsample brush: paint to add far pairs' : 'Resample brush: paint to redraw far pairs'} under it${brushOn ? ' (click to turn off)' : ''}`}
          >
            <span className="relative">
              <Brush />
              {local.brushAdds && <span className="absolute -top-1.5 -right-2 text-xs leading-none font-bold" aria-hidden>+</span>}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 rounded-l-none rounded-b-none border-l border-border/60 bg-background/85 text-base font-semibold text-muted-foreground hover:text-foreground"
            style={local.brushAdds ? { color: FORCE_COLORS.fp } : undefined}
            onClick={() => set('local', (l) => ({ ...l, brushAdds: !l.brushAdds }))}
            aria-pressed={local.brushAdds}
            aria-label="Brush adds far pairs (upsampling) rather than redrawing them"
            title={local.brushAdds ? 'Brush adds far pairs, keeping the old (click to redraw instead)' : 'Brush redraws far pairs (click to add instead, keeping the old)'}
          >
            +
          </Button>
        </div>
        <span
          className="pointer-events-none absolute right-3 bottom-11 rounded-md bg-foreground/75 px-2 py-0.5 text-xs text-background transition-opacity duration-300 motion-reduce:transition-none"
          style={{ opacity: modeLabelShown ? 1 : 0 }}
          aria-hidden
        >
          {dim}D
        </span>
        {/* Starts over from that dimension's initial layout, as the view tab's buttons do. */}
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto absolute right-3 bottom-0 rounded-b-none bg-background/85 text-muted-foreground hover:text-foreground"
          onClick={switchDim}
          aria-label={`${dim}D. Switch to ${otherDim}D, starting over.`}
        >
          {dim === 3 ? <Box /> : <Square />}
        </Button>
      </main>

      <Drawer
        open
        modal={false}
        dismissible={false}
        handleOnly
        snapPoints={[closedSnap, openSnap]}
        activeSnapPoint={drawerOpen ? openSnap : closedSnap}
        setActiveSnapPoint={(snap) => setDrawerOpen(snap === openSnap)}
      >
        <DrawerContent className="h-full" aria-describedby={undefined}>
          <DrawerTitle className="sr-only">Playback and settings</DrawerTitle>
          <div ref={barRef} className="shrink-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <DrawerHandle className="mb-2" />
            <TransportBar
              status={clock.status}
              playhead={held ? length : clock.playhead}
              schedule={meta.schedule}
              length={length}
              phase={held ? 3 : phaseOf(clock.playhead, meta.schedule)}
              held={held}
              steps={clock.steps}
              autopilot={autopilot ? local.autopilotPlays : null}
              onPause={clock.pause}
              onResume={clock.resume}
              onReset={reset}
              loading={loading}
              loadError={loadError}
              size={size}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDrawerOpen(!drawerOpen)}
                aria-label={drawerOpen ? 'Hide settings' : 'Show settings'}
                aria-expanded={drawerOpen}
              >
                {drawerOpen ? <ChevronDown /> : <ChevronUp />}
              </Button>
            </TransportBar>
          </div>
          {/* Out of reach of focus while closed, as it's out of sight. The panel inside stays on the window's bottom,
              moving against the drawer as it moves (with vaul's own easing, so in step), so opening the drawer uncovers
              it from the bottom up: tabs first, then settings. */}
          <div className="overflow-hidden border-t" style={{ height: panelHeight }} inert={!drawerOpen}>
            <div
              className="flex h-full flex-col"
              style={{ transform: `translateY(${drawerOpen ? 0 : -panelHeight}px)`, transition: `transform ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
            >
              <DrawerDescription className="sr-only">The forces, and settings grouped in tabs.</DrawerDescription>
              <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
                  <TabsContent value="forces" className="flex h-full flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      {/* On by choosing an algorithm; off by choosing manual or touching a force, taking over from its forces. */}
                      <div className="flex items-center gap-2" role="group" aria-label="Autopilot">
                        <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                          <Plane className="size-4" aria-hidden /> autopilot
                        </span>
                        <Segmented options={PILOTS} value={autopilot ? local.autopilotPlays : 'manual'} onChange={choosePilot} labels={PILOT_LABELS} />
                      </div>
                      <span className="text-right text-xs text-muted-foreground">↑ attract · ↓ repel, PaCMAP's own marked</span>
                    </div>
                    <ForceSliders
                      values={shown}
                      scale={scale}
                      onScale={(type, s) => set('scale', (prev) => ({ ...prev, [type]: s }))}
                      spring={spring}
                      onSpring={(type, s) => set('spring', (prev) => ({ ...prev, [type]: s }))}
                      split={split}
                      onSplit={(type, s) => set('split', (prev) => ({ ...prev, [type]: s }))}
                      faderZero={faderZero}
                      onGrab={takeOver}
                      onChange={(type, u) => store.set(type, u)}
                      header={{
                        // Out of the way while autopilot plays PaCMAP, which has neither (the local tab still has both).
                        nb: <Toggle label="boost" checked={boostShown} onChange={onBoost} disabled={pacmapAutopilot} />,
                        fp: <ResampleButton compact far={far} onResample={resampleNow} disabled={pacmapAutopilot} />,
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="lean">
                    <LeanPanel
                      lean={lean}
                      onLean={(type, v) => setLean((prev) => ({ ...prev, [type]: v }))}
                      scrambled={scrambled}
                      onScrambled={setScrambled}
                      oneWay={oneWay}
                    />
                  </TabsContent>
                  <TabsContent value="local">
                    <LocalPanel
                      settings={local}
                      onSettings={(v) => set('local', v)}
                      far={far}
                      onResample={resampleNow}
                      onRestore={restore}
                      autoResample={autoResample}
                      onAutoResample={setAutoResample}
                      boost={boostShown}
                      onBoost={onBoost}
                    />
                  </TabsContent>
                  <TabsContent value="play" className="flex flex-col gap-8">
                    <PlaySection
                      rate={settings.rate}
                      onRate={(v) => set('rate', v)}
                      interpolate={settings.interpolate}
                      onInterpolate={(v) => set('interpolate', v)}
                      wakeLock={settings.wakeLock}
                      onWakeLock={(v) => set('wakeLock', v)}
                    />
                    <Section title="Schedule" description="PaCMAP's forces over one loop, dashed (LocalMAP's are the same), with what you've played this loop over them. Ticks along the bottom mark far-pair redraws: LocalMAP's dashed, yours this loop solid.">
                      <ScheduleGraph
                        schedule={meta.schedule}
                        scale={spanning(PAIR_TYPES.map((type) => scale[type]))}
                        playhead={clock.playhead}
                        current={liveWeights}
                        trail={trail}
                        localmapResamples={localmapResamples}
                      />
                    </Section>
                  </TabsContent>
                  <TabsContent value="view">
                    <ViewSection
                      dim={dim}
                      onDim={(v) => set('dim', v)}
                      autoRotate={autoRotate}
                      onAutoRotate={(v) => set('autoRotate', v)}
                      followSelected={settings.followSelected}
                      onFollowSelected={(v) => set('followSelected', v)}
                      size={size}
                      onSize={(v) => set('size', v)}
                    />
                  </TabsContent>
                  <TabsContent value="optimiser">
                    <OptimiserPanel settings={optimiser} onChange={(v) => set('optimiser', v)} />
                  </TabsContent>
                  <TabsContent value="midi">
                    <MidiPanel midi={midi} />
                  </TabsContent>
                </div>
                {/* A menu bar along the bottom. */}
                <TabsList className="h-auto w-full rounded-none border-t px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
                  {TABS.map(({ value, label, icon: Icon }) => (
                    <TabsTrigger key={value} value={value} className="flex-col gap-0.5 py-1.5 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
                      <Icon /> {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Asymmetric LocalMAP</SheetTitle>
            <SheetDescription>
              LocalMAP's optimisation, live in the browser on {meta.nSamples.toLocaleString()} MNIST digits, with its
              forces leaning. Every pair is one digit's choice (its neighbours are its nearest in the data), and PaCMAP pulls
              or pushes both ends equally, so its map settles. Here a force can lean toward one end: only where the data's
              relationships are one-way does that move anything, and there the map keeps moving. Autopilot plays LocalMAP's
              run and then holds its last phase; the lean tab sets the leans, and scrambles who chose whom to compare.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 text-sm text-muted-foreground">
            <p>Settings are remembered in this browser; MIDI bindings are kept separately.</p>
            <Button variant="outline" className="self-start" onClick={onResetSettings}>
              Reset settings to their defaults
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default function App() {
  const { settings, set, reset } = useSettings()
  const { data, dataSize, error, loading } = useData(settings.size)
  if (!data) return <p className="p-12 text-muted-foreground">{error ?? 'Loading…'}</p>
  return <Playground data={data} settings={settings} set={set} onResetSettings={reset} dataSize={dataSize!} loading={loading} loadError={error} />
}
