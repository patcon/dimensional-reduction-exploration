import { Bookmark, Eye, Focus, Gauge, Hash, Megaphone, ScanSearch, Shapes } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ChordViz } from './components/ChordViz'
import { Section } from './components/controls'
import { DigitImage, DigitPreview } from './components/DigitPreview'
import { GroupLegend } from './components/GroupLegend'
import { Matrix } from './components/Matrix'
import { PresetsPanel } from './components/Presets'
import { DigitPicker, GroupingSection, ParticleSection, ReadingSection, SampleSection, StyleSection, ViewSection } from './components/SettingsPanels'
import { PlaybackSection, TransportBar } from './components/Transport'
import { GeometryIcon } from './components/GeometryIcons'
import { ViewIcon } from './components/ViewIcons'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { useLiveRoom } from './live'
import { groupColors, hexRgb, type RGB } from './palette'
import { usePlayhead } from './playhead'
import { useSettings } from './presets'
import { chordSlots, groupParticipants, pcsOf, pickRows, windowFeatures, type Grouping } from './selection'
import { neighbourAffinity } from './knn'
import { participantColor } from './protocol'
import { buildTraces, N_PIXELS, rereadTraces } from './signal'
import { liveRow, projectDrawings, useData, type PoolData } from './useData'
import { usePresets } from './usePresets'
import { useLineClicks } from './useLineClicks'
import { useWakeLock } from './useWakeLock'
import { GEO_MODES, MAX_CHORDS, VIEW_LABELS, type ViewMode } from './vizSettings'

/** Moments a participant's drawing fills in one frame at most; a jump further (a seek) only marks where it lands. */
const MAX_STROKE = 30
/** vaul's own easing and duration, so what sits over the visualiser keeps clear of the drawer as it moves. */
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DRAWER_SECONDS = 0.5
/** The views the view button steps through, in order. */
const VIEW_CYCLE: ViewMode[] = ['2d', '2d-ts', '3d']
/** How long the view and geometry buttons name what they moved to, as phones can't hover for a tooltip. */
const MODE_LABEL_MS = 1200
/** Releasing the speaker: the square in front fades out, then the speaker grows back into its place, before it rejoins the digits. */
const SPEAKER_RELEASE_MS = 800

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
  const { meta, pixels, pcs, labels } = data

  // Every setting, as presets save and load them; the playhead follows its speed.
  const { settings, setSettings, set, patch, reset } = useSettings()
  const editor = { settings, set, patch }
  const { count, seed, groupBy, resolution, neighbours, clusterOver, clusterRate, windowPixels, order, signal, view, geometry, style, trailSeconds, particles, focus, speaker } = settings
  const digits = useMemo(() => new Set(settings.digits), [settings.digits])
  const setFocus = (i: number | null) => set('focus', i)
  const presets = usePresets(settings, setSettings)
  // The room: participants' phones, and the settings every visualiser in it shares.
  const { room, roster } = useLiveRoom(settings, setSettings)

  const [particleReset, setParticleReset] = useState(0)
  const [cameraReset, setCameraReset] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const playhead = usePlayhead()
  useEffect(() => playhead.setSpeed(settings.speed), [playhead, settings.speed])
  useWakeLock(settings.wakeLock)

  const available = useMemo(() => labels.filter((l) => digits.has(l)).length, [labels, digits])
  const maxCount = Math.min(MAX_CHORDS, available)
  const shownCount = Math.min(count, maxCount)
  const picked = useMemo(() => pickRows(labels, digits, shownCount, seed), [labels, digits, shownCount, seed])
  // The speaker isn't one of the digits taking part: it's what they react to, at the centre.
  const rows = useMemo(() => (speaker === null ? picked : picked.filter((r) => r !== speaker)), [picked, speaker])
  // Participants take part beside the digits, after them: each is the row their drawing is kept in, by slot.
  const liveSlots = roster.map((p) => p.slot).join(',')
  const liveRows = useMemo(() => (liveSlots ? liveSlots.split(',').map((slot) => liveRow(meta, Number(slot))) : []), [liveSlots, meta])
  const allRows = useMemo(() => [...rows, ...liveRows], [rows, liveRows])
  /** Participant i of the visualiser's, for a participant's slot. */
  const participantOf = (slot: number) => rows.length + liveRows.indexOf(liveRow(meta, slot))
  // Clustering over the full digit, participants' drawings are projected onto the principal components again, as
  // often as the window would be clustered, as they change as they're drawn.
  const [drawingTick, setDrawingTick] = useState(0)
  const fullOverDrawings = groupBy === 'leiden' && clusterOver === 'full' && liveRows.length > 0
  useEffect(() => {
    if (!fullOverDrawings) return
    const id = setInterval(() => {
      projectDrawings(data, liveRows)
      setDrawingTick((t) => t + 1)
    }, 1000 / clusterRate)
    return () => clearInterval(id)
  }, [fullOverDrawings, data, liveRows, clusterRate])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- drawingTick: participants' components, changed in place
  const points = useMemo(() => pcsOf(pcs, meta.nPcs, allRows), [pcs, meta.nPcs, allRows, drawingTick])
  const rowLabels = useMemo(() => allRows.map((r) => labels[r]), [allRows, labels])
  // Re-clustered as participants draw, it starts from the last clustering, keeping its clusters' numbers and colours.
  const lastFull = useRef<Grouping | undefined>(undefined)
  const fullGrouping = useMemo(() => {
    // Only Leiden's own clusterings carry on: grouped by label, there are no cluster numbers to keep.
    const previous = groupBy === 'leiden' && lastFull.current?.groupOf.length === rowLabels.length ? lastFull.current : undefined
    const grouping = groupParticipants(rowLabels, points, meta.nPcs, groupBy, { resolution, neighbours, seed }, previous)
    lastFull.current = groupBy === 'leiden' ? grouping : undefined
    return grouping
  }, [rowLabels, points, meta.nPcs, groupBy, resolution, neighbours, seed])
  // Neighbour forces: how much each digit counts each other as a neighbour, over what Leiden clusters over (the
  // full digit here; the window below, while clustering over it). Only worked out while particles feel it.
  const affinityOneWay = geometry === 'particle' && particles.forces === 'neighbours' ? particles.oneWay : null
  const fullAffinity = useMemo(
    () => (affinityOneWay === null ? null : neighbourAffinity(points, rowLabels.length, meta.nPcs, neighbours, affinityOneWay)),
    [affinityOneWay, points, rowLabels.length, meta.nPcs, neighbours],
  )
  const traces = useMemo(() => buildTraces(pixels, allRows, signal, speaker, rows.length), [pixels, allRows, signal, speaker, rows.length])

  // Participants draw as the playhead reads: every frame, each one's tilt now is the ink of the pixel being read, and
  // of every pixel passed since the last frame, playing forward. Their traces are read again from their drawings.
  useEffect(() => {
    if (!liveRows.length) return
    let last = playhead.moment
    let id = requestAnimationFrame(function draw() {
      id = requestAnimationFrame(draw)
      const now = playhead.moment
      const lo = Math.floor(now)
      const hi = Math.min(traces.length - 1, Math.ceil(now))
      const from = playhead.playing && now >= last && now - last < MAX_STROKE ? Math.ceil(last) : lo
      for (const row of liveRows) {
        const ink = Math.round((room.valence[row - meta.nSamples] + 1) * 127.5)
        for (let t = from; t <= hi; t++) pixels[row * N_PIXELS + traces.pixelAt[t]] = ink
      }
      rereadTraces(traces, pixels, allRows, signal, rows.length)
      last = now
    })
    return () => cancelAnimationFrame(id)
  }, [liveRows, allRows, rows.length, traces, pixels, signal, room, playhead, meta.nSamples])
  useEffect(() => playhead.setLength(traces.length), [playhead, traces.length])
  useLineClicks(playhead, traces, settings.lineClicks)
  useEffect(() => playhead.resetLaps(), [playhead, traces])

  // Clustering over the window: re-run `clusterRate` times a second while the playhead moves, each run
  // starting from the last one's clusters (or the full clustering's, at first) and keeping their ids. Pinned, the
  // window holds still, so it's clustered once.
  const windowed = groupBy === 'leiden' && clusterOver === 'window'
  const pin = playhead.pin
  /** Pinned, and not on the way out (see Playhead.pin). */
  const pinned = pin !== null && !pin.releasing
  type WindowGrouping = { rows: number[]; grouping: Grouping; affinity: Float32Array | null }
  // Participants keep drawing over a window that holds still (pinned, or paused), so it's clustered again all the same.
  const drawing = liveRows.length > 0
  const [windowGrouping, setWindowGrouping] = useState<WindowGrouping | null>(null)
  const lastWindow = useRef<WindowGrouping | null>(null)
  useEffect(() => {
    if (!windowed) return
    const cluster = (moment: number, span: number, wrap: boolean) => {
      const previous = lastWindow.current?.rows === allRows ? lastWindow.current.grouping : fullGrouping
      const { features, dim } = windowFeatures(traces, moment, span, wrap)
      const grouping = groupParticipants(rowLabels, features, dim, 'leiden', { resolution, neighbours, seed }, previous)
      const affinity = affinityOneWay === null ? null : neighbourAffinity(features, rowLabels.length, dim, neighbours, affinityOneWay)
      lastWindow.current = { rows: allRows, grouping, affinity }
      setWindowGrouping(lastWindow.current)
    }
    if (pin) {
      const runPinned = () => cluster(pin.to, pin.to - pin.from, false)
      runPinned()
      if (!drawing) return
      const id = setInterval(runPinned, 1000 / clusterRate)
      return () => clearInterval(id)
    }
    let lastMoment = NaN
    const run = () => {
      if (playhead.moment === lastMoment && !drawing) return
      lastMoment = playhead.moment
      cluster(playhead.moment, windowPixels, playhead.wraps)
    }
    run()
    const id = setInterval(run, 1000 / clusterRate)
    return () => clearInterval(id)
  }, [windowed, pin, clusterRate, allRows, drawing, rowLabels, traces, playhead, windowPixels, resolution, neighbours, seed, fullGrouping, affinityOneWay])
  const windowCurrent = windowed && windowGrouping?.rows === allRows ? windowGrouping : null
  const grouping = windowCurrent?.grouping ?? fullGrouping
  // Until the window's first clustering with them, neighbour forces go by the full digit's.
  const affinity = affinityOneWay === null ? null : (windowCurrent?.affinity ?? fullAffinity)

  const colors = useMemo(() => groupColors(grouping), [grouping])
  const slotOf = useMemo(() => chordSlots(grouping, points, meta.nPcs, order), [grouping, points, meta.nPcs, order])

  // None, once a tap lands on no digit; the first, if the one followed has gone from the sample.
  const followed = focus === null ? null : focus < allRows.length ? focus : allRows.length ? 0 : null
  // Participants touching their phones are ringed in their colour, and the last of them to touch shows in the corner.
  const highlights = useMemo(
    () => roster.filter((p) => p.touching).map((p) => ({ participant: participantOf(p.slot), color: hexRgb(participantColor(p.slot)) })),
    // participantOf only changes with rows and liveRows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, rows, liveRows],
  )
  const touched = room.lastTouched === null ? null : participantOf(room.lastTouched)
  const shown = touched ?? hover ?? followed
  /** A participant's colour, for i of the visualiser's, or null for a digit. */
  const liveColor = (i: number | null): RGB | null => (i === null || i < rows.length ? null : hexRgb(participantColor(allRows[i] - meta.nSamples)))
  const shownColor = liveColor(shown)
  // Only a digit can be the speaker: a participant's drawing changes as they draw.
  const followsDigit = followed !== null && followed < rows.length
  // Making the followed digit the speaker leaves no digit followed, so the square in front starts blank; releasing it
  // follows it again, back among the digits taking part, once it has grown back into its place.
  const [releasing, setReleasing] = useState(false)
  // With a speaker, the square in front shows how the digit there agrees with it, or, tapping the speaker, the digit itself.
  const [showOriginal, setShowOriginal] = useState(false)
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(releaseTimer.current), [])
  const toggleSpeaker = () => {
    if (releasing) return
    if (speaker === null) {
      if (followed === null || !followsDigit) return
      setSettings((s) => ({ ...s, speaker: rows[followed], focus: null }))
      setShowOriginal(false)
      return
    }
    setReleasing(true)
    releaseTimer.current = setTimeout(() => {
      setReleasing(false)
      setSettings((s) => (s.speaker === null ? s : { ...s, speaker: null, focus: picked.includes(s.speaker) ? picked.indexOf(s.speaker) : s.focus }))
    }, SPEAKER_RELEASE_MS)
  }
  const speaking = speaker !== null && !releasing

  // The drawer is always there, at one of two heights: closed, only the playback bar on its top edge shows; open,
  // its tabs show too. The visualiser centres in the rest of the window, above it.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<string>('playback')
  const [presetsOpen, setPresetsOpen] = useState(false)
  // The view or geometry last moved to, named for a moment over the buttons.
  const [modeLabel, setModeLabel] = useState<{ text: string; shown: boolean }>({ text: '', shown: false })
  const modeLabelTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(modeLabelTimer.current), [])
  const showModeLabel = (text: string) => {
    setModeLabel({ text, shown: true })
    clearTimeout(modeLabelTimer.current)
    modeLabelTimer.current = setTimeout(() => setModeLabel((l) => ({ ...l, shown: false })), MODE_LABEL_MS)
  }
  const followingView = VIEW_CYCLE[(VIEW_CYCLE.indexOf(view) + 1) % VIEW_CYCLE.length]
  const nextView = () => {
    set('view', followingView)
    showModeLabel(VIEW_LABELS[followingView])
  }
  const followingGeometry = GEO_MODES[(GEO_MODES.indexOf(geometry) + 1) % GEO_MODES.length]
  const nextGeometry = () => {
    set('geometry', followingGeometry)
    showModeLabel(followingGeometry)
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
  const panelHeight = Math.round(Math.min(windowHeight * 0.5, 560))
  const closedSnap = `${barHeight}px`
  const openSnap = `${barHeight + panelHeight}px`
  // Where the drawer's top edge is right now, mid-move or mid-drag too, as the visualiser centres above it.
  const drawerCovers = useCallback(() => {
    const drawer = barEl.current?.parentElement
    return drawer ? window.innerHeight - drawer.getBoundingClientRect().top : 0
  }, [])

  return (
    <>
      {/* The visualiser fills the window, behind the drawer, and centres in what the drawer leaves (as a map
          would), so it never resizes as the drawer moves. */}
      <div className="fixed inset-0 overflow-hidden bg-viz">
        <ChordViz
          traces={traces}
          pickKey={picked}
          rows={allRows}
          playhead={playhead}
          slotOf={slotOf}
          groupOf={grouping.groupOf}
          affinity={affinity}
          colors={colors}
          focus={followed}
          view={view}
          geometry={geometry}
          style={style}
          trailSeconds={trailSeconds}
          particles={particles}
          highlights={highlights}
          speaker={speaker}
          particleReset={particleReset}
          cameraReset={cameraReset}
          onFocus={setFocus}
          onHover={setHover}
          coveredBottom={drawerCovers}
        />
      </div>
      {/* What sits over the visualiser, kept clear of the drawer. */}
      <main
        className="pointer-events-none fixed inset-x-0 top-0"
        style={{ bottom: drawerOpen ? openSnap : closedSnap, transition: `bottom ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
      >
        {/* The followed (or hovered) digit as it plays, as in the inspect tab, always in sight; with none, the
            window still shows where in the reading the playhead is. With a speaker, it shrinks back behind, to the top
            left, and the digit reacting to it comes in front, as its agreement with the speaker (tap the speaker for the digit
            itself). Without one, the speaker's square waits, full size, behind the
            one in front, so it's already in place as the square in front vanishes. */}
        <div className="pointer-events-auto absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 flex flex-col items-end gap-1.5">
          <div className="relative size-21">
            <DigitImage
              pixels={pixels}
              poolRow={speaker}
              traces={traces}
              playhead={playhead}
              windowPixels={windowPixels}
              onPress={speaking ? () => setShowOriginal((o) => !o) : undefined}
              pressLabel={showOriginal ? 'Show how the digit in front agrees with the speaker' : 'Show the digit in front as it is'}
              className={cn(
                'absolute inset-0 size-21 origin-top-left rounded-sm border-white/90! motion-reduce:transition-none',
                speaker === null && 'pointer-events-none',
                speaking && '-translate-x-8 -translate-y-1.5 scale-60 opacity-70 transition-[translate,scale,opacity] duration-500',
                // Growing back once the square in front has faded out.
                releasing && 'transition-[translate,scale,opacity] delay-300 duration-500',
              )}
            />
            {/* Fresh for each speaker, so it vanishes at once, uncovering the speaker, and fades in once the speaker is
                behind; releasing, it fades out first. */}
            <DigitImage
              key={speaker ?? 'none'}
              pixels={pixels}
              poolRow={shown !== null ? allRows[shown] : null}
              against={showOriginal ? null : speaker}
              traces={traces}
              playhead={playhead}
              windowPixels={windowPixels}
              style={shownColor ? { borderColor: `rgb(${shownColor.join(' ')})`, borderWidth: 3 } : undefined}
              className={cn(
                'absolute inset-0 size-21 rounded-sm shadow-lg shadow-black/60',
                !shownColor && 'border-white/90!',
                speaking && 'transition-opacity delay-500 duration-300 starting:opacity-0 motion-reduce:transition-none',
                releasing && 'opacity-0 transition-opacity duration-300 motion-reduce:transition-none',
              )}
            />
          </div>
          <div className="flex gap-1.5">
            {/* Makes the followed digit the speaker, the one every other digit reacts to; again, releases it. */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white',
                speaking && 'bg-white/90 text-black hover:bg-white hover:text-black',
              )}
              onClick={toggleSpeaker}
              disabled={releasing || (speaker === null && !followsDigit)}
              aria-pressed={speaking}
              aria-label={speaker !== null ? 'Release the speaker' : 'Make this digit the speaker'}
              title={speaker !== null ? 'Release the speaker' : 'Make this digit the speaker'}
            >
              <Megaphone />
            </Button>
            {/* Pins playback to the window, looping round inside it, so its groups hold still as it plays; unpinned,
                playback carries on to the window's end and breaks through it. */}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white',
                pinned && 'bg-white/90 text-black hover:bg-white hover:text-black',
              )}
              onClick={() => playhead.setPin(pinned ? null : windowPixels)}
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin from this window' : 'Pin to the window'}
              title={pinned ? 'Unpin from this window' : 'Pin to the window'}
            >
              <Focus />
            </Button>
          </div>
        </div>
        {/* The digits taking part, along the top as in the digits tab, clear of the corner digit (and the speaker behind it). */}
        <div
          className={cn(
            'pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 [&_button]:pointer-events-auto',
            speaker === null ? 'right-[calc(5.25rem+1.5rem)]' : 'right-[calc(5.25rem+3.5rem)]',
          )}
        >
          <DigitPicker digits={settings.digits} onDigits={(v) => set('digits', v)} compact />
        </div>
        {/* The buttons sit on the drawer's top edge, so they rise and fall with it. */}
        <span
          className="pointer-events-none absolute right-3 bottom-11 rounded-md bg-black/65 px-2 py-0.5 text-xs text-white transition-opacity duration-300 motion-reduce:transition-none"
          style={{ opacity: modeLabel.shown ? 1 : 0 }}
          aria-hidden
        >
          {modeLabel.text}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto absolute right-[3.75rem] bottom-0 rounded-b-none bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          onClick={nextGeometry}
          aria-label={`Geometry: ${geometry}. Switch to ${followingGeometry}.`}
        >
          <GeometryIcon geometry={geometry} className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto absolute right-3 bottom-0 rounded-b-none bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          onClick={nextView}
          aria-label={`View: ${VIEW_LABELS[view]}. Switch to ${VIEW_LABELS[followingView]}.`}
        >
          <ViewIcon view={view} className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto absolute bottom-0 left-3 rounded-b-none bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
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
          {/* Out of reach of focus while closed, as it's out of sight. The panel inside stays on the window's bottom,
              moving against the drawer as it moves (with vaul's own easing, so in step), so opening the drawer uncovers
              it from the bottom up: tabs first, then settings. */}
          <div className="overflow-hidden border-t" style={{ height: panelHeight }} inert={!drawerOpen}>
            <div
              className="flex h-full flex-col"
              style={{ transform: `translateY(${drawerOpen ? 0 : -panelHeight}px)`, transition: `transform ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}
            >
              <DrawerDescription className="sr-only">Settings, grouped in tabs, for what the visualiser shows.</DrawerDescription>
              <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
                  <TabsContent value="playback">
                    <PlaybackSection
                      playhead={playhead}
                      traces={traces}
                      speed={settings.speed}
                      onSpeed={(v) => set('speed', v)}
                      trailSeconds={trailSeconds}
                      onTrailSeconds={(v) => set('trailSeconds', v)}
                      wakeLock={settings.wakeLock}
                      onWakeLock={(v) => set('wakeLock', v)}
                      lineClicks={settings.lineClicks}
                      onLineClicks={(v) => set('lineClicks', v)}
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
                        windowPixels={windowPixels}
                        pixels={pixels}
                        rows={allRows}
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
                          poolRow={allRows[shown]}
                          participant={shown}
                          label={labels[allRows[shown]]}
                          liveColor={shownColor}
                          groupName={grouping.groups[grouping.groupOf[shown]].name}
                          groupColor={colors[grouping.groupOf[shown]]}
                          traces={traces}
                          playhead={playhead}
                          windowPixels={windowPixels}
                          following={hover === null}
                          heard={speaker !== null}
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
                        windowPixels={windowPixels}
                      />
                    </Section>
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

      <Sheet open={presetsOpen} onOpenChange={setPresetsOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Presets</SheetTitle>
            <SheetDescription>
              Valence particles from MNIST, with live participants: each digit's pixels, read in order, are one participant's valence over time
              (paper −1, ink +1), and people with their phones open at this site's front page draw their own as the playhead reads, by tilting
              them (face up ink, face down paper). Make a digit the speaker and the others react to it instead: matching it agrees, differing
              disagrees. Settings are shared with every visualiser open in the room, so a phone can change the big screen's. Save the settings
              you've arrived at, or carry them between browsers as files.
            </SheetDescription>
          </SheetHeader>
          <PresetsPanel store={presets} onReset={reset} />
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
