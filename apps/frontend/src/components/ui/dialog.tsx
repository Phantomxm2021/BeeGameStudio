import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogPortal({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return <DialogPrimitive.Backdrop className={cn("fixed inset-0 z-[240] bg-black/38 backdrop-blur-[2px] transition-opacity duration-[var(--motion-dialog)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0", className)} {...props} />
}

function DialogContent({ className, children, backdropProps, ...props }: ComponentProps<typeof DialogPrimitive.Popup> & {
  backdropProps?: ComponentProps<typeof DialogPrimitive.Backdrop>;
}) {
  return (
    <DialogPortal>
      <DialogOverlay {...backdropProps} />
      <DialogPrimitive.Popup
        className={cn("fixed left-1/2 top-1/2 z-[241] max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/24%)] outline-none transition-[opacity,transform,scale] duration-[var(--motion-dialog)] data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100", className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("type-body-lg font-display font-semibold", className)} {...props} />
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription }
