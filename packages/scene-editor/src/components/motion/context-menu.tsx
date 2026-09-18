// Editor-scoped adaptation of beUI Animated Context Menu:
// https://beui.dev/components/motion/context-menu
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'

export function ContextMenuContent({ open, point, ariaLabel, onOpenChange, children }: { open: boolean; point: { x: number; y: number }; ariaLabel: string; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onOpenChange(false) }
    const close = () => onOpenChange(false)
    window.addEventListener('pointerdown', dismiss); window.addEventListener('resize', close); window.addEventListener('scroll', close, true)
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true }))
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [open, onOpenChange])
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onOpenChange(false); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const left = typeof window === 'undefined' ? point.x : Math.min(point.x, Math.max(8, window.innerWidth - 232))
  const top = typeof window === 'undefined' ? point.y : Math.min(point.y, Math.max(8, window.innerHeight - 250))
  return <AnimatePresence>{open ? <motion.div ref={ref} role="menu" aria-label={ariaLabel} className="beui-context-menu" style={{ left, top }} initial={reduce ? { opacity: 0 } : { opacity: 0, scale: .86, clipPath: 'inset(0 88% 88% 0 round 12px)' }} animate={{ opacity: 1, scale: 1, clipPath: 'inset(0 0 0 0 round 12px)' }} exit={reduce ? { opacity: 0 } : { opacity: 0, scale: .96 }} transition={reduce ? { duration: .08 } : { type: 'spring', stiffness: 420, damping: 40, mass: .5 }} onKeyDown={keyboard} onContextMenu={event => event.preventDefault()}>{children}</motion.div> : null}</AnimatePresence>
}

export function ContextMenuItem({ children, disabled, destructive, onSelect }: { children: ReactNode; disabled?: boolean; destructive?: boolean; onSelect: () => void }) {
  return <button type="button" role="menuitem" aria-disabled={disabled || undefined} disabled={disabled} className={`beui-context-item${destructive ? ' destructive' : ''}`} onClick={() => { if (!disabled) onSelect() }}>{children}</button>
}
export function ContextMenuSeparator() { return <div role="separator" className="beui-context-separator" /> }
export function ContextMenuShortcut({ children }: { children: ReactNode }) { return <kbd className="beui-context-shortcut">{children}</kbd> }
