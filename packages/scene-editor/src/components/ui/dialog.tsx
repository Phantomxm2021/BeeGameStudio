// Adapted from shadcn/ui (MIT). Styled locally for the standalone editor.
import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className = '', children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-dialog-overlay" onContextMenu={event => event.preventDefault()} />
    <DialogPrimitive.Content className={`ui-dialog-content ${className}`} data-slot="dialog-content" onContextMenu={event => event.preventDefault()} {...props}>
      {children}
      <DialogPrimitive.Close className="icon-button dialog-close" aria-label="Close dialog" title="Close dialog"><X size={18} /></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
