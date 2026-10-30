import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const SIDE = 28

/** A digit's pixels, white ink on black, or blank for none. */
export function DigitThumb({ pixels, row, className, style }: {
  pixels: Uint8Array
  /** The digit, as a row of `pixels`, or null for none. */
  row: number | null
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!
    const img = ctx.createImageData(SIDE, SIDE)
    if (row !== null) {
      for (let p = 0; p < SIDE * SIDE; p++) {
        const v = pixels[row * SIDE * SIDE + p]
        img.data.set([v, v, v, 255], p * 4)
      }
    } else for (let p = 0; p < SIDE * SIDE; p++) img.data[p * 4 + 3] = 255
    ctx.putImageData(img, 0, 0)
  }, [pixels, row])
  return <canvas ref={ref} width={SIDE} height={SIDE} className={cn('border bg-black [image-rendering:pixelated]', className)} style={style} />
}
