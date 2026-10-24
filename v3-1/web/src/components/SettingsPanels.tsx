import { Fragment } from 'react'
import { DIGIT_COLORS } from '../palette'
import type { SettingsEditor } from '../presets'
import { N_DIGITS, type Grouping } from '../selection'
import { READING_LABELS, type ReadingKey } from '../signal'
import { ELEMENTS } from '../vizSettings'
import { Segmented, Slider } from './controls'

const fixed = (places: number) => (v: number) => v.toFixed(places)

/** Which digits take part, and how many of them. */
export function SampleRow({ settings, set, available, shownCount, maxCount }: SettingsEditor & {
  /** Digits of the chosen labels in the pool. */
  available: number
  shownCount: number
  maxCount: number
}) {
  const digits = new Set(settings.digits)
  const toggleDigit = (d: number) => {
    if (digits.has(d) && digits.size > 1) digits.delete(d)
    else digits.add(d)
    set('digits', [...digits].sort((a, b) => a - b))
  }
  return (
    <div className="toolbar">
      <span className="control-label">Digits</span>
      <span className="segmented digits">
        {Array.from({ length: N_DIGITS }, (_, d) => (
          <button
            key={d}
            className={digits.has(d) ? 'on' : ''}
            style={{ '--digit': DIGIT_COLORS[d] } as React.CSSProperties}
            onClick={() => toggleDigit(d)}
            aria-pressed={digits.has(d)}
          >
            {d}
          </button>
        ))}
      </span>
      <button onClick={() => set('digits', Array.from({ length: N_DIGITS }, (_, d) => d))}>all</button>
      <Slider label="sample" value={shownCount} min={2} max={maxCount} onChange={(v) => set('count', v)} format={(v) => `${v} of ${available}`} />
      <button onClick={() => set('seed', settings.seed + 1)} title="Pick another sample of these digits">
        ⟳ Reshuffle
      </button>
    </div>
  )
}

/** How digits are grouped (by label or Leiden cluster), and the order their chords sit in. */
export function GroupingRow({ settings, set, grouping }: SettingsEditor & { grouping: Grouping }) {
  const { groupBy, resolution, neighbours, clusterOver, clusterRate, order } = settings
  return (
    <div className="toolbar">
      <span className="control-label">Color by</span>
      <Segmented options={['digit', 'leiden'] as const} value={groupBy} onChange={(v) => set('groupBy', v)} labels={{ digit: 'Label', leiden: 'Leiden' }} />
      {groupBy === 'leiden' && (
        <>
          <Slider label="resolution" value={resolution} min={0.1} max={3} step={0.1} onChange={(v) => set('resolution', v)} format={fixed(1)} />
          <Slider label="neighbours" value={neighbours} min={3} max={30} onChange={(v) => set('neighbours', v)} />
          <span className="control-label">Cluster over</span>
          <Segmented options={['full', 'window'] as const} value={clusterOver} onChange={(v) => set('clusterOver', v)} />
          {clusterOver === 'window' && (
            <Slider
              label="re-cluster"
              title="How often to re-cluster over the window while playing"
              value={clusterRate}
              min={0.25}
              max={10}
              step={0.25}
              onChange={(v) => set('clusterRate', v)}
              format={(v) => `${v} /s`}
            />
          )}
          <span className="muted num">
            {grouping.groups.length} clusters · modularity {grouping.modularity?.toFixed(2)}
          </span>
        </>
      )}
      <span className="control-label">Chord order</span>
      <Segmented options={['random', 'grouped'] as const} value={order} onChange={(v) => set('order', v)} />
    </div>
  )
}

/** How each digit's pixels are read out as valence. */
export function ReadingRow({ settings, patch }: SettingsEditor) {
  const { signal } = settings
  return (
    <div className="toolbar">
      <span className="control-label">Reading</span>
      <Segmented options={Object.keys(READING_LABELS) as ReadingKey[]} value={signal.reading} onChange={(v) => patch('signal', { reading: v })} labels={READING_LABELS} />
      <label className="check">
        <input type="checkbox" checked={signal.skipBlank} onChange={(e) => patch('signal', { skipBlank: e.target.checked })} /> skip blank pixels
      </label>
      <Segmented options={['blur', 'lag'] as const} value={signal.smoothing} onChange={(v) => patch('signal', { smoothing: v })} />
      <Slider
        label="smoothing"
        value={signal.smoothingPixels}
        min={0}
        max={8}
        step={0.25}
        onChange={(v) => patch('signal', { smoothingPixels: v })}
        format={(v) => `${v} px`}
      />
      <Segmented
        options={['ink', 'ink-only'] as const}
        value={signal.mapping}
        onChange={(v) => patch('signal', { mapping: v })}
        labels={{ ink: 'paper −1, ink +1', 'ink-only': 'paper 0, ink +1' }}
      />
    </div>
  )
}

/** The particle geometry's forces, and a button to scatter the particles afresh. */
export function ParticlePanel({ settings, patch, onScatter }: SettingsEditor & { onScatter: () => void }) {
  const { particles } = settings
  return (
    <div className="particle-settings">
      <h2>Particles</h2>
      <p className="muted">Groups pull together; the centre pulls ink in and pushes paper out, by each digit's valence now.</p>
      <Slider label="within groups" value={particles.cohesion} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { cohesion: v })} format={fixed(2)} />
      <Slider label="between groups" value={particles.separation} min={-1} max={1} step={0.05} onChange={(v) => patch('particles', { separation: v })} format={fixed(2)} />
      <Slider label="centre" value={particles.centreForce} min={0} max={6} step={0.1} onChange={(v) => patch('particles', { centreForce: v })} format={fixed(1)} />
      <Slider label="spread" value={particles.spread} min={0.2} max={1.5} step={0.05} onChange={(v) => patch('particles', { spread: v })} format={fixed(2)} />
      <Slider label="reach" value={particles.radius} min={10} max={150} onChange={(v) => patch('particles', { radius: v })} format={fixed(0)} />
      <Slider label="damping" value={particles.damping} min={0.5} max={0.99} step={0.01} onChange={(v) => patch('particles', { damping: v })} format={fixed(2)} />
      <label className="check">
        <input type="checkbox" checked={particles.reverseCentre} onChange={(e) => patch('particles', { reverseCentre: e.target.checked })} /> ink repels from
        centre
      </label>
      <button onClick={onScatter}>scatter</button>
    </div>
  )
}

/** What each element is coloured by, its opacity, and the sizes of cursors, chords and traces. */
export function StylePanel({ settings, patch }: SettingsEditor) {
  const { style } = settings
  return (
    <>
      <h2>Colour by</h2>
      <div className="style-grid">
        <span />
        {ELEMENTS.map((el) => (
          <span key={el} className="style-head">
            {el}
          </span>
        ))}
        {(['valence', 'group'] as const).map((by) => (
          <Fragment key={by}>
            <span className="style-head">{by}</span>
            {ELEMENTS.map((el) => (
              <button
                key={`${by}-${el}`}
                className={style.colorBy[el] === by ? 'on' : ''}
                onClick={() => patch('style', { colorBy: { ...style.colorBy, [el]: by } })}
              >
                {by}
              </button>
            ))}
          </Fragment>
        ))}
        <span className="style-head">opacity</span>
        {ELEMENTS.map((el) => (
          <input
            key={`op-${el}`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={style.opacity[el]}
            aria-label={`${el} opacity`}
            onChange={(e) => patch('style', { opacity: { ...style.opacity, [el]: Number(e.target.value) } })}
          />
        ))}
      </div>
      <Slider label="cursor size" value={style.cursorSize} min={2} max={30} onChange={(v) => patch('style', { cursorSize: v })} />
      <Slider label="chord width" value={style.chordWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { chordWidth: v })} format={(v) => `${v} px`} />
      <Slider label="trace width" value={style.traceWidth} min={0.5} max={10} step={0.5} onChange={(v) => patch('style', { traceWidth: v })} />
    </>
  )
}
