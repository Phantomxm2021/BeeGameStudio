import { useState } from 'react';
import { motion } from 'framer-motion';
import { History, LogOut, Settings, UserCircle } from 'lucide-react';
import { translations, type Language } from '../AgentsConfig';

interface LandingActionsProps {
    lang: Language;
    isTransitioning: boolean;
    isSettingsOpen: boolean;
    isHistoryOpen: boolean;
    currentUserId?: string;
    creditBalance?: number;
    onToggleSettings: () => void;
    onToggleHistory: () => void;
    onOpenLogin: () => void;
    onSignOut?: () => void;
}

export function LandingActions({
    lang,
    isTransitioning,
    isSettingsOpen,
    isHistoryOpen,
    currentUserId,
    creditBalance,
    onToggleSettings,
    onToggleHistory,
    onOpenLogin,
    onSignOut,
}: LandingActionsProps) {
    const t = translations[lang];
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const userMenuLabel = lang === 'en' ? 'User menu' : '用户菜单';
    const signOutLabel = lang === 'en' ? 'Sign out' : '退出登录';
    const loginLabel = lang === 'en' ? 'Sign in / Register' : '登录 / 注册';
    const userInitial = getUserInitial(currentUserId);

    const handleUserButtonClick = () => {
        if (!currentUserId) {
            onOpenLogin();
            return;
        }
        setIsUserMenuOpen((value) => !value);
    };

    const handleToggleSettings = () => {
        setIsUserMenuOpen(false);
        onToggleSettings();
    };

    const handleToggleHistory = () => {
        setIsUserMenuOpen(false);
        onToggleHistory();
    };

    const handleSignOut = () => {
        setIsUserMenuOpen(false);
        onSignOut?.();
    };

    return (
        <motion.div
            animate={{ opacity: isTransitioning ? 0 : 1, y: isTransitioning ? -8 : 0 }}
            className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8"
        >
            <motion.button
                type="button"
                aria-label={userMenuLabel}
                aria-haspopup="menu"
                aria-expanded={currentUserId ? isUserMenuOpen : undefined}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleUserButtonClick}
                className={`flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/20 text-zinc-200 shadow-sm backdrop-blur-xl transition-colors hover:border-amber-300/40 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${isSettingsOpen || isHistoryOpen || isUserMenuOpen ? 'border-amber-300/40 text-white' : ''
                    }`}
            >
                {currentUserId ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-300 text-sm font-black text-zinc-950">
                        {userInitial}
                    </span>
                ) : (
                    <UserCircle className="h-6 w-6" />
                )}
            </motion.button>

            {currentUserId && isUserMenuOpen ? (
                <div
                    role="menu"
                    aria-label={userMenuLabel}
                    className="absolute right-0 top-14 w-64 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/90 p-2 text-zinc-100 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
                >
                    <div className="px-3 py-3">
                        <div className="truncate text-sm font-semibold text-white">{currentUserId}</div>
                        {typeof creditBalance === 'number' ? (
                            <div className="mt-1 text-xs font-semibold text-emerald-200">{creditBalance} credits</div>
                        ) : null}
                    </div>
                    <div className="my-1 h-px bg-white/10" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleToggleSettings}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    >
                        <Settings className="h-4 w-4" />
                        <span>{t.settings}</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleToggleHistory}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    >
                        <History className="h-4 w-4" />
                        <span>{t.historyProjects}</span>
                    </button>
                    <div className="my-1 h-px bg-white/10" />
                    {onSignOut ? (
                        <button
                            type="button"
                            role="menuitem"
                            onClick={handleSignOut}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
                        >
                            <LogOut className="h-4 w-4" />
                            <span>{signOutLabel}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            role="menuitem"
                            onClick={onOpenLogin}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
                        >
                            <UserCircle className="h-4 w-4" />
                            <span>{loginLabel}</span>
                        </button>
                    )}
                </div>
            ) : null}
        </motion.div>
    );
}

const getUserInitial = (userId?: string): string => {
    const first = Array.from(userId?.trim() || 'U')[0] || 'U';
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
