import { execFileSync } from 'node:child_process';
import portalHtml from '../../../game-portal/public/index.html?raw';
import { expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/dom';

// Use the Portal's browser bundle: Vite cannot resolve the separately served /auth.js resource.
const controller = execFileSync('bun', ['build', '../game-portal/public/portal.js', '--target=browser', '--format=iife', '--external=/auth.js', '--define', 'import.meta.env={}'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

it('recovers from metadata/network errors, a slow iframe and iframe errors through the real Portal controls', async () => {
  window.history.replaceState(null, '', '/g/loading-regression');
  document.body.innerHTML = portalHtml;
  const game = { projectId: 'loading-regression', gameUrl: 'https://game.example/deployments/release/files/index.html', title: 'Game', authorId: 'creator', authorName: 'Creator', description: '', publishedAt: '2026-11-03' };
  let response: 'missing' | 'network' | 'invalid' | 'ok' = 'missing';
  const requests = vi.fn(async (input: string) => {
    if (input === '/api/config') return Response.json({});
    if (input === '/api/games/loading-regression') {
      if (response === 'network') throw new TypeError('Failed to fetch: internal diagnostic');
      if (response === 'missing') return Response.json({}, { status: 404 });
      return Response.json({ ...game, gameUrl: response === 'invalid' ? `${location.origin}/bad-game` : game.gameUrl });
    }
    return Response.json({ games: [] });
  });
  vi.stubGlobal('fetch', requests);
  const node = (id: string) => document.getElementById(id)!;
  try {
    localStorage.setItem('i18nextLng', 'zh');
    document.cookie = 'beegame-language=zh; Path=/';
    new Function(controller)();
    await waitFor(() => expect(node('load-message')).toHaveTextContent('游戏尚未发布到 Portal。'));
    expect(node('load-avatar')).toBeInTheDocument();
    expect(node('load-retry')).toBeVisible();
    response = 'network';
    fireEvent.click(node('load-retry'));
    await waitFor(() => expect(node('load-message')).toHaveTextContent('请重新加载游戏后再试。'));
    expect(node('load-state')).not.toHaveTextContent('internal diagnostic');
    response = 'invalid';
    fireEvent.click(node('load-retry'));
    await waitFor(() => expect(node('load-message')).toHaveTextContent('游戏地址无效。'));
    response = 'ok';
    vi.useFakeTimers();
    fireEvent.click(node('load-retry'));
    await vi.advanceTimersByTimeAsync(0);
    expect(node('load-state')).toHaveAttribute('data-state', 'loading');
    expect(node('load-retry')).not.toBeVisible();
    expect(node('game-frame')).toHaveAttribute('src', game.gameUrl);
    await vi.advanceTimersByTimeAsync(15000);
    expect(node('load-state')).toHaveAttribute('data-state', 'slow');
    expect(node('load-retry')).toBeVisible();
    fireEvent.change(node('portal-language'), { target: { value: 'en' } });
    expect(node('load-title')).toHaveTextContent('Taking a little longer');
    expect(node('load-retry')).toHaveTextContent('Reload');
    expect(node('load-avatar')).toBeInTheDocument();
    fireEvent.click(node('load-retry'));
    expect(node('load-state')).toHaveAttribute('data-state', 'loading');
    fireEvent.error(node('game-frame'));
    expect(node('load-state')).toHaveAttribute('data-state', 'error');
    expect(node('load-title')).toHaveTextContent('Unable to load the game');
    fireEvent.click(node('load-retry'));
    fireEvent.load(node('game-frame'));
    expect(node('load-state')).not.toBeVisible();
    await vi.advanceTimersByTimeAsync(15000);
    expect(node('load-state')).not.toBeVisible();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  }
});
