import type { ComponentProps, ReactNode } from 'react'
import * as Beui from '../../registry/components/motion/tabs'
export const Tabs = Beui.Tabs
export const TabsTrigger = Beui.TabsTrigger
export const TabsContent = Beui.TabsContent
export function TabsList({ label, children, ...props }: ComponentProps<typeof Beui.TabsList> & { label: string; children: ReactNode }) {
  return <div aria-label={label} data-scene-control onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next]?.focus(); tabs[next]?.click()
  }}><Beui.TabsList {...props} className="scene-settings-tabs-list">{children}</Beui.TabsList></div>
}
