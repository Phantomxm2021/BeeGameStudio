// Adapted from shadcn/ui (MIT), new-york-v4/dropdown-menu.
// Only the radio-menu components used by the editor are included.
import type { ComponentProps } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />
}
export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}
export function DropdownMenuContent({ className = '', sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const container = typeof document === 'undefined' ? undefined : document.querySelector<HTMLElement>('.scene-editor-host') ?? undefined
  return <DropdownMenuPrimitive.Portal container={container}><DropdownMenuPrimitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={`scene-editor-portal ui-dropdown-content ${className}`} onContextMenu={event => event.preventDefault()} {...props} /></DropdownMenuPrimitive.Portal>
}
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export function DropdownMenuSubTrigger({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return <DropdownMenuPrimitive.SubTrigger className={`scene-editor-portal ui-dropdown-item ${className}`} {...props} />
}
export function DropdownMenuSubContent({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return <DropdownMenuPrimitive.SubContent className={`scene-editor-portal ui-dropdown-content ${className}`} {...props} />
}
export function DropdownMenuItem({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={`ui-dropdown-item ${className}`} {...props} />
}
export function DropdownMenuSeparator({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={`ui-dropdown-separator ${className}`} {...props} />
}
export function DropdownMenuRadioGroup(props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup {...props} />
}
export function DropdownMenuRadioItem({ className = '', children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return <DropdownMenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={`ui-dropdown-radio ${className}`} {...props}>
    <span className="ui-dropdown-indicator"><DropdownMenuPrimitive.ItemIndicator><Check size={14} /></DropdownMenuPrimitive.ItemIndicator></span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
}
