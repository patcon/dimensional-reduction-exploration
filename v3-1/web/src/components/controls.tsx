/** The page's small controls: a row of mutually exclusive buttons, and a labelled range slider. */

export function Segmented<T extends string>({ options, value, onChange, labels }: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, string>>
}) {
  return (
    <span className="segmented">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </span>
  )
}

/** A range slider with its label before it and its value, as `format` shows it, after. */
export function Slider({ label, value, min, max, step = 1, onChange, format = String, title }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  title?: string
}) {
  return (
    <label className="slider" title={title}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num">{format(value)}</span>
    </label>
  )
}
