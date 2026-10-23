import { useEffect, useEffectEvent, useRef, useState } from 'react';

// Load a section on its first visit in this dialog session. Navigation and
// translated feedback must not reload data over drafts. Closing the dialog,
// changing users or losing permission invalidates outstanding responses.
export function useSettingsSectionLoad({
  isOpen, allowed, selected, userId, load,
}: {
  isOpen: boolean;
  allowed: boolean;
  selected: boolean;
  userId: string | undefined;
  load: (isCurrent: () => boolean) => Promise<unknown>;
}) {
  const sessionRef = useRef<{ active: boolean; started: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const beginLoad = useEffectEvent((isCurrent: () => boolean) => {
    setLoading(true);
    void load(isCurrent).finally(() => { if (isCurrent()) setLoading(false); });
  });

  useEffect(() => {
    const session = { active: isOpen && allowed, started: false };
    sessionRef.current = session;
    return () => { session.active = false; };
  }, [isOpen, allowed, userId]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.active || !selected || session.started) return;
    session.started = true;
    beginLoad(() => session.active);
  }, [isOpen, allowed, selected, userId]);

  return isOpen && allowed && loading;
}
