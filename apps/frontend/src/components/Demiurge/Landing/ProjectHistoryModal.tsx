import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, MoreHorizontal, Trash2, X } from 'lucide-react';
import { translations, type Language } from '../AgentsConfig';
import { getBeeGameText } from '../BeeGameI18n';
import { useProjectStore } from '../../../store/projectStore';
import { useSystemStore } from '../../../store/systemStore';
import { getCreditSummary, type BeeGameCreditSummary } from '../../../services/creditsApi';

interface ProjectHistoryModalProps {
    isOpen: boolean;
    lang: Language;
    onClose: () => void;
    onSelectProject: (id: string) => void;
}

const formatProjectDate = (createdAt: number | string) => {
    const timestamp = typeof createdAt === 'string' ? Date.parse(createdAt) : createdAt;
    const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
    return date.toLocaleDateString();
};

const MENU_WIDTH = 150;
const MENU_MARGIN = 12;
const MENU_OFFSET = 8;

export function ProjectHistoryModal({ isOpen, lang, onClose, onSelectProject }: ProjectHistoryModalProps) {
    const { projects, deleteProject } = useProjectStore();
    const canDeleteProject = useSystemStore(state => state.hasPermission('project.delete'));
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
    const [creditSummaries, setCreditSummaries] = useState<Record<string, BeeGameCreditSummary>>({});
    const t = translations[lang];
    const text = getBeeGameText(lang);

    const closeMenu = () => {
        setActiveMenuId(null);
        setMenuPosition(null);
        setConfirmingDeleteId(null);
    };

    const handleDelete = async (event: React.MouseEvent, id: string) => {
        event.stopPropagation();
        if (confirmingDeleteId === id) {
            await deleteProject(id);
            closeMenu();
            return;
        }
        setConfirmingDeleteId(id);
    };

    const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
        event.stopPropagation();
        if (activeMenuId === id) {
            closeMenu();
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const maxLeft = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
        setMenuPosition({
            left: Math.max(MENU_MARGIN, Math.min(maxLeft, rect.right - MENU_WIDTH)),
            top: rect.bottom + MENU_OFFSET,
        });
        setConfirmingDeleteId(null);
        setActiveMenuId(id);
    };

    const activeProject = activeMenuId
        ? projects.find(project => project.id === activeMenuId)
        : undefined;

    useEffect(() => {
        if (!isOpen || projects.length === 0) {
            setCreditSummaries({});
            return;
        }
        let cancelled = false;
        void Promise.all(projects.map(async project => {
            try {
                const summary = await getCreditSummary(project.id);
                return [project.id, summary] as const;
            } catch {
                return null;
            }
        })).then(entries => {
            if (cancelled) return;
            setCreditSummaries(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, BeeGameCreditSummary]>));
        });
        return () => {
            cancelled = true;
        };
    }, [isOpen, projects]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => {
                            closeMenu();
                            onClose();
                        }}
                        className="fixed inset-0 z-[60] bg-zinc-950/45 backdrop-blur-sm"
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t.historyProjects}
                        initial={{ opacity: 0, y: 18, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 18, scale: 0.96 }}
                        transition={{ duration: 0.24, ease: 'easeOut' }}
                        data-surface="frosted-glass"
                        data-style-source="pixelfork"
                        data-glass-density="reinforced"
                        className="input-surface fixed left-1/2 top-1/2 z-[70] flex max-h-[min(620px,calc(100vh-2rem))] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-white/20 p-5 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
                    >
                        <div className="relative z-10 mb-5 flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-semibold tracking-normal text-white">
                                    {t.historyProjects}
                                </h2>
                                <p className="mt-2 text-sm font-medium text-zinc-400">
                                    {projects.length} {t.recentProjects}
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label={text.close}
                                onClick={() => {
                                    closeMenu();
                                    onClose();
                                }}
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#757575]/10 text-[#c5c1b9] transition-colors hover:bg-[#757575]/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="relative z-10 min-h-48 flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-premium">
                            {projects.length === 0 ? (
                                <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/15 bg-white/[0.03] text-zinc-400">
                                    <Clock className="h-8 w-8 stroke-1" />
                                    <span className="text-xs font-bold uppercase tracking-widest">{text.noProjectsFound}</span>
                                </div>
                            ) : (
                                projects.map((project) => (
                                    <div key={project.id} className="relative">
                                        <motion.div
                                            role="button"
                                            tabIndex={0}
                                            whileHover={{ x: 3 }}
                                            onClick={() => onSelectProject(project.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    onSelectProject(project.id);
                                                }
                                            }}
                                            className="flex w-full cursor-pointer items-center justify-between rounded-3xl border border-white/10 bg-white/[0.045] p-4 text-left outline-none transition-all hover:border-white/20 hover:bg-white/[0.075] focus-visible:ring-2 focus-visible:ring-white/35"
                                        >
                                            <div className="min-w-0 pr-4">
                                                <span className="block truncate text-base font-semibold text-white">
                                                    {project.name || text.untitledProject}
                                                </span>
                                                <span className="mt-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
                                                    <Clock className="h-3 w-3" />
                                                    {formatProjectDate(project.created_at)}
                                                </span>
                                                {creditSummaries[project.id] ? (
                                                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-amber-200">
                                                        <span>{creditSummaries[project.id].settledCredits.toLocaleString()} credits</span>
                                                        {creditSummaries[project.id].outstandingReservedCredits > 0 ? (
                                                            <span className="text-zinc-500">
                                                                {creditSummaries[project.id].outstandingReservedCredits.toLocaleString()} reserved
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`${text.moreActionsFor} ${project.name || text.untitledProject}`}
                                                onClick={(event) => toggleMenu(event, project.id)}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                                            >
                                                <MoreHorizontal className="h-4 w-4" />
                                            </button>
                                        </motion.div>
                                    </div>
                                ))
                            )}
                        </div>
                    </motion.div>
                    {activeProject && menuPosition
                        ? createPortal(
                            <AnimatePresence>
                                <motion.div
                                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                                    style={{ left: menuPosition.left, top: menuPosition.top }}
                                    data-surface="frosted-glass"
                                    className="input-surface fixed z-[90] min-w-[150px] overflow-hidden rounded-3xl border border-white/15 p-1.5 text-zinc-100 shadow-xl"
                                >
                                    {canDeleteProject ? (
                                        <button
                                            type="button"
                                            onClick={(event) => handleDelete(event, activeProject.id)}
                                            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-xs font-bold transition-colors ${confirmingDeleteId === activeProject.id
                                                ? 'bg-rose-500 text-white'
                                                : 'text-zinc-300 hover:bg-rose-500/10 hover:text-rose-200'
                                                }`}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            {confirmingDeleteId === activeProject.id ? text.confirmDelete : text.deleteProject}
                                        </button>
                                    ) : null}
                                </motion.div>
                            </AnimatePresence>,
                            document.body,
                        )
                        : null}
                </>
            )}
        </AnimatePresence>
    );
}
