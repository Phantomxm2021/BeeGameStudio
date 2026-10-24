import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BeePlayAdminPanel } from '../components/BeePlay/BeePlayAdminPanel';
import { Button } from '../components/beui/project-button';
import { ThemeToggleButton } from '../components/beui/motion/theme-toggle-button';
import { applyThemeToDocument, readThemePreference, writeThemePreference } from '../lib/themePreference';
import { canManageBeePlay, loadPortalAuth } from '../../../game-portal/src/admin-api';
import type * as Auth from '../../../game-portal/src/auth';

type Access = 'loading' | 'login' | 'allowed' | 'forbidden' | 'error';
export function BeePlayAdminPage() {
  const [auth, setAuth] = useState<typeof Auth | null>(null);
  const [access, setAccess] = useState<Access>('loading');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [account, setAccount] = useState('');
  const [isDark, setIsDark] = useState(readThemePreference);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setAccess('loading'); setError('');
    void (async () => {
      const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('账号服务暂不可用。');
      const config = await response.json();
      if (!config.supabaseUrl || !config.supabaseAnonKey) throw Error('账号服务暂不可用。');
      (globalThis as typeof globalThis & { BEEGAME_PORTAL_ENV: unknown }).BEEGAME_PORTAL_ENV = {
        VITE_SUPABASE_URL: config.supabaseUrl, VITE_SUPABASE_ANON_KEY: config.supabaseAnonKey,
      };
      const client = await loadPortalAuth();
      await client.initializeSupabaseSession();
      const user = client.getSupabaseSessionUser();
      if (!user && config.bgsSsoEnabled && !new URL(location.href).searchParams.has('bgs') && !sessionStorage.getItem('beeplay_bgs_auto_attempt')) {
        sessionStorage.setItem('beeplay_bgs_auto_attempt', 'attempted');
        location.replace('/auth/bgs/start');
        return;
      }
      const allowed = user ? await canManageBeePlay() : false;
      if (!disposed) {
        setAuth(client); setAccount(user?.displayName || user?.email || '');
        setAccess(user ? allowed ? 'allowed' : 'forbidden' : 'login');
      }
    })().catch(() => { if (!disposed) { setError('暂时无法连接账号服务，请重试。'); setAccess('error'); } });
    return () => { disposed = true; };
  }, [retry]);
  const signIn = async () => {
    if (!auth) return;
    setBusy(true); setError('');
    try {
      const session = await auth.signInWithSupabasePassword({ email, password });
      setPassword(''); setAccount(session.user.displayName || session.user.email || '');
      setAccess(await canManageBeePlay() ? 'allowed' : 'forbidden');
    } catch { setError('登录失败，请检查账号信息后重试。'); }
    finally { setBusy(false); }
  };
  const oauth = async (provider: 'github' | 'discord') => {
    if (!auth) return;
    setBusy(true); setError('');
    try { sessionStorage.setItem('beegame_portal_return', '/admin'); await auth.signInWithSupabaseOAuth(provider); }
    catch { setError('暂时无法连接登录服务，请重试。'); setBusy(false); }
  };
  const signOut = async () => { try { await auth?.clearSupabaseSession(); setAccount(''); setAccess('login'); setPassword(''); setError(''); } catch { setError('退出登录失败，请重试。'); } };
  return <>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Bee Play 首页"><img className="brand-mark" src="/assets/bgs_logo.svg" alt="" width="32" height="32" /><span>Bee Play</span></a>
      <div className="admin-header-actions"><a href="/">返回游戏大厅</a><ThemeToggleButton isDark={isDark} darkModeLabel="切换为深色模式" lightModeLabel="切换为浅色模式" onThemeChange={value => { setIsDark(value); applyThemeToDocument(value); writeThemePreference(value); }} />{account && <Button variant="outline" onClick={signOut}>退出登录</Button>}</div>
    </header>
    <main id="main" className="beeplay-admin">
      <div className="admin-page-heading"><p>Bee Play</p><h1>管理后台</h1><p>{account || '推荐管理与游戏数据统计'}</p></div>
      {error && <p role="alert" className="admin-message">{error}</p>}
      {access === 'loading' && <p role="status">正在验证账号权限…</p>}
      {access === 'error' && <Button onClick={() => setRetry(value => value + 1)}>重试</Button>}
      {access === 'login' && <section className="admin-login"><h2>管理员登录</h2><p>使用已有 BGS 登录状态，或直接登录管理员账号。</p><a href="/auth/bgs/start" className="inline-block mt-4 underline">使用 BGS 登录状态进入</a>
        <form onSubmit={event => { event.preventDefault(); void signIn(); }}>
          <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <Button type="submit" disabled={busy || !auth}>{busy ? '正在登录…' : '登录管理后台'}</Button>
        </form>
        <div className="admin-oauth"><Button variant="outline" disabled={busy || !auth} onClick={() => void oauth('github')}>使用 GitHub</Button><Button variant="outline" disabled={busy || !auth} onClick={() => void oauth('discord')}>使用 Discord</Button></div>
      </section>}
      {access === 'forbidden' && <section className="admin-login"><h2>当前账号没有管理员权限</h2><p>请使用已有的管理员账号登录。</p><Button variant="outline" onClick={signOut}>切换账号</Button></section>}
      {access === 'allowed' && <BeePlayAdminPanel language="zh" />}
    </main>
  </>;
}
const root = document.getElementById('beeplay-admin-root');
if (root) createRoot(root).render(<BeePlayAdminPage />);
