import * as SliderPrimitive from '@radix-ui/react-slider'
import type * as React from 'react'
import { cn } from '@/lib/utils'
import { useSteadyRelease } from '../../useSteadyRelease'

// From shadcn/ui, for a single thumb. Added: lifting a finger off doesn't nudge it (see useSteadyRelease).
function Slider({ className, onValueChange, onPointerDown, onPointerMove, onPointerUp, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const steady = useSteadyRelease<number[]>()
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50', className)}
      onValueChange={(v) => {
        steady.noteValue(v)
        onValueChange?.(v)
      }}
      onPointerDown={(e) => {
        steady.onPointerDown(e, props.value ?? props.defaultValue ?? [])
        onPointerDown?.(e)
      }}
      onPointerMove={(e) => {
        steady.onPointerMove(e)
        onPointerMove?.(e)
      }}
      onPointerUp={(e) => {
        const settled = steady.release(e)
        if (settled) onValueChange?.(settled)
        onPointerUp?.(e)
      }}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="block size-4 shrink-0 rounded-full border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
