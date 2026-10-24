import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeToggleButton } from '../components/beui/motion/theme-toggle-button';
import { UserAccountMenu } from '../components/Demiurge/Landing/UserAccountMenu';
import { canManageBeePlay } from '../../../game-portal/src/admin-api';
import { FolderOpen, Settings } from 'lucide-react';
import { getPortalAccountUser, subscribePortalAccount, openPortalLogin, signOutPortalAccount } from '../../../game-portal/public/portal.js';
import { applyThemeToDocument, readThemePreference, writeThemePreference, subscribeThemePreference } from '../lib/themePreference';

function PortalThemeToggle() {
  const [isDark, setIsDark] = useState(readThemePreference);
  useEffect(() => subscribeThemePreference(() => {
    const nextIsDark = readThemePreference();
    applyThemeToDocument(nextIsDark);
    setIsDark(nextIsDark);
  }), []);
  return <ThemeToggleButton className="portal-theme-toggle" isDark={isDark}
    darkModeLabel="切换为深色模式" lightModeLabel="切换为浅色模式"
    onThemeChange={(nextIsDark) => {
      applyThemeToDocument(nextIsDark);
      writeThemePreference(nextIsDark);
      setIsDark(nextIsDark);
    }} />;
}

for (const container of document.querySelectorAll('[data-theme-toggle]')) {
  createRoot(container).render(<PortalThemeToggle />);
}

function PortalAccountMenu() {
  const [user, setUser] = useState(getPortalAccountUser);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let disposed = false;
    setIsAdmin(false);
    if (user) void canManageBeePlay().then(allowed => { if (!disposed) setIsAdmin(allowed); }).catch(() => {});
    return () => { disposed = true; };
  }, [user]);
  useEffect(() => subscribePortalAccount(setUser), []);
  return <UserAccountMenu
    ariaLabel={user ? '用户菜单' : '登录'}
    currentUserId={user?.id}
    currentUserDisplayName={user?.displayName}
    currentUserEmail={user?.email}
    currentUserAvatarUrl={user?.avatarUrl}
    fallbackUserLabel="我的账号"
    signOutLabel="退出登录"
    items={user ? [{
      key: 'releases', label: '我的发布', icon: <FolderOpen className="h-4 w-4" />,
      onClick: () => location.assign(`/?author=${encodeURIComponent(user.id)}`),
    }, ...(isAdmin ? [{ key: 'admin', label: '管理后台', icon: <Settings className="h-4 w-4" />, onClick: () => location.assign('/admin') }] : [])] : []}
    onOpenLogin={() => void openPortalLogin()}
    onSignOut={signOutPortalAccount}
  />;
}

createRoot(document.getElementById('account-avatar')!).render(<PortalAccountMenu />);
