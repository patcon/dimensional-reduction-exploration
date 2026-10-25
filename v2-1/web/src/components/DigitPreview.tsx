import { useEffect, useRef } from 'react'
import { DIGIT_COLORS } from '../palette'

/** MNIST digits are 28 x 28. */
const SIDE = 28

/**
 * A digit's pixels, white ink on black, and what it is: selected (clicked) or hovered for a moment. With none, an
 * empty square, saying how to pick one.
 */
export function DigitPreview({ pixels, index, label, hovering }: {
  /** Every digit's pixels, n x 784 row-major, or undefined while they load. */
  pixels: Uint8Array | undefined
  index: number | null
  label: number | null
  hovering: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!pixels) return
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    for (let p = 0; p < SIDE * SIDE; p++) {
      const v = index === null ? 0 : pixels[index * SIDE * SIDE + p]
      img.data.set([v, v, v, 255], p * 4)
    }
    ctx.putImageData(img, 0, 0)
  }, [pixels, index])

  return (
    <div className="digit-preview">
      {pixels ? <canvas ref={ref} width={SIDE} height={SIDE} /> : <div className="digit-preview-loading">Loading…</div>}
      {label === null ? (
        <div className="muted">Click a digit</div>
      ) : (
        <div>
          <span className="muted">{hovering ? 'Hovering' : 'Selected'}</span>{' '}
          <span className="swatch" style={{ background: DIGIT_COLORS[label] }} /> <strong>{label}</strong>
        </div>
      )}
    </div>
  )
}
