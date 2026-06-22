import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Play, Square, Settings, Sun, Moon, PlusCircle, Globe } from 'lucide-react';
import { LANGUAGE_OPTIONS, translations, type Language } from './AgentsConfig';

interface SideMenuProps {
    status: 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';

    lang: Language;
    isDark: boolean;
    onToggleStatus: () => void;
    onSetLang: (lang: Language) => void;
    onToggleTheme: () => void;
    onNewProject: () => void;
    canOpenOperatorControls?: boolean;
    onOpenOperatorControls?: () => void;
}

export function SideMenu({
    status, lang, isDark,
    onToggleStatus, onSetLang, onToggleTheme, onNewProject,
    canOpenOperatorControls = false, onOpenOperatorControls
}: SideMenuProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const t = translations[lang];

    return (
        <div className="absolute bottom-12 left-12 z-50 flex flex-col items-start">
            <AnimatePresence>
                {isMenuOpen && (
                    <>
                        {/* Click-outside backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMenuOpen(false)}
                            className="fixed inset-0 z-[-1] pointer-events-auto"
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 15, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 15, scale: 0.95 }}
                            className="mb-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-zinc-800 rounded-[2.5rem] p-5 shadow-2xl min-w-[220px]"
                        >
                            <div className="space-y-3">
                                {/* Language Selection Dropdown */}
                                <div className="flex flex-col space-y-2 px-3">
                                    <div className="flex items-center space-x-3 text-zinc-400 dark:text-zinc-500 mb-1">
                                        <Globe className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">{t.language}</span>
                                    </div>
                                    <select
                                        value={lang}
                                        onChange={(e) => onSetLang(e.target.value as Language)}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 rounded-xl px-3 py-2 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none appearance-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                                        style={{
                                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='${isDark ? "%23cbd5e1" : "%234b5563"}' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                                            backgroundPosition: 'right 0.75rem center',
                                            backgroundSize: '1rem',
                                            backgroundRepeat: 'no-repeat'
                                        }}
                                    >
                                        {LANGUAGE_OPTIONS.map((option) => (
                                            <option key={option.code} value={option.code}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 mx-2" />

                                {/* Theme Toggle */}
                                <button
                                    onClick={onToggleTheme}
                                    className="w-full flex items-center justify-between px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-2xl transition-colors group"
                                >
                                    <div className="flex items-center space-x-3 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                                        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                                        <span className="text-[10px] font-black uppercase tracking-widest">{t.theme}</span>
                                    </div>
                                    <div className={`w-9 h-5 rounded-full relative transition-colors border ${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-200 border-zinc-300'}`}>
                                        <motion.div animate={{ x: isDark ? 16 : 0 }} className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full shadow-sm ${isDark ? 'bg-zinc-100' : 'bg-white'}`} />
                                    </div>
                                </button>

                                <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 mx-2" />

                                {canOpenOperatorControls ? (
                                    <>
                                        <button
                                            onClick={() => {
                                                setIsMenuOpen(false);
                                                onOpenOperatorControls?.();
                                            }}
                                            className="w-full flex items-center space-x-3 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-2xl transition-colors group"
                                        >
                                            <div className="flex items-center space-x-3 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                                                <FlaskConical className="w-4 h-4" />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Operator Controls</span>
                                            </div>
                                        </button>
                                        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 mx-2" />
                                    </>
                                ) : null}

                                {/* New Project */}
                                <button
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        onNewProject();
                                    }}
                                    className="w-full flex items-center space-x-3 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-2xl transition-colors group"
                                >
                                    <div className="flex items-center space-x-3 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                                        <PlusCircle className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">{t.newProject}</span>
                                    </div>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="flex items-center space-x-4">
                {/* Play/Stop Button */}
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onToggleStatus}
                    className={`w-16 h-16 flex items-center justify-center rounded-full shadow-2xl transition-all duration-500 ${status === 'running'
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800'
                        }`}
                >
                    {status === 'running'
                        ? <Square className="w-6 h-6 fill-current" />
                        : <Play className="w-6 h-6 fill-current ml-1" />
                    }
                </motion.button>


                {/* Menu Toggle Button */}
                <motion.button
                    whileHover={{ scale: 1.05, rotate: 45 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className={`w-12 h-12 flex items-center justify-center rounded-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-xl transition-all ${isMenuOpen ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-600'
                        }`}
                >
                    <Settings className="w-5 h-5" />
                </motion.button>
            </div>
        </div>
    );
}
