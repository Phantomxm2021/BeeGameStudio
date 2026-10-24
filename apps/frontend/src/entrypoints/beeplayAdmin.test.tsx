import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BeePlayAdminPage } from './beeplayAdmin';
const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  auth: { initializeSupabaseSession: vi.fn(), getSupabaseSessionUser: vi.fn(), clearSupabaseSession: vi.fn(), signInWithSupabasePassword: vi.fn(), signInWithSupabaseOAuth: vi.fn() },
}));
vi.mock('../../../game-portal/src/admin-api', () => ({ loadPortalAuth: async () => mocks.auth, canManageBeePlay: mocks.owner }));
vi.mock('../components/BeePlay/BeePlayAdminPanel', () => ({ BeePlayAdminPanel: () => <div>Authorized management panel</div> }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.auth.getSupabaseSessionUser.mockReturnValue(null);
  mocks.owner.mockResolvedValue(false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ supabaseUrl: 'https://test.invalid', supabaseAnonKey: 'public-test-key' }) }));
});
afterEach(() => vi.unstubAllGlobals());
describe('independent admin access', () => {
  it('automatically hands an unsigned-in admin page to BGS once, without asking for credentials', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { href: 'https://portal.test/admin', replace });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ supabaseUrl: 'https://test.invalid', supabaseAnonKey: 'public-test-key', bgsSsoEnabled: true }) }));
    render(<BeePlayAdminPage />);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/bgs/start'));
    expect(screen.queryByRole('heading', { name: '管理员登录' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('beeplay_bgs_auto_attempt')).toBe('attempted');
  });
  it('offers direct login after BGS reports no usable session instead of looping', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { href: 'https://portal.test/admin?bgs=login_required', replace });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ supabaseUrl: 'https://test.invalid', supabaseAnonKey: 'public-test-key', bgsSsoEnabled: true }) }));
    render(<BeePlayAdminPage />);
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
  it('shows login for guests without requesting management data', async () => {
    render(<BeePlayAdminPage />);
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeInTheDocument();
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(screen.queryByText('Authorized management panel')).not.toBeInTheDocument();
  });
  it('blocks a signed-in non-owner', async () => {
    mocks.auth.getSupabaseSessionUser.mockReturnValue({ email: 'member@example.test' });
    render(<BeePlayAdminPage />);
    expect(await screen.findByText('当前账号没有管理员权限')).toBeInTheDocument();
    expect(screen.queryByText('Authorized management panel')).not.toBeInTheDocument();
  });
  it('opens the panel for an owner and removes it on sign-out', async () => {
    mocks.auth.getSupabaseSessionUser.mockReturnValue({ email: 'owner@example.test' });
    mocks.owner.mockResolvedValue(true);
    render(<BeePlayAdminPage />);
    expect(await screen.findByText('Authorized management panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(mocks.auth.clearSupabaseSession).toHaveBeenCalledOnce();
    expect(screen.queryByText('Authorized management panel')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '管理员登录' })).toBeInTheDocument();
  });
});
