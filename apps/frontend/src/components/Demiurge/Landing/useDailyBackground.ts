import { useEffect, useState } from 'react';

// Componentry's three official presets; composition and animation use its defaults.
const palettes = [
  { name: 'Sea glass', colors: ['#dce5df', '#83b9ad', '#031419'] },
  { name: 'Dusk', colors: ['#e8dce8', '#a594c4', '#191426'] },
  { name: 'Sand', colors: ['#f1e4ce', '#c7a780', '#26201d'] },
] as const;
const storageKey = 'bgs-daily-background';

export function getDailyBackground(now = new Date()) {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    const previous = palettes.find(palette => palette.name === saved?.palette);
    if (saved?.day === day && previous) return previous;
    // Exclude yesterday's palette so the daily change remains visible.
    const choices = previous ? palettes.filter(palette => palette !== previous) : palettes;
    const palette = choices[Math.floor(Math.random() * choices.length)];
    localStorage.setItem(storageKey, JSON.stringify({ day, palette: palette.name }));
    return palette;
  } catch (error) {
    console.warn('Daily background preference unavailable:', error);
    const seed = Array.from(day).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    return palettes[seed % palettes.length];
  }
}

export function useDailyBackground() {
  const [palette, setPalette] = useState(getDailyBackground);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setPalette(getDailyBackground(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 50);
    };
    const resume = () => { if (!document.hidden) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  return palette;
}
