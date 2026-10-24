import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UserAccountMenu } from './UserAccountMenu';

const base = {
  ariaLabel: '用户菜单', fallbackUserLabel: '我的账号', signOutLabel: '退出登录',
  items: [], onOpenLogin: vi.fn(),
};

describe('shared account entry for the main site and Portal', () => {
  it('opens login from the anonymous avatar', async () => {
    const onOpenLogin = vi.fn();
    render(<UserAccountMenu {...base} ariaLabel="登录" onOpenLogin={onOpenLogin} />);
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(onOpenLogin).toHaveBeenCalledOnce();
  });

  it('shows the supplied avatar and falls back to the user initial on image failure', () => {
    const { container } = render(<UserAccountMenu {...base} currentUserId="local-user"
      currentUserDisplayName="Alice" currentUserAvatarUrl="https://example.test/avatar.png" />);
    const image = container.querySelector('img')!;
    expect(image).toHaveAttribute('src', 'https://example.test/avatar.png');
    fireEvent.error(image);
    expect(screen.getByRole('button', { name: '用户菜单' })).toHaveTextContent('A');
  });

  it('opens the shared menu and dispatches the Portal release action', async () => {
    const onReleases = vi.fn();
    render(<UserAccountMenu {...base} currentUserId="local-user" currentUserDisplayName="Alice"
      currentUserEmail="alice@example.test"
      items={[{ key: 'releases', label: '我的发布', icon: null, onClick: onReleases }]} />);
    await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(await screen.findByRole('menu', { name: '用户菜单' })).toHaveTextContent('alice@example.test');
    await userEvent.click(screen.getByRole('menuitem', { name: '我的发布' }));
    expect(onReleases).toHaveBeenCalledOnce();
  });

  it('signs out only after selecting the sign-out menu item', async () => {
    const onSignOut = vi.fn();
    render(<UserAccountMenu {...base} currentUserId="local-user" currentUserDisplayName="Alice" onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(onSignOut).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
