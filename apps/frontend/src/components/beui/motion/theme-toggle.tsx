import { useEffect } from 'react';
import { applyThemeToDocument, useSystemStore } from '@/store/systemStore';
import { ThemeToggleButton } from './theme-toggle-button';

export function ThemeToggle(props: {
  className?: string;
  darkModeLabel?: string;
  lightModeLabel?: string;
}) {
  const isDark = useSystemStore((state) => state.isDark);
  const setTheme = useSystemStore((state) => state.setTheme);
  useEffect(() => applyThemeToDocument(isDark), [isDark]);

  return <ThemeToggleButton {...props} isDark={isDark} onThemeChange={(nextIsDark) => {
    applyThemeToDocument(nextIsDark);
    setTheme(nextIsDark);
  }} />;
}
