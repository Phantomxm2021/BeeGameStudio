import { History, Settings, ShoppingCart, UserCircle } from 'lucide-react';
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
    onToggleSettings: () => void;
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
    onToggleHistory,
    onOpenCreditStore,
    onOpenProfile,
    onOpenLogin,
    onSignOut,
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
