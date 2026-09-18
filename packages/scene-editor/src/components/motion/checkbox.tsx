import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useId } from 'react'

const CHECK_PATH = 'M5 13l4 4L19 7'
const INDETERMINATE_PATH = 'M6 12h12'
const EASE_OUT = [0.16, 1, 0.3, 1] as const
const SPRING_PRESS = { type: 'spring' as const, stiffness: 500, damping: 30 }

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  indeterminate?: boolean
  label?: string
  className?: string
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

/** beUI Motion Checkbox registry component, scoped for the Scene Editor theme. */
export function Checkbox({ checked, onCheckedChange, disabled, indeterminate, label, className, id: idProp, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy }: CheckboxProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const reduce = useReducedMotion()
  const showMark = checked || indeterminate
  const path = indeterminate ? INDETERMINATE_PATH : CHECK_PATH
  return <label htmlFor={id} className={`beui-checkbox ${disabled ? 'is-disabled' : ''} ${className ?? ''}`}>
    <motion.button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      whileTap={reduce || disabled ? undefined : { scale: .92 }}
      transition={SPRING_PRESS}
      data-state={checked ? 'checked' : indeterminate ? 'indeterminate' : 'unchecked'}
      className="beui-checkbox-control"
    >
      <AnimatePresence initial={false}>
        {showMark ? <motion.svg
          key={indeterminate ? 'indeterminate' : 'checked'}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
          initial={reduce ? { opacity: 1 } : { opacity: 0, scale: .5 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: .5, filter: 'blur(4px)' }}
          transition={reduce ? { duration: 0 } : { duration: .16, ease: EASE_OUT }}
          aria-hidden
        >
          <title>{indeterminate ? 'Partially selected' : 'Selected'}</title>
          <motion.path d={path} initial={reduce ? { pathLength: 1 } : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={reduce ? { duration: 0 } : { duration: indeterminate ? .2 : .3, ease: EASE_OUT, delay: .04 }} />
        </motion.svg> : null}
      </AnimatePresence>
    </motion.button>
    {label ? <span className="beui-checkbox-label">{label}</span> : null}
  </label>
}
