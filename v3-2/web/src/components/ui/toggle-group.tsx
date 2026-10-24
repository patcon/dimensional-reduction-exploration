import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// From shadcn/ui's toggle-group, its outline variant folded in (so without a separate toggle component), wrapping
// onto more lines when its items don't fit, and the chosen item inverted (as the page's segmented buttons were).
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex w-fit max-w-full flex-wrap items-center overflow-hidden rounded-md border shadow-xs', className)}
      {...props}
    />
  )
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-8 min-w-8 flex-auto items-center justify-center gap-1 border-input bg-transparent px-2.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] outline-none not-last:border-r hover:bg-muted hover:text-muted-foreground focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
