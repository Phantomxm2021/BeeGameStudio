// Ported from the free beUI Motion Switch component: https://beui.dev/components/motion/switch
import { motion, useReducedMotion } from 'motion/react'

export function Switch({ checked, onCheckedChange, disabled = false, 'aria-label': ariaLabel }: { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; 'aria-label': string }) {
  const reduce = useReducedMotion()
  return <motion.button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    data-state={checked ? 'checked' : 'unchecked'}
    className="beui-switch"
    onClick={() => onCheckedChange(!checked)}
    whileTap={reduce || disabled ? undefined : { scale: .94 }}
  >
    <motion.span className="beui-switch-thumb" animate={{ x: checked ? 16 : 0 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 800, damping: 80, mass: 4 }} />
  </motion.button>
}
