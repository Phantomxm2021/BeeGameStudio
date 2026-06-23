import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { translations, type Language } from './AgentsConfig';

interface TopBarProps {
    projectName: string;
    lang: Language;
    status: 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
    progress: number;
    tokens: number;
    isSyncing: boolean;
    onRename: (newName: string) => void;
    mode?: 'demiurge' | 'beegame';
    phaseLabel?: string;
}


export function TopBar({ projectName, lang, status, progress, tokens, isSyncing, onRename, mode = 'demiurge', phaseLabel }: TopBarProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempName, setTempName] = useState(projectName);
    const t = translations[lang];

    useEffect(() => {
        setTempName(projectName);
    }, [projectName]);

    const handleBlur = () => {
        setIsEditing(false);
        if (tempName.trim() && tempName !== projectName) {
            onRename(tempName.trim());
        } else {
            setTempName(projectName);
        }
    };

    const statusColors: Record<string, string> = {
        running: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
        stopped: 'bg-zinc-400',
        idle: 'bg-zinc-400',
        finished: 'bg-emerald-500',
        paused: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]',
        waiting_approval: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
        offline: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
    };

    const getStatusText = () => {
        if (mode === 'beegame') {
            if (status === 'running') return t.active;
            if (status === 'waiting_approval') return t.paused || 'Waiting';
            if (status === 'offline') return t.offline || 'Server Unreachable';
            if (status === 'paused') return 'Paused';
            if (status === 'finished') return 'Turn Complete';
            return t.idle;
        }
        if (status === 'running') return t.active;
        if (status === 'offline') return (t as any).offline || 'Server Unreachable';
        if (status === 'paused') return 'Paused';
        if (status === 'waiting_approval') return 'Approval Req.';
        if (status === 'finished') return 'Completed';
        return t.stopped;
    };


    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-8 left-8 z-40 bg-white/40 dark:bg-zinc-950/40 backdrop-blur-xl border border-zinc-200/50 dark:border-zinc-800/50 p-4 rounded-3xl shadow-lg flex flex-col pointer-events-auto transition-colors duration-700"
        >
            <div className="flex items-center space-x-4 mb-3">
                {isEditing ? (
                    <input
                        autoFocus
                        className="text-4xl font-black tracking-tighter uppercase bg-transparent border-b-2 border-zinc-900 dark:border-zinc-100 outline-none text-zinc-900 dark:text-zinc-100 w-auto min-w-[200px]"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
                    />
                ) : (
                    <h1
                        onDoubleClick={() => setIsEditing(true)}
                        className="text-4xl font-black tracking-tighter opacity-70 dark:opacity-80 uppercase text-zinc-900 dark:text-zinc-100 cursor-text hover:opacity-100 transition-opacity"
                    >
                        {projectName}
                    </h1>
                )}

                <div className="flex items-center space-x-2 px-3 py-1 bg-zinc-100/80 dark:bg-zinc-800/80 rounded-full shadow-inner">
                    <div className={`w-2 h-2 rounded-full ${statusColors[status] || statusColors.idle} ${status === 'running' || status === 'offline' ? 'animate-pulse' : ''}`} />
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600 dark:text-zinc-300">
                        {getStatusText()}
                    </span>
                </div>

                {isSyncing && (
                    <div className="flex items-center space-x-1 px-2 py-0.5 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-md border border-zinc-200/50 dark:border-zinc-700/50 animate-pulse">
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                            Syncing...
                        </span>
                    </div>
                )}
            </div>

            <div className="flex items-center space-x-8 px-1">
                <div className="flex flex-col">
                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-0.5">
                        {mode === 'beegame' ? (t.phase || 'Phase') : t.progress}
                    </span>
                    <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        {mode === 'beegame'
                            ? `${phaseLabel || status.toUpperCase().replace('_', ' ')} · ${Math.floor(progress)}%`
                            : `${Math.floor(progress)}%`}
                    </span>
                </div>

                <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800" />

                <div className="flex flex-col">
                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-0.5">
                        {t.tokens}
                    </span>
                    <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        {tokens.toLocaleString()}
                    </span>
                </div>
            </div>
        </motion.div>
    );
}
