export const supportedI18nLanguages = ['en', 'zh', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt'] as const;
export type UiLanguage = (typeof supportedI18nLanguages)[number];
const cookieName = 'beegame-language';
const supported = (value: string | null | undefined): value is UiLanguage => supportedI18nLanguages.includes(value as UiLanguage);

export function readUiLanguage(): UiLanguage {
  if (typeof document === 'undefined') return 'zh';
  const shared = document.cookie.split('; ').find(part => part.startsWith(`${cookieName}=`))?.split('=')[1];
  if (supported(shared)) return shared;
  try {
    const saved = localStorage.getItem('i18nextLng');
    return supported(saved) ? saved : 'zh';
  } catch { return 'zh'; } // Browsers can deny preference storage.
}
export function writeUiLanguage(language: string): void {
  if (!supported(language) || typeof document === 'undefined') return;
  try { localStorage.setItem('i18nextLng', language); } catch { /* The shared cookie still persists the choice. */ }
  if (document.cookie.split('; ').includes(`${cookieName}=${language}`)) return;
  const host = location.hostname;
  const domain = host === 'beegame.studio' || host.endsWith('.beegame.studio') ? '; Domain=beegame.studio' : '';
  document.cookie = `${cookieName}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${location.protocol === 'https:' ? '; Secure' : ''}`;
}
export function subscribeUiLanguage(onChange: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === 'i18nextLng' || event.key === null) onChange(); };
  const visible = () => { if (!document.hidden) onChange(); };
  const cookies = (window as Window & { cookieStore?: EventTarget }).cookieStore;
  window.addEventListener('storage', storage);
  window.addEventListener('focus', onChange);
  window.addEventListener('pageshow', onChange);
  document.addEventListener('visibilitychange', visible);
  cookies?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('pageshow', onChange);
    document.removeEventListener('visibilitychange', visible);
    cookies?.removeEventListener('change', onChange);
  };
}
