import { History, Settings, ShoppingCart, UserCircle } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useCommonText } from '../../../i18n/useBeeGameTranslations';
import { UserAccountMenu, type UserAccountMenuItem } from './UserAccountMenu';

interface LandingActionsProps {
    lang: Language;
    isTransitioning: boolean;
    isSettingsOpen: boolean;
    isHistoryOpen: boolean;
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

export function LandingActions({
    lang,
    isTransitioning,
    isSettingsOpen,
    isHistoryOpen,
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
}: LandingActionsProps) {
    const t = useCommonText(lang);
    const userMenuLabel = t.userMenu;
    const signOutLabel = t.signOut;
    const profileLabel = t.profile;
    const fallbackUserLabel = t.account;
    const items: UserAccountMenuItem[] = [
        {
            key: 'profile',
            label: profileLabel,
            icon: <UserCircle className="h-4 w-4" />,
            onClick: onOpenProfile,
        },
        {
            key: 'credit-store',
            label: 'Credit Store',
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
            ariaLabel={userMenuLabel}
            className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8"
            isTransitioning={isTransitioning}
            isActive={isSettingsOpen || isHistoryOpen}
            currentUserId={currentUserId}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
            currentUserAvatarUrl={currentUserAvatarUrl}
            creditBalance={creditBalance}
            fallbackUserLabel={fallbackUserLabel}
            signOutLabel={signOutLabel}
            items={items}
            onOpenLogin={onOpenLogin}
            onSignOut={onSignOut}
        />
    );
}
