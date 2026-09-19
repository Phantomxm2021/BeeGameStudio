import type { ReactNode } from 'react'
import * as Beui from '../../registry/components/motion/select'
export type SelectOption = { value: string; label: string; disabled?: boolean }
export function Select({ value, onValueChange, options, ariaLabel, disabled, className = '', leading }: { value: string; onValueChange: (value: string) => void; options: readonly SelectOption[]; ariaLabel: string; disabled?: boolean; className?: string; leading?: ReactNode }) {
  return <Beui.Select value={value} onValueChange={onValueChange} disabled={disabled} className={`scene-select ${className}`}>
    <Beui.SelectTrigger ariaLabel={ariaLabel} className="scene-select-trigger">{leading}<Beui.SelectValue /></Beui.SelectTrigger>
    <Beui.SelectContent className="scene-select-content">{options.map(option => <Beui.SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</Beui.SelectItem>)}</Beui.SelectContent>
  </Beui.Select>
}
