import { Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'

export type SelectOption = { value: string; label: string; disabled?: boolean }

/** Package-local port of the free beUI motion Select for the standalone editor. */
export function Select({ value, onValueChange, options, ariaLabel, disabled, className = '' }: { value: string; onValueChange: (value: string) => void; options: readonly SelectOption[]; ariaLabel: string; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const reduce = useReducedMotion()
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [open])

  return <div ref={rootRef} className={`beui-select ${className}`}>
    <motion.button ref={triggerRef} type="button" className="beui-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} disabled={disabled} onClick={() => setOpen(current => !current)} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const enabled = options.filter(option => !option.disabled)
      const current = Math.max(0, enabled.findIndex(option => option.value === value))
      const next = event.key === 'ArrowDown' ? (current + 1) % enabled.length : (current - 1 + enabled.length) % enabled.length
      if (enabled[next]) onValueChange(enabled[next].value)
    }} whileTap={reduce ? undefined : { scale: .97 }}>
      <span>{selected?.label ?? value}</span><motion.span aria-hidden animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={12} /></motion.span>
    </motion.button>
    <AnimatePresence>
      {open ? <motion.div id={listId} role="listbox" aria-label={ariaLabel} className="beui-select-content" initial={reduce ? { opacity: 0 } : { opacity: 0, y: -5, scaleY: .94 }} animate={{ opacity: 1, y: 0, scaleY: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scaleY: .96 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}>
        {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className="beui-select-item" onClick={() => { onValueChange(option.value); setOpen(false); triggerRef.current?.focus() }}><span>{option.label}</span>{option.value === value ? <Check size={12} /> : null}</button>)}
      </motion.div> : null}
    </AnimatePresence>
  </div>
}
