import type { CSSProperties } from 'react'
import { DIGIT_COLORS } from '../palette'
import { Button } from './ui/button'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

/**
 * Which digit labels are shown, one toggle each, underlined in its colour (so it's the legend too), and a button
 * to show them all, "*", or once all are shown, "∅" to hide them all, for picking afresh.
 */
export function DigitPicker({ shown, onShown }: { shown: boolean[]; onShown: (shown: boolean[]) => void }) {
  const allShown = shown.every(Boolean)
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToggleGroup
        type="multiple"
        value={shown.flatMap((on, d) => (on ? [String(d)] : []))}
        onValueChange={(values) => onShown(shown.map((_, d) => values.includes(String(d))))}
        aria-label="Digits shown"
        className="bg-background/85 shadow-none"
      >
        {shown.map((on, d) => (
          <ToggleGroupItem
            key={d}
            value={String(d)}
            title={`${on ? 'Hide' : 'Show'} the ${d}s`}
            className="num h-7 min-w-[1.375rem] px-1 shadow-[inset_0_-3px_0_color-mix(in_srgb,var(--digit)_35%,transparent)] data-[state=off]:text-muted-foreground data-[state=on]:shadow-[inset_0_-3px_0_var(--digit)]"
            style={{ '--digit': DIGIT_COLORS[d] } as CSSProperties}
          >
            {d}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="outline"
        size="sm"
        className="h-7 min-w-6 bg-background/85 px-1.5 shadow-none"
        onClick={() => onShown(shown.map(() => !allShown))}
        aria-label={allShown ? 'No digits' : 'All digits'}
        title={allShown ? 'No digits' : 'All digits'}
      >
        {allShown ? '∅' : '*'}
      </Button>
    </div>
  )
}
