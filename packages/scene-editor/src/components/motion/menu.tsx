import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { MorphPopover, MorphPopoverTrigger, MorphPopoverContent } from '../../registry/components/motion/popover-morph'
import { Button } from './button'

const MenuContext = createContext<{ close: () => void; submenu: React.RefObject<HTMLDivElement | null> } | null>(null)

// BeUI owns the popup, positioning and animation. This adapter only routes scene commands.
export function Menu({ ariaLabel, trigger, children, align = 'start', className = '' }: { ariaLabel: string; trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const submenu = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const changeOpen = (next: boolean) => setOpen(next)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }))
    const dismiss = (event: FocusEvent) => {
      const target = event.target as Node
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target) && !submenu.current?.contains(target)) changeOpen(false)
    }
    window.addEventListener('focusin', dismiss)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('focusin', dismiss) }
  }, [open])
  return <MorphPopover open={open} onOpenChange={changeOpen} className={className}>
    <MorphPopoverTrigger><Button ref={triggerRef} className="icon-button" aria-label={ariaLabel}>{trigger}</Button></MorphPopoverTrigger>
    <MorphPopoverContent align={align} radius={12} className="scene-menu-surface">
      <MenuContext.Provider value={{ close: () => { changeOpen(false); triggerRef.current?.focus() }, submenu }}>
        <div ref={listRef} role="menu" aria-label={ariaLabel} onKeyDown={event => {
          if (event.key === 'Tab') { changeOpen(false); triggerRef.current?.focus(); return }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const current = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }}>
          {children}
        </div>
      </MenuContext.Provider>
    </MorphPopoverContent>
  </MorphPopover>
}
export function MenuItem({ children, disabled, destructive, onSelect }: { children: ReactNode; disabled?: boolean; destructive?: boolean; onSelect: () => void }) {
  const context = useContext(MenuContext)
  return <button type="button" role="menuitem" className={`scene-menu-item${destructive ? ' destructive' : ''}`} disabled={disabled} onClick={() => { context?.close(); onSelect() }}>{children}</button>
}
export function MenuSub({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  const context = useContext(MenuContext)

  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const keyboardOpen = useRef(false)
  useLayoutEffect(() => {
    if (!open || !trigger.current || !context?.submenu.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const panel = context.submenu.current.getBoundingClientRect()
    setPosition({ left: anchor.right + panel.width + 8 > window.innerWidth ? anchor.left - panel.width : anchor.right,
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - panel.height - 8)) })
    if (keyboardOpen.current) context.submenu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open, context?.submenu])
  const reveal = (keyboard = false) => { keyboardOpen.current = keyboard; setOpen(true) }
  return <div onPointerEnter={() => reveal()} onPointerLeave={() => setOpen(false)}>
    <button ref={trigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} className="scene-menu-item" onClick={() => reveal()} onKeyDown={event => {
      if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); reveal(true) }
    }}>{icon}{label}<ChevronRight size={13} /></button>
    {open && createPortal(<div ref={context?.submenu} role="menu" aria-label={label} className="scene-menu-surface scene-submenu" style={position}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const current = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
        if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
      }}>{children}</div>, document.querySelector('.scene-editor-host') ?? document.body)}
  </div>
}
export function MenuSeparator() { return <div role="separator" className="scene-menu-separator" /> }
