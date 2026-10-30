/** The page's small controls, on shadcn's: rows of mutually exclusive buttons, labelled sliders and switches, and fields to lay them out. */

import type * as React from 'react'
import { cn } from '@/lib/utils'
import { Slider as SliderBase } from './ui/slider'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

/** One of `options`, each with an icon before it if given. Choosing the one already chosen calls `onChange` with it again (to reset something, say). */
export function Segmented<T extends string>({ options, value, onChange, labels, icons, className, disabled }: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, string>>
  icons?: Partial<Record<T, React.ReactNode>>
  className?: string
  disabled?: boolean
}) {
  return (
    // An empty value is the chosen item clicked again.
    <ToggleGroup type="single" value={value} onValueChange={(v) => onChange((v || value) as T)} className={className} disabled={disabled}>
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o}>
          {icons?.[o]}
          {labels?.[o] ?? o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** A label, and the control it's for beside it (or under it, when `stacked`); greyed out, when `disabled`. */
export function Field({ label, children, stacked, title, disabled }: { label: string; children: React.ReactNode; stacked?: boolean; title?: string; disabled?: boolean }) {
  return (
    <div className={cn('flex gap-x-3 gap-y-1.5 text-sm', stacked ? 'flex-col' : 'items-center')} title={title}>
      <span className={cn('shrink-0 text-muted-foreground', !stacked && 'w-26', disabled && 'opacity-50')}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/** A range slider with its label before it and its value, as `format` shows it, after; greyed out, when `disabled`. */
export function Slider({ label, value, min, max, step = 1, onChange, format = String, title, disabled }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  title?: string
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm" title={title}>
      <span className={cn('text-muted-foreground', disabled && 'opacity-50')}>{label}</span>
      <SliderBase aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} disabled={disabled} />
      <span className={cn('num text-right text-xs', disabled && 'opacity-50')}>{format(value)}</span>
    </div>
  )
}

/** A switch, labelled; disabled, with `note` saying why, say. */
export function Toggle({ label, checked, onChange, disabled, note }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  note?: string
}) {
  return (
    <label className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm', disabled && 'text-muted-foreground')}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      {label}
      {note && <span className="basis-full pl-10 text-xs text-muted-foreground">{note}</span>}
    </label>
  )
}

/** A titled group of controls within a tab. */
export function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}
