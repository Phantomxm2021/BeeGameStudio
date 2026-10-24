import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readThemePreference, writeThemePreference, subscribeThemePreference } from './themePreference';

describe('shared main-site and Portal theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'beegame-theme=; Path=/; Max-Age=0';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the shared choice instead of an outdated origin-local choice', () => {
    localStorage.setItem('system-storage', JSON.stringify({ state: { isDark: false } }));
    document.cookie = 'beegame-theme=dark; Path=/';
    expect(readThemePreference()).toBe(true);
  });

  it('migrates the existing local preference when no shared choice exists', () => {
    localStorage.setItem('system-storage', JSON.stringify({ state: { isDark: false } }));
    expect(readThemePreference()).toBe(false);
    writeThemePreference(readThemePreference());
    expect(document.cookie).toContain('beegame-theme=light');
  });

  it('retains other persisted settings when saving a new choice', () => {
    localStorage.setItem('system-storage', JSON.stringify({ state: { isDark: true, anotherSetting: 42 }, version: 2 }));
    writeThemePreference(false);
    expect(JSON.parse(localStorage.getItem('system-storage')!)).toEqual({ state: { isDark: false, anotherSetting: 42 }, version: 2 });
    expect(readThemePreference()).toBe(false);
  });

  it('shares the preference across the production subdomains', () => {
    vi.stubGlobal('location', { hostname: 'portal.beegame.studio', protocol: 'https:' });
    const setter = vi.spyOn(document, 'cookie', 'set');
    writeThemePreference(true);
    expect(setter).toHaveBeenCalledWith(expect.stringContaining('Domain=beegame.studio; Secure'));
    setter.mockRestore();
  });

  it('rereads the shared choice when returning to a page and removes listeners on cleanup', () => {
    const changes: boolean[] = [];
    const stop = subscribeThemePreference(() => changes.push(readThemePreference()));
    document.cookie = 'beegame-theme=light; Path=/';
    window.dispatchEvent(new Event('focus'));
    expect(changes).toEqual([false]);
    stop();
    window.dispatchEvent(new Event('focus'));
    expect(changes).toEqual([false]);
  });
});
