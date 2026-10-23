import { forwardRef } from 'react'
import { Input as BeuiInput, type InputProps } from '../../registry/components/motion/input'
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = '', ...props }, ref) {
  return <BeuiInput ref={ref} className={`scene-input ${className}`} classNames={{ field: 'scene-input-field', input: 'scene-input-control' }} {...props} />
})
