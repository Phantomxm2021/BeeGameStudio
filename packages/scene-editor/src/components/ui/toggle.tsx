// Adapted from shadcn/ui (MIT), new-york-v4/toggle.
// Utility classes are expressed in this package's styles.css for standalone use.
import type { ComponentProps } from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'

export function Toggle({ className = '', ...props }: ComponentProps<typeof TogglePrimitive.Root>) {
  return <TogglePrimitive.Root data-slot="toggle" className={`ui-toggle ${className}`} {...props} />
}
