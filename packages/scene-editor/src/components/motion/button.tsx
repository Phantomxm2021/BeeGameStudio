import { forwardRef } from 'react'
import { Button as BeuiButton, type ButtonProps } from '../../registry/components/motion/button/base'
import { Tooltip } from '../../registry/components/motion/tooltip'

// Only editor sizing and tooltip composition; interaction/motion comes from BeUI.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ title, className = '', variant = 'ghost', size = 'sm', ...props }, ref) {
  const button = <BeuiButton ref={ref} variant={variant} size={size} pressScale={.98} whileHover={undefined} className={`scene-button ${className}`} {...props} />
  return title ? <Tooltip content={title} className="scene-tooltip">{button}</Tooltip> : button
})
