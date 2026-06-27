import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { History, LogOut, Settings, User, UserCircle } from 'lucide-react';
import { translations, type Language } from '../AgentsConfig';

interface LandingActionsProps {
    lang: Language;
    isTransitioning: boolean;
    isSettingsOpen: boolean;
    isHistoryOpen: boolean;
    currentUserId?: string;
    currentUserDisplayName?: string;
    currentUserAvatarUrl?: string;
    creditBalance?: number;
    onToggleSettings: () => void;
    onToggleHistory: () => void;
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
    currentUserAvatarUrl,
    creditBalance,
    onToggleSettings,
    onToggleHistory,
    onOpenProfile,
    onOpenLogin,
    onSignOut,
}: LandingActionsProps) {
    const t = translations[lang];
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const userMenuLabel = lang === 'en' ? 'User menu' : '用户菜单';
    const signOutLabel = lang === 'en' ? 'Sign out' : '退出登录';
    const loginLabel = lang === 'en' ? 'Sign in / Register' : '登录 / 注册';
    const profileLabel = lang === 'en' ? 'Profile' : '个人主页';
    const userLabel = currentUserDisplayName || currentUserId;
    const userInitial = getUserInitial(userLabel);

    useEffect(() => {
        if (!isUserMenuOpen) return undefined;
        const handlePointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsUserMenuOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isUserMenuOpen]);

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

    const handleOpenProfile = () => {
        setIsUserMenuOpen(false);
        onOpenProfile();
    };

    const handleSignOut = () => {
        setIsUserMenuOpen(false);
        onSignOut?.();
    };

    return (
        <motion.div
            ref={containerRef}
            animate={{ opacity: isTransitioning ? 0 : 1, y: isTransitioning ? -8 : 0 }}
            className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8"
        >
            <motion.button
                type="button"
                aria-label={userMenuLabel}
                aria-haspopup="menu"
                aria-expanded={currentUserId ? isUserMenuOpen : undefined}
                data-avatar-surface="outline"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleUserButtonClick}
                className={`flex h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_14px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-colors hover:border-amber-300/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${isSettingsOpen || isHistoryOpen || isUserMenuOpen ? 'border-amber-300/50 bg-white/5' : ''
                    }`}
            >
                {currentUserId ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white">
                        {currentUserAvatarUrl ? (
                            <img
                                src={currentUserAvatarUrl}
                                alt=""
                                className="h-8 w-8 rounded-full object-cover"
                            />
                        ) : userInitial}
                    </span>
                ) : (
                    <User className="h-6 w-6" />
                )}
            </motion.button>

            {currentUserId && isUserMenuOpen ? (
                <div
                    role="menu"
                    aria-label={userMenuLabel}
                    data-surface="frosted-glass"
                    data-style-source="pixelfork"
                    className="input-surface absolute right-0 top-14 w-64 overflow-hidden rounded-[28px] border border-white/20 p-2 text-zinc-100 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
                >
                    <div className="px-3 py-3">
                        <div className="truncate text-sm font-semibold text-white">{userLabel}</div>
                        {typeof creditBalance === 'number' ? (
                            <div className="mt-1 text-xs font-semibold text-emerald-200">{creditBalance} credits</div>
                        ) : null}
                    </div>
                    <div className="my-1 h-px bg-white/10" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleOpenProfile}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white"
                    >
                        <UserCircle className="h-4 w-4" />
                        <span>{profileLabel}</span>
                    </button>
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
