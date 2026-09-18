// Editor-scoped port of the animated menu pattern used by beUI Table Menu:
// https://beui.dev/components/motion/table
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, type KeyboardEvent, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react'

const MenuContext = createContext<{ close: () => void } | null>(null)

export function Menu({ ariaLabel, trigger, children, align = 'start', className = '' }: { ariaLabel: string; trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const frame = requestAnimationFrame(() => contentRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }))
    window.addEventListener('pointerdown', dismiss)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', dismiss) }
  }, [open])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(contentRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); triggerRef.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  return <div ref={rootRef} className={`beui-menu ${className}`} onKeyDown={onKeyDown}>
    <motion.button ref={triggerRef} type="button" className="beui-menu-trigger" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)} whileTap={reduce ? undefined : { scale: .94 }}>{trigger}</motion.button>
    <AnimatePresence>
      {open ? <motion.div ref={contentRef} id={menuId} role="menu" aria-label={ariaLabel} className="beui-menu-content" data-align={align} initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: .97, y: -3 }} transition={reduce ? { duration: .08 } : { type: 'spring', stiffness: 440, damping: 38, mass: .55 }}>
        <MenuContext.Provider value={{ close: () => { setOpen(false); triggerRef.current?.focus() } }}>{children}</MenuContext.Provider>
      </motion.div> : null}
    </AnimatePresence>
  </div>
}

export function MenuItem({ children, disabled, destructive, onSelect }: { children: ReactNode; disabled?: boolean; destructive?: boolean; onSelect: () => void }) {
  const context = useContext(MenuContext)
  return <button type="button" role="menuitem" className={`beui-menu-item${destructive ? ' destructive' : ''}`} disabled={disabled} onClick={() => { if (disabled) return; onSelect(); context?.close() }}>{children}</button>
}

export function MenuSeparator() { return <div role="separator" className="beui-menu-separator" /> }
