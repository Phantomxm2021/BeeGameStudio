import { publicationTitle } from '../../frontend/src/utils/publicationPresentation';

export type BeePlayMetrics = {
  visits: number;
  plays: number;
  visitors: number;
  impressions: number;
  clicks: number;
};
export type BeePlayGame = BeePlayMetrics & {
  project_id: string;
  title: string;
  public_description?: string;
  author_name: string;
  play_count: number;
};
export type BeePlayRecommendation = Pick<BeePlayGame, 'project_id' | 'title' | 'public_description'>;
export type BeePlayOverview = {
  games: BeePlayGame[];
  totalGames: number;
  featured: BeePlayRecommendation[];
  totals: BeePlayMetrics;
  daily: (BeePlayMetrics & { day: string })[];
};
export async function getBeePlayOverview(params: {
  from: string;
  to: string;
  query: string;
  page: number;
  project: string;
}) {
  const overview = await portalRpc<BeePlayOverview>('beegame_admin_portal_overview', {
    p_from: params.from, p_to: params.to, p_query: params.query, p_page: params.page, p_project_id: params.project || null,
  });
  return {
    ...overview,
    games: overview.games.map(game => ({ ...game, title: publicationTitle(game.public_description, game.title) })),
    featured: overview.featured.map(game => ({ ...game, title: publicationTitle(game.public_description, game.title) })),
  };
}
export async function saveBeePlayRecommendations(projectIds: string[]) {
  return portalRpc<{ projectIds: string[] }>('beegame_admin_portal_featured', { p_project_ids: projectIds });
}

export async function loadPortalAuth(): Promise<typeof import('./auth')> {
  // Auth is built once and shared by the public site and independent admin page.
  const path = '/auth.js';
  return import(/* @vite-ignore */ path);
}
export async function canManageBeePlay(): Promise<boolean> {
  return (await portalRpc<boolean>('beegame_is_platform_owner', {})) === true;
}
async function portalRpc<T>(name: string, body: unknown): Promise<T> {
  const auth = await loadPortalAuth();
  if (auth.hasBgsPortalSession()) {
    const paths: Record<string, string> = { beegame_admin_portal_overview: 'overview', beegame_admin_portal_featured: 'featured', beegame_is_platform_owner: 'owner' };
    const path = paths[name];
    if (!path) throw Error('Unknown management request');
    const response = await fetch('/api/admin/beeplay/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) {
      if (/^\/admin(?:\/|\.html)?$/.test(location.pathname)) location.assign('/auth/bgs/start');
      throw Error('正在恢复 BGS 登录状态…');
    }
    if (!response.ok) throw Error(response.status === 403 ? '此账号没有管理员权限。' : '暂时无法读取或保存，请重试。');
    return response.json() as Promise<T>;
  }
  const token = await auth.getValidSupabaseAccessToken();
  if (!token) throw new Error('请先登录 BeePlay。');
  const env = (globalThis as typeof globalThis & { BEEGAME_PORTAL_ENV?: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string } }).BEEGAME_PORTAL_ENV;
  if (!env?.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('账号服务暂不可用。');
  const response = await fetch(new URL('/rest/v1/rpc/' + name, env.VITE_SUPABASE_URL), {
    method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? '登录已过期，请重新登录。' : response.status === 403 ? '此账号没有管理员权限。' : '暂时无法读取或保存，请重试。');
  return response.json() as Promise<T>;
}
