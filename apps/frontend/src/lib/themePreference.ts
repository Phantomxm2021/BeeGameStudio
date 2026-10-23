const STORAGE_KEY = 'system-storage';
const COOKIE_NAME = 'beegame-theme';

function cookieTheme(): boolean | undefined {
  const value = document.cookie.split('; ').find((part) => part.startsWith(`${COOKIE_NAME}=`))?.split('=')[1];
  return value === 'dark' ? true : value === 'light' ? false : undefined;
}

export function readThemePreference(): boolean {
  if (typeof document === 'undefined') return true;
  const shared = cookieTheme();
  if (shared !== undefined) return shared;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')?.state?.isDark;
    return typeof value === 'boolean' ? value : true;
  } catch {
    return true;
  }
}

export function writeThemePreference(isDark: boolean): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...saved,
      version: saved?.version ?? 0,
      state: { ...saved?.state, isDark },
    }));
  } catch {
    // Shared cookies still work when local storage is unavailable.
  }
  if (cookieTheme() === isDark) return;
  const host = location.hostname;
  const domain = host === 'beegame.studio' || host.endsWith('.beegame.studio') ? '; Domain=beegame.studio' : '';
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${isDark ? 'dark' : 'light'}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure}`;
}

export function applyThemeToDocument(isDark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? '#090a0c' : '#f7f8fa';
}

export function subscribeThemePreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  const onVisibility = () => { if (!document.hidden) onChange(); };
  const cookies = (window as Window & { cookieStore?: EventTarget }).cookieStore;
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onChange);
  window.addEventListener('pageshow', onChange);
  document.addEventListener('visibilitychange', onVisibility);
  cookies?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('pageshow', onChange);
    document.removeEventListener('visibilitychange', onVisibility);
    cookies?.removeEventListener('change', onChange);
  };
}
