import { useState } from 'react';
import { Play, Square, Settings, Sun, Moon, PlusCircle, Globe } from 'lucide-react';
import { LANGUAGE_OPTIONS, type Language } from './AgentsConfig';
import { useCommonText } from '../../i18n/useBeeGameTranslations';

interface SideMenuProps {
    status: 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';

    lang: Language;
    isDark: boolean;
    onToggleStatus: () => void;
    onSetLang: (lang: Language) => void;
    onToggleTheme: () => void;
    onNewProject: () => void;
}

export function SideMenu({
    status, lang, isDark,
    onToggleStatus, onSetLang, onToggleTheme, onNewProject,
}: SideMenuProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const t = useCommonText(lang);

    return (
        <div className="absolute bottom-12 left-12 z-50 flex flex-col items-start">
            {isMenuOpen && (
                <>
                    {/* Click-outside backdrop */}
                    <div
                        onClick={() => setIsMenuOpen(false)}
                        className="fixed inset-0 z-[-1] pointer-events-auto"
                    />
                    <div
                            className="mb-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl border border-zinc-200 dark:border-zinc-800 rounded-[2.5rem] p-5 shadow-2xl min-w-[220px]"
                        >
                            <div className="space-y-3">
                                {/* Language Selection Dropdown */}
                                <div className="flex flex-col space-y-2 px-3">
                                    <div className="flex items-center space-x-3 text-zinc-400 dark:text-zinc-500 mb-1">
                                        <Globe className="w-4 h-4" />
                                        <span className="type-caption-1">{t.language}</span>
                                    </div>
                                    <select
                                        value={lang}
                                        onChange={(e) => onSetLang(e.target.value as Language)}
                                        className="type-footnote w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 rounded-xl px-3 py-2 text-zinc-900 dark:text-zinc-100 outline-none appearance-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
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
                                        <span className="type-caption-1">{t.theme}</span>
                                    </div>
                                    <div className={`w-9 h-5 rounded-full relative transition-colors border ${isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-200 border-zinc-300'}`}>
                                        <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full shadow-sm transition-transform ${isDark ? 'translate-x-4 bg-zinc-100' : 'bg-white'}`} />
                                    </div>
                                </button>

                                <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 mx-2" />

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
                                        <span className="type-caption-1">{t.newProject}</span>
                                    </div>
                                </button>
                            </div>
                    </div>
                </>
            )}

            <div className="flex items-center space-x-4">
                {/* Play/Stop Button */}
                <button
                    onClick={onToggleStatus}
                    className={`w-16 h-16 flex items-center justify-center rounded-full shadow-2xl transition-all duration-500 hover:scale-105 active:scale-95 ${status === 'running'
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800'
                        }`}
                >
                    {status === 'running'
                        ? <Square className="w-6 h-6 fill-current" />
                        : <Play className="w-6 h-6 fill-current ml-1" />
                    }
                </button>


                {/* Menu Toggle Button */}
                <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className={`w-12 h-12 flex items-center justify-center rounded-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-xl transition-all hover:scale-105 hover:rotate-45 active:scale-95 ${isMenuOpen ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-600'
                        }`}
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
