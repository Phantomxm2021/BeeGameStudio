import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bgs-daily-avatar';
// Dots Lab's twelve shapes, with five friendly eye styles. Keep neutral brows,
// automatic face contrast and consistent proportions; mood remains interactive.
const TOKENS = Array.from({ length: 12 }, (_, shape) =>
  Array.from({ length: 5 }, (_, eyes) => `m1${shape.toString(36)}${eyes}0089f0f5f5f5`),
).flat();

export function getDailyAvatar(now = new Date()): string {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const previous = saved && TOKENS.includes(saved.token) ? saved.token as string : undefined;
    if (saved?.day === day && previous) return previous;
    // A new day's silhouette should visibly change, even if randomness would
    // otherwise pick yesterday's shape with a different face.
    const choices = previous ? TOKENS.filter(token => token[2] !== previous[2]) : TOKENS;
    const token = choices[Math.floor(Math.random() * choices.length)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, token }));
    return token;
  } catch (error) {
    console.warn('Daily avatar preference unavailable:', error);
    // Storage-disabled browsers still get a stable appearance for the day.
    const seed = Array.from(day).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    return TOKENS[seed % TOKENS.length];
  }
}

export function useDailyAvatar(): string {
  const [token, setToken] = useState(getDailyAvatar);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToken(getDailyAvatar(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 50);
    };
    const resume = () => { if (!document.hidden) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  return token;
}
