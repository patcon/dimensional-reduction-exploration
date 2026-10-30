import type * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

// From shadcn/ui, for a bottom drawer only, and without the overlay (the page's drawer is non-modal).
function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn('fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-xl border-t bg-background', className)}
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

function DrawerHandle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Handle>) {
  return <DrawerPrimitive.Handle data-slot="drawer-handle" className={cn('!h-1.5 !w-12 shrink-0 rounded-full !bg-muted', className)} {...props} />
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('font-semibold text-foreground', className)} {...props} />
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description data-slot="drawer-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Drawer, DrawerContent, DrawerDescription, DrawerHandle, DrawerTitle }
