import { DEFAULT_OPTIMISER, type OptimiserKind, type OptimiserSettings } from '../optimisers'
import { Section, Segmented, Slider } from './controls'

const KINDS: OptimiserKind[] = ['adam', 'adam-kick', 'adam-short', 'momentum']

const LABELS: Record<OptimiserKind, string> = {
  adam: 'PaCMAP Adam',
  'adam-kick': 'Adam + kick',
  'adam-short': 'Adam, short memory',
  momentum: 'Momentum',
}

const HELP: Record<OptimiserKind, string> = {
  adam: "PaCMAP's own. Steps at a near-fixed size, so only the forces' ratios and signs matter; remembers big forces for ~1000 steps.",
  'adam-kick': 'PaCMAP Adam, but it forgets its memory of force strength whenever a control moves.',
  'adam-short': 'PaCMAP Adam remembering only recent force strength (smaller beta2), so it adapts quickly.',
  momentum: 'Points move in proportion to the force on them, so force strength matters. Each step is capped so huge forces cannot fling points away.',
}

/** Speed slider position in [-1, 1] ↔ 0.1x to 10x. */
const speedToPos = (speed: number) => Math.log10(speed)
const posToSpeed = (pos: number) => 10 ** pos

interface Props {
  settings: OptimiserSettings
  onChange: (settings: OptimiserSettings) => void
}

/** Which optimiser turns forces into motion, its knobs, and its speed. */
export function OptimiserPanel({ settings, onChange }: Props) {
  const set = (patch: Partial<OptimiserSettings>) => onChange({ ...settings, ...patch })
  const setMomentum = (patch: Partial<OptimiserSettings['momentum']>) =>
    set({ momentum: { ...settings.momentum, ...patch } })
  const speed = settings.speed[settings.kind]
  const setSpeed = (s: number) => set({ speed: { ...settings.speed, [settings.kind]: s } })

  return (
    <Section title="Optimiser" description={HELP[settings.kind]}>
      <Segmented options={KINDS} value={settings.kind} onChange={(kind) => set({ kind })} labels={LABELS} />
      {/* Speed first, so it stays put when switching optimisers. Double-click puts it back. For Adam, speed × PaCMAP's
          lr of 1 is the learning rate; momentum has its own lr, which speed multiplies. */}
      <div onDoubleClick={() => setSpeed(DEFAULT_OPTIMISER.speed[settings.kind])}>
        <Slider
          label={settings.kind === 'momentum' ? 'speed (× lr)' : 'speed (lr)'}
          value={speedToPos(speed)}
          min={-1}
          max={1}
          step={0.01}
          onChange={(pos) => setSpeed(Number(posToSpeed(pos).toPrecision(2)))}
          format={() => `${speed}×`}
          title="Double-click to put it back"
        />
      </div>
      {settings.kind === 'adam-short' && (
        <Slider label="beta2" value={settings.shortBeta2} min={0.5} max={0.999} step={0.001} onChange={(v) => set({ shortBeta2: v })} />
      )}
      {settings.kind === 'momentum' && (
        <>
          <Slider label="lr" value={settings.momentum.lr} min={0.05} max={10} step={0.05} onChange={(v) => setMomentum({ lr: v })} />
          <Slider label="coast" value={settings.momentum.momentum} min={0} max={0.99} step={0.01} onChange={(v) => setMomentum({ momentum: v })} />
          <Slider label="step cap" value={settings.momentum.maxStep} min={0.05} max={5} step={0.05} onChange={(v) => setMomentum({ maxStep: v })} />
        </>
      )}
    </Section>
  )
}
