import { Box, ChevronDown, ChevronUp, Eye, Footprints, Gauge, Info, KeyboardMusic, Magnet, Plane, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DigitPicker } from './components/DigitPicker'
import { DigitPreview } from './components/DigitPreview'
import { ForceSliders } from './components/ForceSliders'
import { MidiPanel } from './components/MidiPanel'
import { OptimiserPanel } from './components/OptimiserPanel'
import { Scatter } from './components/Scatter'
import { ScheduleGraph } from './components/ScheduleGraph'
import { Section } from './components/controls'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { PlaySection, TransportBar, ViewSection } from './components/Transport'
import { Engine } from './engine'
import { spanning, toMultiplier, toU } from './forceScale'
import { InputStore, useControlValues, type ControlValues } from './inputStore'
import { DEFAULT_OPTIMISER, OptimiserBank } from './optimisers'
import { useSettings, type SetSetting, type Settings } from './settings'
import { pacmapWeights, phaseOf, scheduleLength, Trail } from './schedule'
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
  { value: 'play', label: 'Play', icon: Gauge },
  { value: 'view', label: 'View', icon: Eye },
  { value: 'optimiser', label: 'Optimiser', icon: Footprints },
  { value: 'midi', label: 'MIDI', icon: KeyboardMusic },
] as const

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
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const pixels = useDigits(dataSize)
  // Other digits, so whatever was picked is gone.
  const [pickedIn, setPickedIn] = useState(data)
  if (pickedIn !== data) {
    setPickedIn(data)
    setSelected(null)
    setHovered(null)
  }
  if (selected !== null && !digitsShown[meta.labels[selected]]) setSelected(null)
  if (hovered !== null && !digitsShown[meta.labels[hovered]]) setHovered(null)
  const previewed = hovered ?? selected
  const edges = useMemo(() => (selected === null ? null : partnersOf(data.pairs, selected)), [data.pairs, selected])
  const optimisers = useMemo(() => new OptimiserBank(data.init[dim].length, meta.adam, dim), [data, meta.adam, dim])
  const engine = useMemo(
    () => new Engine(data.pairs, data.init[dim], optimisers.configure(DEFAULT_OPTIMISER), dim),
    [data, optimisers, dim],
  )
  const length = scheduleLength(meta.schedule)

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
  // What's been played this loop, for the schedule graph; cleared as the loop wraps.
  const trail = useMemo(() => new Trail(length), [length])
  const onStep = useCallback((playhead: number, w: Weights) => trail.record(playhead, w), [trail])
  // Autopilot plays PaCMAP's schedule once and stops; manual play loops.
  const clock = useLoopClock(engine, length, getWeights, !autopilot, settings.rate, settings.interpolate, onStep, true)
  // The Reset button: back to the start, stopped there until Start simulation.
  const reset = () => {
    trail.clear()
    clock.reset(true)
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
  // Leaving autopilot, by grabbing a slider or pressing Manual, keeps its forces where they are.
  const takeOver = () => {
    if (!autopilot) return
    store.setAll(shown)
    setAutopilot(false)
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
  })
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
                    <div className="flex items-center justify-between gap-3">
                      {/* On by a press; off by touching a force (or pressing it again), taking over from its forces. */}
                      <Button
                        variant={autopilot ? 'default' : 'outline'}
                        size="sm"
                        className="shrink-0"
                        onClick={() => (autopilot ? takeOver() : setAutopilot(true))}
                        aria-pressed={autopilot}
                      >
                        <Plane /> autopilot
                      </Button>
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
            <SheetTitle>Playable PaCMAP</SheetTitle>
            <SheetDescription>
              PaCMAP's optimisation, live in the browser on {meta.nSamples.toLocaleString()} MNIST digits. The neighbour,
              mid-near and far pairs are fixed; the forces on them are yours to play. A loop runs over PaCMAP's
              450-iteration schedule; autopilot plays PaCMAP's own forces along it.
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
