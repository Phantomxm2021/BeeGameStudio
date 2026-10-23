import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { motion, useReducedMotion } from 'motion/react';
import { createContext, useContext, useId, useMemo, useState, type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

// Ported from the free beUI tabs registry source (https://beui.dev/r/tabs.json).
// Base UI remains the interaction primitive so roving focus and keyboard behavior
// stay compatible with the existing workspace.
const BEUI_TABS_TRANSITION = { type: 'spring' as const, stiffness: 170, damping: 30, mass: 1.2 };
const BEUI_EASE_OUT = [0.16, 1, 0.3, 1] as const;

type TabsContextValue = { activeValue: string | undefined; layoutId: string; reducedMotion: boolean };
const TabsMotionContext = createContext<TabsContextValue>({ activeValue: undefined, layoutId: 'beui-tabs-underline', reducedMotion: false });

function Tabs({ className, value, defaultValue, onValueChange, children, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  const [internalValue, setInternalValue] = useState(value ?? defaultValue);
  const layoutId = useId();
  const activeValue = value ?? internalValue;
  const reducedMotion = useReducedMotion() ?? false;
  const context = useMemo(() => ({ activeValue, layoutId, reducedMotion }), [activeValue, layoutId, reducedMotion]);

  return (
    <TabsPrimitive.Root
      className={cn('flex min-h-0 flex-col', className)}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(nextValue, event) => {
        setInternalValue(nextValue);
        onValueChange?.(nextValue, event);
      }}
      {...props}
    >
      <TabsMotionContext.Provider value={context}>{children}</TabsMotionContext.Provider>
    </TabsPrimitive.Root>
  );
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('relative flex h-9 shrink-0 items-stretch gap-1 border-b border-border-subtle', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, value, children, ...props }: ComponentProps<typeof TabsPrimitive.Tab>) {
  const { activeValue, layoutId, reducedMotion } = useContext(TabsMotionContext);
  const isActive = activeValue === value;
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        'relative inline-flex min-w-0 items-center justify-center rounded-t-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[active]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {isActive ? (
        <motion.span
          aria-hidden="true"
          data-layout-id={layoutId}
          data-testid="beui-tabs-indicator"
          className="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-current"
          layoutId={layoutId}
          transition={reducedMotion ? { duration: 0 } : BEUI_TABS_TRANSITION}
        />
      ) : null}
    </TabsPrimitive.Tab>
  );
}

function TabsContent({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.Panel>) {
  const { reducedMotion } = useContext(TabsMotionContext);
  return (
    <TabsPrimitive.Panel
      className={cn('min-h-0 flex-1 outline-none', className)}
      render={<motion.div initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: BEUI_EASE_OUT }} />}
      {...props}
    >
      {children}
    </TabsPrimitive.Panel>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
