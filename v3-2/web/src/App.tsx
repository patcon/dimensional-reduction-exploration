import { Bookmark, Eye, Gauge, Hash, ScanSearch, Shapes } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChordViz } from './components/ChordViz'
import { Section } from './components/controls'
import { DigitPreview } from './components/DigitPreview'
import { GroupLegend } from './components/GroupLegend'
import { Matrix } from './components/Matrix'
import { PresetsPanel } from './components/Presets'
import { GroupingSection, ParticleSection, ReadingSection, SampleSection, StyleSection, ViewSection } from './components/SettingsPanels'
import { PlaybackSection, TransportBar } from './components/Transport'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { groupColors } from './palette'
import { usePlayhead } from './playhead'
import { useSettings } from './presets'
import { chordSlots, groupParticipants, pcsOf, pickRows, windowFeatures, type Grouping } from './selection'
import { buildTraces } from './signal'
import { useData, type PoolData } from './useData'
import { usePresets } from './usePresets'
import { MAX_CHORDS } from './vizSettings'

/** Moments sampled across the trail's window when clustering over it. */
const WINDOW_SAMPLES = 32
/** vaul's own easing and duration, so the visualiser makes room as the drawer moves. */
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DRAWER_SECONDS = 0.5

/** The drawer's tabs, in order. */
const TABS = [
  { value: 'playback', label: 'Play', icon: Gauge },
  { value: 'digits', label: 'Digits', icon: Hash },
  { value: 'groups', label: 'Groups', icon: Shapes },
  { value: 'view', label: 'View', icon: Eye },
  { value: 'inspect', label: 'Inspect', icon: ScanSearch },
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

function Explorer({ data }: { data: PoolData }) {
  const { meta, pixels, pcs } = data
  const labels = meta.rows.label

  // Every setting, as presets save and load them; the playhead follows its speed and looping.
  const { settings, setSettings, set, patch } = useSettings()
  const editor = { settings, set, patch }
  const { count, seed, groupBy, resolution, neighbours, clusterOver, clusterRate, order, signal, view, geometry, style, trailSeconds, particles, focus } = settings
  const digits = useMemo(() => new Set(settings.digits), [settings.digits])
  const setFocus = (i: number) => set('focus', i)
  const presets = usePresets(settings, setSettings)

  const [particleReset, setParticleReset] = useState(0)
  const [cameraReset, setCameraReset] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = usePlayhead()
  useEffect(() => playhead.setSpeed(settings.speed), [playhead, settings.speed])
  useEffect(() => playhead.setLoop(settings.loop), [playhead, settings.loop])
  const trailPixels = trailSeconds * settings.speed

  const available = useMemo(() => labels.filter((l) => digits.has(l)).length, [labels, digits])
  const maxCount = Math.min(MAX_CHORDS, available)
  const shownCount = Math.min(count, maxCount)
  const rows = useMemo(() => pickRows(labels, digits, shownCount, seed), [labels, digits, shownCount, seed])
  const points = useMemo(() => pcsOf(pcs, meta.nPcs, rows), [pcs, meta.nPcs, rows])
  const rowLabels = useMemo(() => rows.map((r) => labels[r]), [rows, labels])
  const fullGrouping = useMemo(
    () => groupParticipants(rowLabels, points, meta.nPcs, groupBy, { resolution, neighbours, seed }),
    [rowLabels, points, meta.nPcs, groupBy, resolution, neighbours, seed],
  )
  const traces = useMemo(() => buildTraces(pixels, rows, signal), [pixels, rows, signal])
  useEffect(() => playhead.setLength(traces.length), [playhead, traces.length])
  useEffect(() => playhead.resetLaps(), [playhead, traces])

  // Clustering over the trail's window: re-run `clusterRate` times a second while the playhead moves, each run
  // starting from the last one's clusters (or the full clustering's, at first) and keeping their ids.
  const windowed = groupBy === 'leiden' && clusterOver === 'window'
  const [windowGrouping, setWindowGrouping] = useState<{ rows: number[]; grouping: Grouping } | null>(null)
  const lastWindow = useRef<{ rows: number[]; grouping: Grouping } | null>(null)
  useEffect(() => {
    if (!windowed) return
    let lastMoment = NaN
    const run = () => {
      if (playhead.moment === lastMoment) return
      lastMoment = playhead.moment
      const previous = lastWindow.current?.rows === rows ? lastWindow.current.grouping : fullGrouping
      const features = windowFeatures(traces, playhead.moment, trailPixels, WINDOW_SAMPLES, playhead.wraps)
      const grouping = groupParticipants(rowLabels, features, WINDOW_SAMPLES, 'leiden', { resolution, neighbours, seed }, previous)
      lastWindow.current = { rows, grouping }
      setWindowGrouping(lastWindow.current)
    }
    run()
    const id = setInterval(run, 1000 / clusterRate)
    return () => clearInterval(id)
  }, [windowed, clusterRate, rows, rowLabels, traces, playhead, trailPixels, resolution, neighbours, seed, fullGrouping])
  const grouping = windowed && windowGrouping?.rows === rows ? windowGrouping.grouping : fullGrouping

  const colors = useMemo(() => groupColors(grouping), [grouping])
  const slotOf = useMemo(() => chordSlots(grouping, points, meta.nPcs, order), [grouping, points, meta.nPcs, order])

  const followed = focus !== null && focus < rows.length ? focus : rows.length ? 0 : null
  const shown = hover ?? followed

  // The drawer is always there, at one of two heights: closed, only the playback bar on its top edge shows; open,
  // its tabs show too. The visualiser takes the rest of the window, above it.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<string>('playback')
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [barHeight, setBarHeight] = useState(64)
  // A callback ref, as the drawer's portal mounts its content after the page does.
  const barRef = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return
    const observer = new ResizeObserver(() => setBarHeight(Math.ceil(bar.getBoundingClientRect().height)))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  const windowHeight = useWindowHeight()
  const panelHeight = Math.round(Math.min(windowHeight * 0.5, 560))
  const closedSnap = `${barHeight}px`
  const openSnap = `${barHeight + panelHeight}px`

  return (
    <>
      <main
        className="fixed inset-x-0 top-0 overflow-hidden bg-viz"
        style={{ bottom: drawerOpen ? openSnap : closedSnap, transition: `bottom ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
      >
        <ChordViz
          traces={traces}
          pickKey={rows}
          playhead={playhead}
          slotOf={slotOf}
          groupOf={grouping.groupOf}
          colors={colors}
          focus={followed}
          view={view}
          geometry={geometry}
          style={style}
          trailSeconds={trailSeconds}
          particles={particles}
          particleReset={particleReset}
          cameraReset={cameraReset}
          onFocus={setFocus}
          onHover={setHover}
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          onClick={() => setPresetsOpen(true)}
          aria-label="Presets"
        >
          <Bookmark />
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
            <TransportBar playhead={playhead} traces={traces} open={drawerOpen} onOpen={setDrawerOpen} />
          </div>
          {/* Out of reach of focus while closed, as it's out of sight. */}
          <div className="flex flex-col border-t" style={{ height: panelHeight }} inert={!drawerOpen}>
            <DrawerDescription className="sr-only">Settings, grouped in tabs, for what the visualiser shows.</DrawerDescription>
            <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
              <TabsList className="mx-3 mt-2 h-auto w-auto">
                {TABS.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger key={value} value={value} className="flex-col gap-0.5 py-1.5 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
                    <Icon /> {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
                <TabsContent value="playback">
                  <PlaybackSection
                    playhead={playhead}
                    traces={traces}
                    speed={settings.speed}
                    onSpeed={(v) => set('speed', v)}
                    loop={settings.loop}
                    onLoop={(v) => set('loop', v)}
                    trailSeconds={trailSeconds}
                    onTrailSeconds={(v) => set('trailSeconds', v)}
                  />
                </TabsContent>
                <TabsContent value="digits" className="flex flex-col gap-8">
                  <SampleSection {...editor} available={available} shownCount={shownCount} maxCount={maxCount} />
                  <ReadingSection {...editor} />
                </TabsContent>
                <TabsContent value="groups" className="flex flex-col gap-8">
                  <GroupingSection {...editor} grouping={grouping} />
                  <Section title="Mean valence now" description="Tap a group, or one of its digits, to follow it.">
                    <GroupLegend
                      groups={grouping.groups}
                      groupOf={grouping.groupOf}
                      colors={colors}
                      traces={traces}
                      playhead={playhead}
                      trailPixels={trailPixels}
                      pixels={pixels}
                      rows={rows}
                      hover={hover}
                      onFocus={setFocus}
                      onHover={setHover}
                    />
                  </Section>
                </TabsContent>
                <TabsContent value="view" className="flex flex-col gap-8">
                  <ViewSection {...editor} onView={(v) => (v === view ? setCameraReset((r) => r + 1) : set('view', v))} />
                  {geometry === 'particle' && <ParticleSection {...editor} onScatter={() => setParticleReset((r) => r + 1)} />}
                  <StyleSection {...editor} />
                </TabsContent>
                <TabsContent value="inspect" className="flex flex-col gap-8">
                  <Section title="Followed digit" description="Tap or drag across the digit to move the playhead to where a pixel is read.">
                    {shown !== null && (
                      <DigitPreview
                        pixels={pixels}
                        poolRow={rows[shown]}
                        participant={shown}
                        label={labels[rows[shown]]}
                        groupName={grouping.groups[grouping.groupOf[shown]].name}
                        groupColor={colors[grouping.groupOf[shown]]}
                        traces={traces}
                        playhead={playhead}
                        trailPixels={trailPixels}
                        following={hover === null}
                      />
                    )}
                  </Section>
                  <Section title="Matrix" description="One row per digit, in chord order, one column per pixel. Tap a row to follow that digit.">
                    <Matrix
                      traces={traces}
                      slotOf={slotOf}
                      groupOf={grouping.groupOf}
                      colors={colors}
                      grouped={order === 'grouped'}
                      focus={followed}
                      hover={hover}
                      onFocus={setFocus}
                      onHover={setHover}
                      playhead={playhead}
                      trailPixels={trailPixels}
                    />
                  </Section>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </DrawerContent>
      </Drawer>

      <Sheet open={presetsOpen} onOpenChange={setPresetsOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Presets</SheetTitle>
            <SheetDescription>
              Valence particles from MNIST: each digit's pixels, read in order, are one participant's valence over time (paper −1, ink +1). Save
              the settings you've arrived at, or carry them between browsers as files.
            </SheetDescription>
          </SheetHeader>
          <PresetsPanel store={presets} />
        </SheetContent>
      </Sheet>
    </>
  )
}

export default function App() {
  const { data, error } = useData()
  if (error) return <p className="p-12 text-muted-foreground">{error}</p>
  if (!data) return <p className="p-12 text-muted-foreground">Loading digits…</p>
  return <Explorer data={data} />
}
