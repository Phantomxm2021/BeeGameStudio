import { createPortal } from 'react-dom';
import { ExternalLink, FolderOpen, History, Settings, ShoppingCart, UserCircle } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useCommonText } from '../../../i18n/useBeeGameTranslations';
import { UserAccountMenu, type UserAccountMenuItem } from './UserAccountMenu';
import { DesktopAccountSettingsPage, type DesktopAccountSettingsData } from '../../Desktop/DesktopAccountSettingsPage';
import { useDesktopLayout } from '../../Desktop/desktopLayoutContext';

interface AccountActionsMenuProps {
    lang: Language;
    className?: string;
    isTransitioning?: boolean;
    isSettingsOpen: boolean;
    isHistoryOpen: boolean;
    isProfileOpen?: boolean;
    isCreditStoreOpen?: boolean;
    isResourceLibraryOpen?: boolean;
    currentUserId?: string;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    creditBalance?: number;
    desktopSettings?: DesktopAccountSettingsData;
    canManageResources?: boolean;
    canManageBeePlay?: boolean;
    onToggleSettings: () => void;
    onOpenResourceLibrary?: () => void;
    onToggleHistory: () => void;
    onOpenCreditStore: () => void;
    onOpenProfile: () => void;
    onOpenLogin: () => void;
    onSignOut?: () => void;
}

export function AccountActionsMenu({
    lang,
    className = '',
    isTransitioning = false,
    isSettingsOpen,
    isHistoryOpen,
    isProfileOpen = false,
    isCreditStoreOpen = false,
    isResourceLibraryOpen = false,
    currentUserId,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
    creditBalance,
    desktopSettings,
    onToggleSettings,
    onOpenResourceLibrary,
    onToggleHistory,
    onOpenCreditStore,
    onOpenProfile,
    onOpenLogin,
    onSignOut,
    canManageResources = false,
    canManageBeePlay = false,
}: AccountActionsMenuProps) {
    const t = useCommonText(lang);
    const desktop = useDesktopLayout();
    const openSection = (section: 'profile' | 'personal' | 'credit-store', fallback: () => void) => {
        if (desktop?.setSettingsSection && desktopSettings) desktop.setSettingsSection(section);
        else fallback();
    };
    const openHistory = () => { desktop?.setSettingsSection?.(null); onToggleHistory(); };
    const items: UserAccountMenuItem[] = [
        {
            key: 'profile',
            label: t.profile,
            icon: <UserCircle className="h-4 w-4" />,
            onClick: () => openSection('profile', onOpenProfile),
        },
        {
            key: 'credit-store',
            label: t.creditStore,
            icon: <ShoppingCart className="h-4 w-4" />,
            onClick: () => openSection('credit-store', onOpenCreditStore),
        },
        {
            key: 'settings',
            label: t.settings,
            icon: <Settings className="h-4 w-4" />,
            onClick: () => openSection('personal', onToggleSettings),
        },
        ...(canManageBeePlay ? [{
            key: 'beeplay',
            label: lang.startsWith('zh') ? 'BeePlay 管理后台' : 'BeePlay administration',
            icon: <ExternalLink className="h-4 w-4" />,
            onClick: () => window.open(new URL('/auth/bgs/start', String(import.meta.env.VITE_BEEGAME_GAME_PORTAL_BASE_URL || 'https://portal.beegame.studio')).href, '_blank', 'noopener,noreferrer'),
        }] : []),
        ...(canManageResources ? [{
            key: 'resources',
            label: t.resourceLibrary,
            icon: <FolderOpen className="h-4 w-4" />,
            onClick: () => { desktop?.setSettingsSection?.(null); (onOpenResourceLibrary || onToggleSettings)(); },
        }] : []),
        {
            key: 'history',
            label: t.historyProjects,
            icon: <History className="h-4 w-4" />,
            onClick: openHistory,
        },
    ];

    return (
        <>
        {desktop?.history && currentUserId ? createPortal(
            <button type="button" className="desktop-navigation-item"
                aria-haspopup="dialog" aria-expanded={isHistoryOpen}
                title={t.historyProjects} onClick={openHistory}>
                <History aria-hidden="true" /><span>{t.historyProjects}</span>
            </button>, desktop.history,
        ) : null}
        <UserAccountMenu
            ariaLabel={t.userMenu}
            className={`${className} ${desktop ? 'desktop-user-account' : ''}`.trim()}
            triggerLabel={desktop ? currentUserDisplayName?.trim() || currentUserEmail?.split('@')[0] || t.account : undefined}
            menuSide={desktop ? 'top' : 'bottom'}
            isTransitioning={isTransitioning}
            isActive={isSettingsOpen || isHistoryOpen || isProfileOpen || isCreditStoreOpen || isResourceLibraryOpen}
            currentUserId={currentUserId}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
            currentUserAvatarUrl={currentUserAvatarUrl}
            creditBalance={creditBalance}
            fallbackUserLabel={t.account}
            signOutLabel={t.signOut}
            items={items}
            onOpenLogin={onOpenLogin}
            onSignOut={onSignOut ? () => { desktop?.setSettingsSection?.(null); onSignOut(); } : undefined}
        />
        {desktop && desktopSettings ? <DesktopAccountSettingsPage lang={lang} data={desktopSettings} /> : null}
        </>
    );
}
