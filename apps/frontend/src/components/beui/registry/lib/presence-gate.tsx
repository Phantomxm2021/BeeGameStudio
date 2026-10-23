// beui.dev/components/motion/center-morph-modal
import { useIsPresent } from 'motion/react';
import type { ReactNode } from 'react';

interface PresenceGateRenderProps {
  isPresent: boolean;
  gate: {
    inert: boolean;
    style: { pointerEvents: 'auto' | 'none' };
  };
}

export function PresenceGate({ children }: { children: (props: PresenceGateRenderProps) => ReactNode }) {
  const isPresent = useIsPresent();
  return children({
    isPresent,
    gate: {
      inert: !isPresent,
      style: { pointerEvents: isPresent ? 'auto' : 'none' },
    },
  });
}
