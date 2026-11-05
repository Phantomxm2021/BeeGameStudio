import i18n, { t } from '../../../game-portal/src/player-i18n';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeToggleButton } from '../components/beui/motion/theme-toggle-button';
import { UserAccountMenu } from '../components/Demiurge/Landing/UserAccountMenu';
import { canManageBeePlay } from '../../../game-portal/src/admin-api';
import { FolderOpen, Settings } from 'lucide-react';
import { animateDot, type DotRenderOptions } from '../components/Demiurge/Landing/vendor/dots-lab';
import { getDailyAvatar } from '../components/Demiurge/Landing/useDailyAvatar';
import { getPortalAccountUser, subscribePortalAccount, openPortalLogin, signOutPortalAccount } from '../../../game-portal/public/portal.js';
import { applyThemeToDocument, readThemePreference, writeThemePreference, subscribeThemePreference } from '../lib/themePreference';

function usePortalLanguage() {
  const [, update] = useState(0);
  useEffect(() => { const changed = () => update(value => value + 1); i18n.on('languageChanged', changed); return () => { i18n.off('languageChanged', changed); }; }, []);
}

function PortalThemeToggle() {
  usePortalLanguage();
  const [isDark, setIsDark] = useState(readThemePreference);
  useEffect(() => subscribeThemePreference(() => {
    const nextIsDark = readThemePreference();
    applyThemeToDocument(nextIsDark);
    setIsDark(nextIsDark);
  }), []);
  return <ThemeToggleButton className="portal-theme-toggle" isDark={isDark}
    darkModeLabel={t('dark')} lightModeLabel={t('light')}
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
  usePortalLanguage();
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
    ariaLabel={user ? t('account') : t('signIn')}
    currentUserId={user?.id}
    currentUserDisplayName={user?.displayName}
    currentUserEmail={user?.email}
    currentUserAvatarUrl={user?.avatarUrl}
    fallbackUserLabel={t('account')}
    signOutLabel={t('signOut')}
    items={user ? [{
      key: 'releases', label: t('releases'), icon: <FolderOpen className="h-4 w-4" />,
      onClick: () => location.assign(`/?author=${encodeURIComponent(user.id)}`),
    }, ...(isAdmin ? [{ key: 'admin', label: t('admin'), icon: <Settings className="h-4 w-4" />, onClick: () => location.assign('/admin') }] : [])] : []}
    onOpenLogin={() => void openPortalLogin()}
    onSignOut={signOutPortalAccount}
  />;
}

createRoot(document.getElementById('account-avatar')!).render(<PortalAccountMenu />);

// Use the main site's avatar without its pointer reactions or sound effects.
if (document.body.classList.contains('play-page')) {
  const status = document.getElementById('load-state')!;
  const canvas = document.getElementById('load-avatar') as HTMLCanvasElement;
  const token = getDailyAvatar();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let avatar: ReturnType<typeof animateDot> | null = null;
  const paint = () => {
    if (status.hidden || document.hidden) {
      avatar?.dispose();
      avatar = null;
      return;
    }
    const color = document.documentElement.classList.contains('dark') ? '#F5F5F5' : '#181818';
    const options: DotRenderOptions = { token, state: status.dataset.state === 'loading' ? 'think' : status.dataset.state === 'slow' ? 'alert' : 'error', reduced: motion.matches, color, ink: color };
    if (avatar) avatar.update(options);
    else avatar = animateDot(canvas, options);
  };
  const observer = new MutationObserver(paint);
  observer.observe(status, { attributes: true, attributeFilter: ['hidden', 'data-state'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(paint).observe(canvas.parentElement!);
  motion.addEventListener('change', paint);
  document.addEventListener('visibilitychange', paint);
  paint();
}
