import { FolderOpen, History, Settings, ShoppingCart, UserCircle } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useCommonText } from '../../../i18n/useBeeGameTranslations';
import { UserAccountMenu, type UserAccountMenuItem } from './UserAccountMenu';

interface AccountActionsMenuProps {
    lang: Language;
    className?: string;
    isTransitioning?: boolean;
    isSettingsOpen: boolean;
    isHistoryOpen: boolean;
    isProfileOpen?: boolean;
    isCreditStoreOpen?: boolean;
    currentUserId?: string;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    creditBalance?: number;
    canManageResources?: boolean;
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
    currentUserId,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
    creditBalance,
    onToggleSettings,
    onOpenResourceLibrary,
    onToggleHistory,
    onOpenCreditStore,
    onOpenProfile,
    onOpenLogin,
    onSignOut,
    canManageResources = false,
}: AccountActionsMenuProps) {
    const t = useCommonText(lang);
    const items: UserAccountMenuItem[] = [
        {
            key: 'profile',
            label: t.profile,
            icon: <UserCircle className="h-4 w-4" />,
            onClick: onOpenProfile,
        },
        {
            key: 'credit-store',
            label: t.creditStore,
            icon: <ShoppingCart className="h-4 w-4" />,
            onClick: onOpenCreditStore,
        },
        {
            key: 'settings',
            label: t.settings,
            icon: <Settings className="h-4 w-4" />,
            onClick: onToggleSettings,
        },
        ...(canManageResources ? [{
            key: 'resources',
            label: '资源库',
            icon: <FolderOpen className="h-4 w-4" />,
            onClick: onOpenResourceLibrary || onToggleSettings,
        }] : []),
        {
            key: 'history',
            label: t.historyProjects,
            icon: <History className="h-4 w-4" />,
            onClick: onToggleHistory,
        },
    ];

    return (
        <UserAccountMenu
            ariaLabel={t.userMenu}
            className={className}
            isTransitioning={isTransitioning}
            isActive={isSettingsOpen || isHistoryOpen || isProfileOpen || isCreditStoreOpen}
            currentUserId={currentUserId}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
            currentUserAvatarUrl={currentUserAvatarUrl}
            creditBalance={creditBalance}
            fallbackUserLabel={t.account}
            signOutLabel={t.signOut}
            items={items}
            onOpenLogin={onOpenLogin}
            onSignOut={onSignOut}
        />
    );
}
