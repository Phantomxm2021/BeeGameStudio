import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuGroup = ContextMenuPrimitive.Group
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuSub = ContextMenuPrimitive.Sub
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

function ContextMenuSubTrigger({ className, inset, children, ...props }: ContextMenuPrimitive.ContextMenuSubTriggerProps & { inset?: boolean }) {
  return <ContextMenuPrimitive.SubTrigger data-inset={inset} className={cn('flex cursor-default items-center rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[inset]:pl-8', className)} {...props}>{children}<ChevronRightIcon className="ml-auto size-4" /></ContextMenuPrimitive.SubTrigger>
}

function ContextMenuSubContent({ className, ...props }: ContextMenuPrimitive.ContextMenuSubContentProps) {
  return <ContextMenuPrimitive.SubContent className={cn('z-50 min-w-32 overflow-hidden rounded-md border border-white/10 bg-popover p-1 text-popover-foreground shadow-lg', className)} {...props} />
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.ContextMenuContentProps) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content className={cn('z-50 min-w-36 overflow-hidden rounded-md border border-white/10 bg-popover p-1 text-popover-foreground shadow-lg', className)} {...props} /></ContextMenuPrimitive.Portal>
}

function ContextMenuItem({ className, inset, variant = 'default', ...props }: ContextMenuPrimitive.ContextMenuItemProps & { inset?: boolean; variant?: 'default' | 'destructive' }) {
  return <ContextMenuPrimitive.Item data-inset={inset} data-variant={variant} className={cn('flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[inset]:pl-8 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive', className)} {...props} />
}

function ContextMenuCheckboxItem({ className, children, checked, ...props }: ContextMenuPrimitive.ContextMenuCheckboxItemProps) {
  return <ContextMenuPrimitive.CheckboxItem className={cn('relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} checked={checked} {...props}><span className="absolute left-2 flex size-3.5 items-center justify-center"><ContextMenuPrimitive.ItemIndicator><CheckIcon className="size-4" /></ContextMenuPrimitive.ItemIndicator></span>{children}</ContextMenuPrimitive.CheckboxItem>
}

function ContextMenuRadioItem({ className, children, ...props }: ContextMenuPrimitive.ContextMenuRadioItemProps) {
  return <ContextMenuPrimitive.RadioItem className={cn('relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props}><span className="absolute left-2 flex size-3.5 items-center justify-center"><ContextMenuPrimitive.ItemIndicator><CheckIcon className="size-4" /></ContextMenuPrimitive.ItemIndicator></span>{children}</ContextMenuPrimitive.RadioItem>
}

function ContextMenuLabel({ className, inset, ...props }: ContextMenuPrimitive.ContextMenuLabelProps & { inset?: boolean }) {
  return <ContextMenuPrimitive.Label data-inset={inset} className={cn('px-2 py-1.5 text-xs font-semibold data-[inset]:pl-8', className)} {...props} />
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.ContextMenuSeparatorProps) {
  return <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-white/10', className)} {...props} />
}

export { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuPortal, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger }
