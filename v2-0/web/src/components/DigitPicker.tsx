import type { CSSProperties } from 'react'
import { DIGIT_COLORS } from '../palette'

/**
 * Which digit labels are shown, one toggle each, underlined in its colour (so it's the legend too), and a button
 * to show them all, "*", or once all are shown, "∅" to hide them all, for picking afresh.
 */
export function DigitPicker({ shown, onShown }: { shown: boolean[]; onShown: (shown: boolean[]) => void }) {
  const allShown = shown.every(Boolean)
  return (
    <div className="digit-picker">
      <div className="digit-toggles" role="group" aria-label="Digits shown">
        {shown.map((on, d) => (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            title={`${on ? 'Hide' : 'Show'} the ${d}s`}
            style={{ '--digit': DIGIT_COLORS[d] } as CSSProperties}
            onClick={() => onShown(shown.map((s, k) => (k === d ? !s : s)))}
          >
            {d}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="digit-all"
        onClick={() => onShown(shown.map(() => !allShown))}
        aria-label={allShown ? 'No digits' : 'All digits'}
        title={allShown ? 'No digits' : 'All digits'}
      >
        {allShown ? '∅' : '*'}
      </button>
    </div>
  )
}
