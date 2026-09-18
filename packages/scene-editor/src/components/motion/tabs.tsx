// Ported from the free beUI Motion Tabs component: https://beui.dev/components/motion/tabs
import { motion, useReducedMotion } from 'motion/react'
import { createContext, useContext, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'

type TabsContextValue = { value: string; setValue: (value: string) => void; layoutId: string }
const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs() {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tabs components must be used inside Tabs')
  return context
}

export function Tabs({ defaultValue, children, className = '' }: { defaultValue: string; children: ReactNode; className?: string }) {
  const [value, setValue] = useState(defaultValue)
  const layoutId = useId()
  const context = useMemo(() => ({ value, setValue, layoutId }), [value, layoutId])
  return <TabsContext.Provider value={context}><div className={`beui-tabs ${className}`}>{children}</div></TabsContext.Provider>
}

export function TabsList({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0 || !tabs.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  return <div role="tablist" aria-label={label} className={`beui-tabs-list ${className}`} onKeyDown={onKeyDown}>{children}</div>
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const context = useTabs()
  const active = context.value === value
  return <button type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className="beui-tabs-trigger" onClick={() => context.setValue(value)}>
    {active ? <motion.span className="beui-tabs-indicator" layoutId={context.layoutId} transition={{ type: 'spring', stiffness: 245, damping: 36, mass: 1.2 }} /> : null}
    <span>{children}</span>
  </button>
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const context = useTabs()
  const reduce = useReducedMotion()
  if (context.value !== value) return null
  return <motion.div role="tabpanel" className="beui-tabs-content" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .18, ease: [0.16, 1, 0.3, 1] }}>{children}</motion.div>
}
