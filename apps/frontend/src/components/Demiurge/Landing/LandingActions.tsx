import type { Language } from '../AgentsConfig';
import { AccountActionsMenu } from './AccountActionsMenu';

interface LandingActionsProps {
    lang: Language;
    isTransitioning: boolean;
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

export function LandingActions({
    lang,
    isTransitioning,
    isSettingsOpen,
    isHistoryOpen,
    isProfileOpen,
    isCreditStoreOpen,
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
    return (
        <AccountActionsMenu
            lang={lang}
            className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8"
            isTransitioning={isTransitioning}
            isSettingsOpen={isSettingsOpen}
            isHistoryOpen={isHistoryOpen}
            isProfileOpen={isProfileOpen}
            isCreditStoreOpen={isCreditStoreOpen}
            currentUserId={currentUserId}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
            currentUserAvatarUrl={currentUserAvatarUrl}
            creditBalance={creditBalance}
            onToggleSettings={onToggleSettings}
            onToggleHistory={onToggleHistory}
            onOpenCreditStore={onOpenCreditStore}
            onOpenProfile={onOpenProfile}
            onOpenLogin={onOpenLogin}
            onSignOut={onSignOut}
        />
    );
}
