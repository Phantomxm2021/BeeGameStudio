// Radix context menu styled with the standalone editor's shadcn menu styles.
import type { ComponentProps } from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
export function ContextMenuContent({ className = '', ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content className={`ui-dropdown-content asset-context-menu ${className}`} onContextMenu={event => event.preventDefault()} {...props} /></ContextMenuPrimitive.Portal>
}
export function ContextMenuItem(props: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item className="ui-dropdown-item" {...props} />
}
