import { ChevronDown, ChevronUp, Dices, Info, Layers, Music, Pause, Play, Shapes, Shuffle, SlidersHorizontal, Waves } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import type { AnalysisRequest } from './analysis'
import type { AnalysisAnswer, WorkerMessage } from './analysis.worker'
import { DigitThumb } from './components/DigitThumb'
import { MapView } from './components/MapView'
import { DigitPicker, GroupsTab, MelodyTab, MixTab, MusicTab, nowText } from './components/Panels'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { MusicWalk } from './music'
import { broadColor, rgbCss } from './palette'
import { DEFAULT_SETTINGS, MAX_TARGET, NEIGHBOURS, targetOf, type Settings } from './settings'
import { useData, type MapData } from './useData'
import { WorkerQueue } from './workerQueue'

/** vaul's own easing and duration, so what sits over the map keeps clear of the drawer as it moves. */
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DRAWER_SECONDS = 0.5
/** Settings changes are grouped again once they settle for this long, in ms, as sliders move. */
const SETTLE_MS = 150
/** The count-up's step: a new number of groups this often, in ms. */
const TOUR_MS = 8000
const SEED = 1

/** The drawer's tabs, in order. */
const TABS = [
  { value: 'music', label: 'Music', icon: Music },
  { value: 'groups', label: 'Groups', icon: Shapes },
  { value: 'melody', label: 'Melody', icon: Waves },
  { value: 'mix', label: 'Mix', icon: SlidersHorizontal },
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

/** A button over the map, as v4's are. */
const overMap = 'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white'
const overMapOn = 'bg-white/90 text-black hover:bg-white hover:text-black'

function Explorer({ data }: { data: MapData }) {
  const { meta, pixels, pcs, umap, xy, labels } = data
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const patch = useCallback((changes: Partial<Settings>) => setSettings((s) => ({ ...s, ...changes })), [])
  const editor = { settings, patch }

  // The walker, and what it plays.
  const walk = useMemo(() => new MusicWalk(DEFAULT_SETTINGS), [])
  useEffect(() => () => walk.dispose(), [walk])
  const snapshot = useSyncExternalStore(walk.subscribe, walk.getSnapshot)
  const { music, playing, node } = snapshot
  // Each digit's notes are panned by where it sits on the map, left to right.
  const pan = useMemo(() => {
    let [x0, x1] = [Infinity, -Infinity]
    for (let r = 0; r < meta.nSamples; r++) [x0, x1] = [Math.min(x0, xy[2 * r]), Math.max(x1, xy[2 * r])]
    return (r: number) => ((xy[2 * r] - x0) / (x1 - x0 || 1)) * 1.4 - 0.7
  }, [xy, meta.nSamples])
  const { chord, bass, melody, stepsPerSecond, swing } = settings
  useEffect(() => walk.setSettings({ chord, bass, melody, stepsPerSecond, swing }, pan), [walk, chord, bass, melody, stepsPerSecond, swing, pan])

  // The map's groups, worked out in a worker (the latest asked for wins), once settings settle.
  const [analyser, setAnalyser] = useState<WorkerQueue<WorkerMessage, AnalysisAnswer> | null>(null)
  useEffect(() => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({ type: 'data', labels, pcs, nPcs: meta.nPcs, umap, umapDims: meta.umapDims } satisfies WorkerMessage)
    const queue = new WorkerQueue<WorkerMessage, AnalysisAnswer>(worker)
    setAnalyser(queue)
    return () => queue.close()
  }, [labels, pcs, umap, meta.nPcs, meta.umapDims])
  const distance = useCallback((a: number, b: number) => (xy[2 * a] - xy[2 * b]) ** 2 + (xy[2 * a + 1] - xy[2 * b + 1]) ** 2, [xy])
  const request: AnalysisRequest = useMemo(
    () => ({
      digits: settings.digits,
      method: settings.method,
      hdbscan: settings.hdbscan,
      resolution: settings.resolution,
      target: targetOf(settings),
      fineResolution: settings.fineResolution,
      neighbours: NEIGHBOURS,
      seed: SEED,
    }),
    // Only what changes the groups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.digits, settings.method, settings.hdbscan, settings.resolution, settings.matchDigits, settings.target, settings.fineResolution],
  )
  const [grouping, setGrouping] = useState(true)
  useEffect(() => {
    if (!analyser) return
    setGrouping(true)
    const id = setTimeout(
      () =>
        analyser.request({ type: 'analyse', ...request }, [], ({ result }) => {
          walk.setMusic(result, distance)
          setGrouping(false)
        }),
      SETTLE_MS,
    )
    return () => clearTimeout(id)
  }, [analyser, request, walk, distance])

  // Count up from 1 group (Leiden only): one more every few seconds, up to a couple more than there are digits.
  const [touring, setTouring] = useState<{ at: number; max: number } | null>(null)
  useEffect(() => {
    if (!touring) return
    patch({ matchDigits: false, resolution: null, target: touring.at })
    const id = setTimeout(() => setTouring((t) => (t && t.at < t.max ? { ...t, at: t.at + 1 } : null)), TOUR_MS)
    return () => clearTimeout(id)
  }, [touring, patch])
  // Anything else changing the groups by hand stops it.
  const editGroups = (changes: Partial<Settings>) => {
    setTouring(null)
    patch(changes)
  }
  const tour = () => {
    if (touring) return setTouring(null)
    walk.setPlaying(true)
    setTouring({ at: 1, max: Math.min(MAX_TARGET, Math.max(3, settings.digits.length + 2)) })
  }
  useEffect(() => {
    if (!playing || settings.method !== 'leiden') setTouring(null)
  }, [playing, settings.method])

  // Holding shows the small groups on the map, the melody's, rather than the broad.
  const [showFine, setShowFine] = useState(false)

  // The drawer is always there, at one of two heights: closed, only the bar on its top edge shows; open, its tabs show
  // too. The map centres in the rest of the window, above it.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<string>('music')
  const [infoOpen, setInfoOpen] = useState(false)
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
  const panelHeight = Math.round(Math.min(windowHeight * 0.5, 560))
  const closedSnap = `${barHeight}px`
  const openSnap = `${barHeight + panelHeight}px`
  // Where the drawer's top edge is right now, mid-move or mid-drag too, as the map centres above it.
  const drawerCovers = useCallback(() => {
    const drawer = barEl.current?.parentElement
    return drawer ? window.innerHeight - drawer.getBoundingClientRect().top : 0
  }, [])

  const here = music && node !== null && node < music.rows.length ? node : null
  const hereGroup = here === null ? null : music!.broad[here]
  const badge = !music
    ? 'Grouping the digits…'
    : showFine
      ? `Showing ${music.fineCount} small groups (the melody’s)`
      : `${music.rows.length} digits: ${music.broadCount} broad group${music.broadCount === 1 ? '' : 's'}, ${music.fineCount} small`

  return (
    <>
      {/* The map fills the window, behind the drawer, and centres in what the drawer leaves (as a map would), so it
          never resizes as the drawer moves. */}
      <div className="fixed inset-0 overflow-hidden bg-viz">
        <MapView xy={xy} music={music} walk={walk} showFine={showFine} coveredBottom={drawerCovers} />
      </div>
      {/* What sits over the map, kept clear of the drawer. */}
      <main
        className="pointer-events-none fixed inset-x-0 top-0"
        style={{ bottom: drawerOpen ? openSnap : closedSnap, transition: `bottom ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
      >
        {/* The digits on the map, along the top, and how they're grouped. */}
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[calc(5.25rem+1.5rem)] left-3 flex flex-col items-start gap-1.5 [&_button]:pointer-events-auto">
          <DigitPicker digits={settings.digits} onDigits={(digits) => editGroups({ digits })} />
          <span className={cn('rounded-md bg-black/50 px-2 py-0.5 text-xs text-white/80', grouping && 'animate-pulse')}>{badge}</span>
        </div>
        {/* The digit the walker is on, in its broad group's colour. */}
        <figure className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 m-0 flex flex-col items-end gap-1">
          <DigitThumb
            pixels={pixels}
            row={here === null ? null : music!.rows[here]}
            className="size-21 rounded-sm border-2 shadow-lg shadow-black/60"
            style={{ borderColor: hereGroup === null ? 'rgb(255 255 255 / 0.9)' : rgbCss(broadColor(hereGroup)) }}
          />
          {here !== null && (
            <figcaption className="num rounded-sm bg-black/55 px-1.5 text-xs text-white">
              {labels[music!.rows[here]]} · {hereGroup! < 0 ? 'noise' : `group ${hereGroup! + 1}`}
            </figcaption>
          )}
        </figure>
        {/* The buttons sit on the drawer's top edge, so they rise and fall with it. */}
        <Button variant="ghost" size="icon" className={cn('pointer-events-auto absolute bottom-0 left-3 rounded-b-none', overMap)} onClick={() => setInfoOpen(true)} aria-label="About">
          <Info />
        </Button>
        {/* Held, the map shows the small groups instead. */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('pointer-events-auto absolute right-3 bottom-0 touch-none rounded-b-none select-none', showFine ? overMapOn : overMap)}
          aria-pressed={showFine}
          aria-label="Hold to see the small groups"
          title="Hold to see the small groups"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setShowFine(true)
          }}
          onPointerUp={() => setShowFine(false)}
          onPointerCancel={() => setShowFine(false)}
          onLostPointerCapture={() => setShowFine(false)}
          onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setShowFine(true)}
          onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && setShowFine(false)}
          onBlur={() => setShowFine(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Layers />
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
            {/* Play or pause the walk, jump it, what it's on, and a button to open or close the drawer. */}
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                className={cn('shrink-0 rounded-full', !playing && 'bg-go text-on-go hover:bg-go-hover')}
                onClick={() => walk.setPlaying(!playing)}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => walk.jumpAnywhere()} aria-label="Jump to a random digit" title="Jump to a random digit">
                <Dices />
              </Button>
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => walk.jumpGroup()} aria-label="Jump to another broad group" title="Jump to another broad group">
                <Shuffle />
              </Button>
              <p className="line-clamp-2 min-w-0 flex-1 px-1 text-xs text-muted-foreground">{nowText(snapshot, labels, settings.method)}</p>
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setDrawerOpen(!drawerOpen)} aria-label={drawerOpen ? 'Hide settings' : 'Show settings'} aria-expanded={drawerOpen}>
                {drawerOpen ? <ChevronDown /> : <ChevronUp />}
              </Button>
            </div>
          </div>
          {/* Out of reach of focus while closed, as it's out of sight. The panel inside stays on the window's bottom,
              moving against the drawer as it moves (with vaul's own easing, so in step), so opening the drawer uncovers
              it from the bottom up: tabs first, then settings. */}
          <div className="overflow-hidden border-t" style={{ height: panelHeight }} inert={!drawerOpen}>
            <div
              className="flex h-full flex-col"
              style={{ transform: `translateY(${drawerOpen ? 0 : -panelHeight}px)`, transition: `transform ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
            >
              <DrawerDescription className="sr-only">Settings, grouped in tabs, for the walk and its music.</DrawerDescription>
              <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
                  <TabsContent value="music">
                    <MusicTab snapshot={snapshot} walk={walk} pixels={pixels} labels={labels} method={settings.method} />
                  </TabsContent>
                  <TabsContent value="groups">
                    <GroupsTab settings={settings} patch={editGroups} music={music} labels={labels} touring={touring} onTour={tour} onJumpGroup={() => walk.jumpGroup()} />
                  </TabsContent>
                  <TabsContent value="melody">
                    <MelodyTab {...editor} music={music} />
                  </TabsContent>
                  <TabsContent value="mix">
                    <MixTab {...editor} />
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
            <SheetTitle>Walk music</SheetTitle>
            <SheetDescription>
              {meta.nSamples.toLocaleString()} MNIST digits, {meta.params.per_digit} of each, on a PaCMAP map. A walker steps at random through their
              nearest neighbours, and plays what it steps on. Broad groups set the harmony, one chord tone each: HDBSCAN on a UMAP of the digits finds
              them by density, so it doesn’t force splits and can leave stragglers as noise; or Leiden splits the neighbours into as many as you ask
              for. Small groups, Leiden at a high resolution, set the melody. Tap the map to move the walker, and hold the layers button to see the
              small groups. After “Density clusters on deskewed digits”, without the deskewing.
            </SheetDescription>
          </SheetHeader>
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
