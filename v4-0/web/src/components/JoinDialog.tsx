import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { useMemo } from 'react'
import { encode } from 'uqr'
import { ROOM } from '../room'

/** The remote's address for this room: this site's front page, with ?room= unless it's the one everyone shares. */
function joinUrl() {
  const url = new URL('/', location.href)
  if (ROOM !== 'main') url.searchParams.set('room', ROOM)
  return url.href
}

/** A QR code as one SVG path, a unit square per dark module, with a quiet zone round it. */
function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 })
    let path = ''
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)))
    return { size: qr.size, path }
  }, [text])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={className} role="img" aria-label={`QR code for ${text}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** A QR code to join the room from a phone, big enough to scan from across one, with the address beneath it. */
export function JoinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const url = joinUrl()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-1/2 flex-col items-center gap-3 rounded-xl border bg-background p-5 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <DialogPrimitive.Title className="font-semibold">Join with your phone</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-center text-sm text-muted-foreground">
            Scan to draw a digit of your own by tilting your phone.
          </DialogPrimitive.Description>
          <QrCode text={url} className="aspect-square w-full max-w-[min(24rem,60vh)] rounded-md" />
          <a href={url} target="_blank" rel="noreferrer" className="num text-center text-sm break-all text-muted-foreground underline-offset-2 hover:underline">
            {url}
          </a>
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:outline-hidden">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
