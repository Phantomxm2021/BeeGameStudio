// Adapted from the free beUI Motion Button component: https://beui.dev/components/motion/button
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'

export function Button({ className = '', ...props }: HTMLMotionProps<'button'>) {
  const reduce = useReducedMotion()
  return <motion.button className={`beui-button ${className}`} whileTap={reduce || props.disabled ? undefined : { scale: .96 }} transition={{ type: 'spring', stiffness: 500, damping: 30, mass: .6 }} {...props} />
}
