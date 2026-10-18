import { DEFAULT_OPTIMISER, type OptimiserKind, type OptimiserSettings } from '../optimisers'

const KINDS: { kind: OptimiserKind; label: string; help: string }[] = [
  {
    kind: 'adam',
    label: 'PaCMAP Adam',
    help: "PaCMAP's own optimiser. Moves at a roughly fixed speed whatever the force strength; only the forces' ratios and signs matter, and it remembers big forces for ~1000 steps.",
  },
  {
    kind: 'adam-kick',
    label: 'Adam + kick',
    help: 'PaCMAP Adam, but it forgets its memory of force strength whenever a control moves.',
  },
  {
    kind: 'adam-short',
    label: 'Adam, short memory',
    help: 'PaCMAP Adam remembering only recent force strength (smaller beta2), so it adapts quickly.',
  },
  {
    kind: 'momentum',
    label: 'Momentum descent',
    help: 'Points move in proportion to the force on them, so force strength matters. Each step is capped so huge forces cannot fling points away.',
  },
]

/** Speed slider position in [-1, 1] ↔ 0.1x to 10x. */
const speedToPos = (speed: number) => Math.log10(speed)
const posToSpeed = (pos: number) => 10 ** pos

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function RangeField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <label className="opt-field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="opt-value">{value}</span>
    </label>
  )
}

interface Props {
  settings: OptimiserSettings
  onChange: (settings: OptimiserSettings) => void
}

/** Which optimiser turns forces into motion, its knobs, and its speed. */
export function OptimiserPanel({ settings, onChange }: Props) {
  const set = (patch: Partial<OptimiserSettings>) => onChange({ ...settings, ...patch })
  const setMomentum = (patch: Partial<OptimiserSettings['momentum']>) =>
    set({ momentum: { ...settings.momentum, ...patch } })
  const current = KINDS.find((k) => k.kind === settings.kind)!
  const speed = settings.speed[settings.kind]
  const setSpeed = (s: number) => set({ speed: { ...settings.speed, [settings.kind]: s } })

  return (
    <section className="optimiser" aria-label="Optimiser">
      <div className="opt-row">
        <label className="opt-field">
          <span>Optimiser</span>
          <select value={settings.kind} onChange={(e) => set({ kind: e.target.value as OptimiserKind })}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <p className="opt-help">{current.help}</p>
      </div>
      <div className="opt-row opt-knobs">
        {settings.kind === 'adam-short' && (
          <RangeField label="beta2" value={settings.shortBeta2} min={0.5} max={0.999} step={0.001} onChange={(v) => set({ shortBeta2: v })} />
        )}
        {settings.kind === 'momentum' && (
          <>
            <RangeField label="lr" value={settings.momentum.lr} min={0.05} max={10} step={0.05} onChange={(v) => setMomentum({ lr: v })} />
            <RangeField label="coast" value={settings.momentum.momentum} min={0} max={0.99} step={0.01} onChange={(v) => setMomentum({ momentum: v })} />
            <RangeField label="step cap" value={settings.momentum.maxStep} min={0.05} max={5} step={0.05} onChange={(v) => setMomentum({ maxStep: v })} />
          </>
        )}
        <label className="opt-field">
          <span>Speed</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={speedToPos(speed)}
            onChange={(e) => setSpeed(Number(posToSpeed(Number(e.target.value)).toPrecision(2)))}
            onDoubleClick={() => setSpeed(DEFAULT_OPTIMISER.speed[settings.kind])}
          />
          <span className="opt-value">{speed}×</span>
        </label>
      </div>
    </section>
  )
}
