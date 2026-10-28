import { useCallback, useEffect, useState } from 'react';
import { useSystemStore } from '../../store/systemStore';
import { readDesktopPreference, writeDesktopPreference } from './desktopPreferences';

export type DesktopAppearance = 'system' | 'light' | 'dark';
const preferenceKey = 'bgs-desktop-appearance';

export function useDesktopAppearance() {
  const isDark = useSystemStore(state => state.isDark);
  const setTheme = useSystemStore(state => state.setTheme);
  const [appearance, setAppearanceState] = useState<DesktopAppearance>(() => {
    const saved = readDesktopPreference(preferenceKey);
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
    return isDark ? 'dark' : 'light';
  });
  const setAppearance = useCallback((value: DesktopAppearance) => {
    writeDesktopPreference(preferenceKey, value);
    setAppearanceState(value);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setTheme(appearance === 'system' ? media.matches : appearance === 'dark');
    apply();
    if (appearance !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance, setTheme]);
  return { appearance, setAppearance };
}
