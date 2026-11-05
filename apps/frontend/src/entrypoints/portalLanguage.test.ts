import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/dom';
import { CookieJar, JSDOM } from 'jsdom';
import portalHtml from '../../../game-portal/public/index.html?raw';
import { readUiLanguage, writeUiLanguage } from '../i18n/languagePreference';

const controller = execFileSync('bun', ['build', '../game-portal/public/portal.js', '--target=browser', '--format=iife', '--external=/auth.js', '--define', 'import.meta.env={}'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const media = window.matchMedia;
let pages: JSDOM[], cookies: CookieJar;
function bind(page: JSDOM) {
  page.window.matchMedia = media;
  vi.stubGlobal('window', page.window);
  vi.stubGlobal('document', page.window.document);
  vi.stubGlobal('location', page.window.location);
  vi.stubGlobal('localStorage', page.window.localStorage);
}
function page(path = '/', html = portalHtml, origin = 'https://portal.beegame.studio') {
  const next = new JSDOM(html, { url: origin + path, cookieJar: cookies, pretendToBeVisual: true });
  pages.push(next); bind(next); return next;
}
const node = (id: string) => document.getElementById(id)!;
const change = (value: string) => fireEvent.change(node('portal-language'), { target: { value } });
const games = [1, 2].map(count => ({ projectId: 'game_' + count, title: '原文游戏 ' + count, authorId: 'creator', authorName: 'Creator', playCount: count }));
const api = (status = 200, rows = games) => vi.fn(async (input: string) => {
  if (input === '/api/config') return Response.json({});
  if (input === '/api/featured') return Response.json({ games: [] });
  return Response.json({ games: rows }, { status });
});
beforeEach(() => { pages = []; cookies = new CookieJar(); });
afterEach(() => { pages.forEach(p => p.window.close()); vi.unstubAllGlobals(); });

it('updates loaded game counts in all ten languages without refetching, persists on reload and follows the main site', async () => {
  page(); const fetcher = api(); vi.stubGlobal('fetch', fetcher);
  new Function(controller)();
  await waitFor(() => expect(document.querySelectorAll('#game-grid .play-count')).toHaveLength(2));
  const first = document.querySelector('#game-grid .play-count');
  const calls = fetcher.mock.calls.length;
  const labels: Record<string, string> = { en: '1 play', zh: '1 次游玩', 'zh-TW': '1 次遊玩', ja: '1 回プレイ', ko: '1회 플레이', fr: '1 parties', de: '1 Aufrufe', es: '1 partidas', it: '1 partite', pt: '1 partidas' };
  for (const [language, expected] of Object.entries(labels)) {
    change(language);
    expect(document.documentElement.lang).toBe(language);
    expect(first).toHaveTextContent(expected);
    expect(node('portal-language')).toHaveValue(language);
  }
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(document.querySelector('#game-grid .play-count')).toBe(first);
  change('en');
  expect(node('all-releases')).toHaveTextContent('Browse all games');
  expect(node('search-games')).toHaveAttribute('placeholder', 'Search games');
  expect(document.title).toContain('Play creator games');
  expect(node('game-grid')).toHaveTextContent('原文游戏 1');
  const reloaded = page(); new Function(controller)();
  await waitFor(() => expect(document.querySelector('#game-grid .play-count')).toHaveTextContent('1 play'));
  page('/', '', 'https://beegame.studio');
  expect(readUiLanguage()).toBe('en');
  writeUiLanguage('ja');
  bind(reloaded);
  window.dispatchEvent(new window.Event('focus'));
  expect(node('portal-language')).toHaveValue('ja');
  expect(document.querySelector('#game-grid .play-count')).toHaveTextContent('1 回プレイ');
});

it('keeps an empty catalogue empty when switching languages instead of returning to Loading', async () => {
  page(); vi.stubGlobal('fetch', api(200, [])); new Function(controller)();
  await waitFor(() => expect(node('catalogue-status')).toHaveTextContent('好游戏正在路上'));
  change('en');
  expect(node('catalogue-status')).toHaveTextContent('Great games are on their way');
  expect(node('catalogue-status')).not.toHaveTextContent('Loading');
});

it('translates a loaded error and creator heading immediately', async () => {
  page('/?author=creator'); const fetcher = api(503); vi.stubGlobal('fetch', fetcher); new Function(controller)();
  await waitFor(() => expect(node('load-more')).toBeVisible());
  change('en');
  expect(node('catalogue-status')).toHaveTextContent('Could not load the game');
  expect(node('load-more')).toHaveTextContent('Retry');
  fetcher.mockImplementation(api());
  fireEvent.click(node('load-more'));
  await waitFor(() => expect(node('catalogue-title')).toHaveTextContent('Games by Creator'));
  change('zh');
  expect(node('catalogue-title')).toHaveTextContent('Creator 的游戏');
});
