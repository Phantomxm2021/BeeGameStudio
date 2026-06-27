import { motion } from 'framer-motion';
import { History, LogOut, Settings } from 'lucide-react';
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
    onSignOut,
}: LandingActionsProps) {
    const t = translations[lang];

    return (
        <motion.div
            animate={{ opacity: isTransitioning ? 0 : 1, y: isTransitioning ? -8 : 0 }}
            className="absolute right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-8"
        >
            <motion.button
                type="button"
                aria-label={t.settings}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onToggleSettings}
                className={`flex h-11 w-11 items-center justify-center rounded-full border border-transparent bg-transparent text-zinc-500 transition-colors hover:border-zinc-200 hover:bg-white/35 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:text-zinc-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/30 ${isSettingsOpen ? 'text-zinc-950 dark:text-white' : ''
                    }`}
            >
                <Settings className="h-5 w-5" />
            </motion.button>

            <motion.button
                type="button"
                aria-label={t.historyProjects}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onToggleHistory}
                className={`flex h-11 items-center gap-2 rounded-full border border-transparent bg-transparent px-3 text-sm font-semibold tracking-normal text-zinc-500 transition-colors hover:border-zinc-200 hover:bg-white/35 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:text-zinc-300 dark:hover:border-white/10 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/30 sm:px-4 ${isHistoryOpen ? 'text-zinc-950 dark:text-white' : ''
                    }`}
            >
                <History className="h-5 w-5" />
                <span>{t.historyProjects}</span>
            </motion.button>

            {currentUserId ? (
                <div className="flex h-11 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 text-xs font-semibold text-zinc-200 shadow-sm backdrop-blur-xl">
                    <span className="max-w-32 truncate">{currentUserId}</span>
                    {typeof creditBalance === 'number' ? (
                        <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-emerald-200">
                            {creditBalance} credits
                        </span>
                    ) : null}
                    {onSignOut ? (
                        <button
                            type="button"
                            aria-label="退出登录"
                            onClick={onSignOut}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    ) : null}
                </div>
            ) : null}
        </motion.div>
    );
}
