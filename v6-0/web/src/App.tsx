import { AudioLines, ChevronDown, ChevronUp, Eye, Info, Paintbrush, Pause, Play, QrCode, Shapes, Smartphone, Users, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { NSLOT } from './analysis'
import { BAR, SLOT, SUB } from './crowd'
import { GraphViz } from './components/GraphViz'
import { JoinDialog } from './components/JoinDialog'
import { CrowdTab, GroupsTab, PaintTab, PhonesTab, SoundTab, ViewTab } from './components/Panels'
import { Segmented } from './components/controls'
import { ViewIcon } from './components/ViewIcons'
import { Button } from './components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle } from './components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { CrowdEngine } from './engine'
import { useLiveRoom } from './live'
import { OTHER_COLOR, participantRGB, rgbCss, slotColor, type RGB } from './palette'
import { useSettings, VIEW_LABELS, type ViewMode } from './settings'

/** vaul's own easing and duration, so what sits over the graph keeps clear of the drawer as it moves. */
const DRAWER_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DRAWER_SECONDS = 0.5
const SPEEDS = ['0.5', '1', '2', '4'] as const

const TABS = [
  { value: 'paint', label: 'Paint', icon: Paintbrush },
  { value: 'crowd', label: 'Crowd', icon: Users },
  { value: 'groups', label: 'Groups', icon: Shapes },
  { value: 'phones', label: 'Phones', icon: Smartphone },
  { value: 'view', label: 'View', icon: Eye },
  { value: 'sound', label: 'Sound', icon: AudioLines },
] as const

function useWindowHeight() {
  const [height, setHeight] = useState(window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

const overGraph = 'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white'
const VIEWS: ViewMode[] = ['2d', '2d-ts', '3d']

/** Where the song is: bar and step. */
function position(t: number) {
  const s = Math.floor(t / SLOT)
  return `bar ${Math.floor(t / BAR) + 1} · ${SUB[((s % 4) + 4) % 4]}`
}

export default function App() {
  const { settings, setSettings, patch } = useSettings()
  const editor = { settings, patch }
  // One engine for the page's life, from the settings it opened with; changes go in below.
  const [engine] = useState(() => new CrowdEngine(settings.crowd, settings.analysis, settings.layout))
  useEffect(() => engine.start(), [engine])
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  // Settings into the engine.
  useEffect(() => engine.setCrowd(settings.crowd), [engine, settings.crowd])
  useEffect(() => engine.setAnalysis(settings.analysis), [engine, settings.analysis])
  useEffect(() => engine.setLayout(settings.layout), [engine, settings.layout])
  useEffect(() => engine.setMinGroupShare(settings.minGroupShare), [engine, settings.minGroupShare])
  useEffect(() => engine.setSpeed(settings.speed), [engine, settings.speed])
  useEffect(() => engine.setTempo(settings.tempo, settings.followBeat), [engine, settings.tempo, settings.followBeat])
  const { soundOn, soundMode, volume, metronome } = settings
  useEffect(() => engine.setSound({ on: soundOn, mode: soundMode, volume, metronome }), [engine, soundOn, soundMode, volume, metronome])

  // The room: live phones join the crowd.
  const { room, roster, connected, calibrate } = useLiveRoom(settings, setSettings)
  useEffect(() => engine.setLive(roster.map((p) => p.slot), room.valence), [engine, roster, room])
  useEffect(() => {
    room.onReading = engine.reading
    return () => void (room.onReading = null)
  }, [engine, room])
  const { liveColors, touching } = useMemo(() => {
    const liveColors = new Map<number, RGB>(), touching = new Set<number>()
    const bySlot = new Map(roster.map((p) => [p.slot, p]))
    snapshot.phones.forEach((p, i) => {
      const who = p.live ? bySlot.get(p.index) : undefined
      if (!who) return
      liveColors.set(i, participantRGB(who.slot))
      if (who.touching) touching.add(i)
    })
    return { liveColors, touching }
  }, [roster, snapshot.phones])

  // The followed phone, by key, so it stays followed as others come and go.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const focus = focusKey === null ? null : snapshot.phones.findIndex((p) => p.key === focusKey)
  const focused = focus === null || focus < 0 ? null : focus

  // Phones selected for painting, by key too.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set())
  const selected = useMemo(() => new Set(snapshot.phones.flatMap((p, i) => (selectedKeys.has(p.key) ? [i] : []))), [snapshot.phones, selectedKeys])
  const onSelect = useCallback(
    (phones: number[], on: boolean) =>
      setSelectedKeys((keys) => {
        const next = new Set(keys)
        for (const i of phones) {
          const key = engine.phones[i]?.key
          if (key === undefined) continue
          if (on) next.add(key)
          else next.delete(key)
        }
        return next
      }),
    [engine],
  )
  const clearSelection = useCallback(() => setSelectedKeys(new Set()), [])

  const [cameraReset, setCameraReset] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<string>('paint')
  const [infoOpen, setInfoOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [barHeight, setBarHeight] = useState(64)
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
  const drawerCovers = useCallback(() => {
    const drawer = barEl.current?.parentElement
    return drawer ? window.innerHeight - drawer.getBoundingClientRect().top : 0
  }, [])

  // With the paint tab open, tapping a phone selects it (or deselects it); otherwise it's followed.
  const painting = drawerOpen && tab === 'paint'
  const onTap = (i: number | null) => {
    if (!painting) return setFocusKey(i === null ? null : (engine.phones[i]?.key ?? null))
    if (i !== null) onSelect([i], !selected.has(i))
  }

  const a = snapshot.analysis
  const nLive = snapshot.phones.filter((p) => p.live).length
  const groups = a ? countGroups(a.slots) : []
  const focusedPhone = focused === null ? null : snapshot.phones[focused]
  const restart = (shuffle: boolean) => {
    if (shuffle !== settings.crowd.shuffleSeats) patch({ crowd: { ...settings.crowd, shuffleSeats: shuffle } })
    engine.restart()
  }

  return (
    <>
      <div className="fixed inset-0 overflow-hidden bg-viz">
        <GraphViz
          engine={engine}
          view={settings.view}
          gradient={settings.gradient}
          focus={focused}
          liveColors={liveColors}
          touching={touching}
          cameraReset={cameraReset}
          selected={selected}
          onFocus={onTap}
          coveredBottom={drawerCovers}
        />
      </div>
      <main className="pointer-events-none fixed inset-x-0 top-0" style={{ bottom: drawerOpen ? openSnap : closedSnap, transition: `bottom ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}>
        {/* What's found, along the top. */}
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-16 left-3 flex flex-col items-start gap-1.5">
          <span className="rounded-md bg-black/55 px-2 py-0.5 text-xs text-white/85">
            {snapshot.phones.length - nLive} simulated{nLive ? ` + ${nLive} live` : ''} phones ·{' '}
            {a ? `${a.k} group${a.k === 1 ? '' : 's'}${Number.isNaN(a.ari) ? '' : ` · ARI ${a.ari.toFixed(2)}`}` : 'grouping…'}
          </span>
          <div className="flex flex-wrap gap-1">
            {groups.map(([slot, size]) => (
              <span key={slot} className="num flex items-center gap-1 rounded-sm bg-black/55 px-1.5 text-xs text-white">
                <span className="swatch" style={{ background: rgbCss(slot < NSLOT ? slotColor(slot) : OTHER_COLOR) }} />
                {slot < NSLOT ? `G${slot + 1}` : 'other'} {size}
              </span>
            ))}
          </div>
          {focusedPhone && (
            <span className="rounded-md bg-black/55 px-2 py-0.5 text-xs text-white/85">
              Following {focusedPhone.live ? `live phone ${focusedPhone.index + 1}` : `phone ${focusedPhone.index + 1}`}
            </span>
          )}
        </div>
        <div className="pointer-events-auto absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 flex flex-col gap-1.5">
          <Button variant="ghost" size="icon" className={overGraph} onClick={() => setJoinOpen(true)} aria-label="Join with a phone" title="Join with a phone">
            <QrCode />
          </Button>
          {VIEWS.map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="icon"
              className={cn(overGraph, settings.view.mode === v && 'bg-white/90 text-black hover:bg-white hover:text-black')}
              onClick={() => (v === settings.view.mode ? setCameraReset((r) => r + 1) : patch({ view: { ...settings.view, mode: v } }))}
              aria-label={VIEW_LABELS[v]}
              title={`${VIEW_LABELS[v]}${v === settings.view.mode ? ' (again: put the camera back)' : ''}`}
            >
              <ViewIcon view={v} className="size-5" />
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className={cn('pointer-events-auto absolute bottom-0 left-3 rounded-b-none', overGraph)} onClick={() => setInfoOpen(true)} aria-label="About">
          <Info />
        </Button>
      </main>

      <Drawer open modal={false} dismissible={false} handleOnly snapPoints={[closedSnap, openSnap]} activeSnapPoint={drawerOpen ? openSnap : closedSnap} setActiveSnapPoint={(snap) => setDrawerOpen(snap === openSnap)}>
        <DrawerContent className="h-full" aria-describedby={undefined}>
          <DrawerTitle className="sr-only">Playback and settings</DrawerTitle>
          <div ref={barRef} className="shrink-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <DrawerHandle className="mb-2" />
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                className={cn('shrink-0 rounded-full', !snapshot.playing && 'bg-go text-on-go hover:bg-go-hover')}
                onClick={() => engine.setPlaying(!snapshot.playing)}
                aria-label={snapshot.playing ? 'Pause' : 'Play'}
              >
                {snapshot.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => patch({ soundOn: !settings.soundOn })}
                aria-label={settings.soundOn ? 'Sound off' : 'Sound on'}
                aria-pressed={settings.soundOn}
                title={settings.soundOn ? 'Sound off' : 'Sound on'}
              >
                {settings.soundOn ? <Volume2 /> : <VolumeX />}
              </Button>
              <span className="num min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
                {position(snapshot.t)} · {Math.round(snapshot.tempo.stepsPerMinute)}/min
                {snapshot.tempo.following && snapshot.tempo.beat && snapshot.tempo.heardAgo !== null && snapshot.tempo.heardAgo < 3 ? ' · following phones' : ''}
              </span>
              <Segmented options={SPEEDS} value={String(settings.speed) as (typeof SPEEDS)[number]} onChange={(v) => patch({ speed: Number(v) })} labels={{ '0.5': '½×', '1': '1×', '2': '2×', '4': '4×' }} />
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setDrawerOpen(!drawerOpen)} aria-label={drawerOpen ? 'Hide settings' : 'Show settings'} aria-expanded={drawerOpen}>
                {drawerOpen ? <ChevronDown /> : <ChevronUp />}
              </Button>
            </div>
          </div>
          <div className="overflow-hidden border-t" style={{ height: panelHeight }} inert={!drawerOpen}>
            <div className="flex h-full flex-col" style={{ transform: `translateY(${drawerOpen ? 0 : -panelHeight}px)`, transition: `transform ${DRAWER_SECONDS}s ${DRAWER_EASE}` }}>
              <DrawerDescription className="sr-only">Settings, grouped in tabs, for the crowd, its grouping, the phones in the room, the view and the sound.</DrawerDescription>
              <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
                  <TabsContent value="paint">
                    <PaintTab {...editor} engine={engine} snapshot={snapshot} focus={focused} selected={selected} onSelect={onSelect} onClear={clearSelection} />
                  </TabsContent>
                  <TabsContent value="crowd">
                    <CrowdTab {...editor} engine={engine} snapshot={snapshot} focus={focused} onRestart={restart} />
                  </TabsContent>
                  <TabsContent value="groups">
                    <GroupsTab {...editor} engine={engine} snapshot={snapshot} />
                  </TabsContent>
                  <TabsContent value="phones">
                    <PhonesTab {...editor} roster={roster} connected={connected} onCalibrate={calibrate} onJoin={() => setJoinOpen(true)} />
                  </TabsContent>
                  <TabsContent value="view">
                    <ViewTab {...editor} />
                  </TabsContent>
                  <TabsContent value="sound">
                    <SoundTab {...editor} snapshot={snapshot} />
                  </TabsContent>
                </div>
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

      <JoinDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Phone-flip crowd</SheetTitle>
            <SheetDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  A crowd flipping their phones to the beat, face up (+1) and face down (−1): simulated phones in three sections (Slow, Fast and
                  1-e-&amp;), and anyone in the room who joins with their own (the QR button). Every half second, Leiden groups the phones by how alike
                  their last 4 bars were, and each group big enough adds a tone to the chord.
                </p>
                <p>
                  The graph pulls alike phones together. Each phone’s dot shows which way it faces now, its ring its group, and its trail where it’s been,
                  receding into the screen as time goes back: front on in the 2d time slice, side on in the time series (time running left to right),
                  or in perspective in 3d. Drag to turn or pan, pinch or scroll to zoom, and tap a phone to follow it.
                </p>
                <p>After “Phone-flip crowd · harmony from clusters”, with the drawer and views of the earlier versions.</p>
              </div>
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </>
  )
}

/** Each slot's size, "other" (past the colour slots) together. */
function countGroups(slots: Int32Array) {
  const by = new Map<number, number>()
  for (const s of slots) by.set(Math.min(s, NSLOT), (by.get(Math.min(s, NSLOT)) ?? 0) + 1)
  return [...by].sort((a, b) => a[0] - b[0])
}
