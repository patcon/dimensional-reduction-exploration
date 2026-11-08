import { Box, ChevronDown, ChevronUp, Eye, Footprints, Gauge, Info, KeyboardMusic, Magnet, Plane, Shuffle, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DigitPicker } from './components/DigitPicker'
import { DigitPreview } from './components/DigitPreview'
import { ForceSliders } from './components/ForceSliders'
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
import { spanning, toMultiplier, toU } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DEFAULT_OPTIMISER, OptimiserBank } from './optimisers'
import { useSettings, type Algorithm, type SetSetting, type Settings } from './settings'
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
  { value: 'local', label: 'Local', icon: Shuffle },
  { value: 'play', label: 'Play', icon: Gauge },
  { value: 'view', label: 'View', icon: Eye },
  { value: 'optimiser', label: 'Optimiser', icon: Footprints },
  { value: 'midi', label: 'MIDI', icon: KeyboardMusic },
] as const

/** What autopilot plays, or none: off, the forces are yours. */
type Pilot = Algorithm | 'none'
const PILOTS: Pilot[] = ['localmap', 'pacmap', 'none']
const PILOT_LABELS: Record<Pilot, string> = { localmap: 'LocalMAP', pacmap: 'PaCMAP', none: 'none' }

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

/** Every partner of digit `i` in each pair type, whichever end of the pair it's at, as both ends feel its force. */
function partnersOf(pairs: Pairs, i: number) {
  return mapValues(pairs, (flat) => {
    const partners: number[] = []
    for (let k = 0; k < flat.length; k += 2) {
      if (flat[k] === i) partners.push(flat[k + 1])
      else if (flat[k + 1] === i) partners.push(flat[k])
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
    () => (selected === null ? null : partnersOf(engine.pairs, selected)),
    // fpVersion: the far pairs change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, fpVersion, selected],
  )
  const resample = useCallback(() => {
    const r = engine.resampleFar(local.thres)
    setFar({ global: false, last: { ...r, step: engine.steps } })
    setFpVersion(engine.fpVersion)
  }, [engine, local.thres])
  const restore = () => {
    engine.restoreFar()
    setFar(GLOBAL_FAR)
    setFpVersion(engine.fpVersion)
  }
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
  // Opens on autopilot, paused at the start: press Play to watch PaCMAP's own run.
  const [autopilot, setAutopilot] = useState(true)

  const getWeights = useCallback(
    (playhead: number): Weights =>
      autopilot ? pacmapWeights(playhead, meta.schedule) : mapValues(store.get(), (u, type) => toMultiplier(u, scale[type])),
    [autopilot, meta.schedule, store, scale],
  )
  // LocalMAP's additions at a playhead under autopilot: none when it plays PaCMAP.
  const autopilotLocal = useCallback(
    (playhead: number) =>
      local.autopilotPlays === 'localmap'
        ? localmapAt(playhead, meta.schedule, meta.localmap.resampleEvery)
        : { boost: false, resampleAfter: false },
    [local.autopilotPlays, meta.schedule, meta.localmap.resampleEvery],
  )
  const beforeStep = useCallback(
    (playhead: number) => {
      const on = autopilot ? autopilotLocal(playhead).boost : boost
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
      if (autopilot ? autopilotLocal(playhead).resampleAfter : autoResample && engine.steps % local.resampleEvery === 0) resample()
    },
    [trail, autopilot, autopilotLocal, autoResample, engine, local.resampleEvery, resample],
  )
  // Autopilot plays PaCMAP's schedule once and stops; manual play loops.
  const clock = useLoopClock(engine, length, getWeights, !autopilot, settings.rate, settings.interpolate, onStep, true, beforeStep)
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

  // Under autopilot the sliders follow PaCMAP's forces; grabbing one takes over from exactly there.
  const shown: ControlValues = autopilot
    ? mapValues(pacmapWeights(clock.playhead, meta.schedule), (w, type) => toU(w, scale[type]))
    : controls
  const liveWeights = getWeights(clock.playhead)
  const boostShown = autopilot ? autopilotLocal(clock.playhead).boost : boost
  // Leaving autopilot, by grabbing a slider or pressing Manual, keeps its forces (and boost) where they are.
  const takeOver = () => {
    if (!autopilot) return
    store.setAll(shown)
    setBoost(boostShown)
    setAutopilot(false)
  }
  // Choosing an algorithm puts autopilot on, playing it; none takes over from its forces.
  const choosePilot = (pilot: Pilot) => {
    if (pilot === 'none') return takeOver()
    if (pilot !== local.autopilotPlays) set('local', (l) => ({ ...l, autopilotPlays: pilot }))
    setAutopilot(true)
  }
  const onBoost = (on: boolean) => {
    takeOver()
    setBoost(on)
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
  }, resample)
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
              playhead={clock.playhead}
              schedule={meta.schedule}
              length={length}
              phase={phaseOf(clock.playhead, meta.schedule)}
              steps={clock.steps}
              autopilot={autopilot}
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
                      {/* On by choosing an algorithm; off by choosing none or touching a force, taking over from its forces. */}
                      <div className="flex items-center gap-2" role="group" aria-label="Autopilot">
                        <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <Segmented options={PILOTS} value={autopilot ? local.autopilotPlays : 'none'} onChange={choosePilot} labels={PILOT_LABELS} />
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
                        nb: <Toggle label="boost" checked={boostShown} onChange={onBoost} />,
                        fp: <ResampleButton compact far={far} onResample={resample} />,
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="local">
                    <LocalPanel
                      settings={local}
                      onSettings={(v) => set('local', v)}
                      far={far}
                      onResample={resample}
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
                    <Section title="Schedule" description="PaCMAP's forces over one loop, dashed, with what you've played this loop over them.">
                      <ScheduleGraph
                        schedule={meta.schedule}
                        scale={spanning(PAIR_TYPES.map((type) => scale[type]))}
                        playhead={clock.playhead}
                        current={liveWeights}
                        trail={trail}
                      />
                    </Section>
                  </TabsContent>
                  <TabsContent value="view">
                    <ViewSection
                      dim={dim}
                      onDim={(v) => set('dim', v)}
                      autoRotate={autoRotate}
                      onAutoRotate={(v) => set('autoRotate', v)}
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
            <SheetTitle>Playable LocalMAP</SheetTitle>
            <SheetDescription>
              PaCMAP's optimisation, live in the browser on {meta.nSamples.toLocaleString()} MNIST digits, with LocalMAP's
              additions. The forces on the neighbour, mid-near and far pairs are yours to play, and the far pairs can be
              redrawn from the digits near each one, as LocalMAP does. A loop runs over PaCMAP's 450-iteration schedule;
              autopilot plays PaCMAP's or LocalMAP's own run along it.
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
