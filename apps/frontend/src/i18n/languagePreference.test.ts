import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieJar, JSDOM } from 'jsdom';
import { readUiLanguage, writeUiLanguage, subscribeUiLanguage } from './languagePreference';
function usePage(page: JSDOM) {
  vi.stubGlobal('window', page.window);
  vi.stubGlobal('document', page.window.document);
  vi.stubGlobal('location', page.window.location);
  vi.stubGlobal('localStorage', page.window.localStorage);
}
afterEach(() => vi.unstubAllGlobals());
describe('shared main-site and Portal language preference', () => {
  it('migrates the existing main-site choice, shares it with Portal and reads a Portal change on return', () => {
    const cookieJar = new CookieJar();
    const main = new JSDOM('', { url: 'https://beegame.studio/', cookieJar });
    const portal = new JSDOM('', { url: 'https://portal.beegame.studio/g/game_1', cookieJar });
    usePage(main);
    localStorage.setItem('i18nextLng', 'ja');
    writeUiLanguage(readUiLanguage());
    usePage(portal);
    expect(readUiLanguage()).toBe('ja');
    writeUiLanguage('fr');
    usePage(main);
    const changed = vi.fn(() => expect(readUiLanguage()).toBe('fr'));
    const unsubscribe = subscribeUiLanguage(changed);
    window.dispatchEvent(new window.Event('focus'));
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    window.dispatchEvent(new window.Event('focus'));
    expect(changed).toHaveBeenCalledOnce();
    main.window.close(); portal.window.close();
  });
  it('rejects unsupported external preferences and does not share with unrelated domains', () => {
    const cookieJar = new CookieJar();
    const main = new JSDOM('', { url: 'https://beegame.studio/', cookieJar });
    const other = new JSDOM('', { url: 'https://example.com/', cookieJar });
    usePage(main);
    writeUiLanguage('de');
    writeUiLanguage('unsupported');
    expect(readUiLanguage()).toBe('de');
    usePage(other);
    expect(readUiLanguage()).toBe('zh');
    main.window.close(); other.window.close();
  });
});
