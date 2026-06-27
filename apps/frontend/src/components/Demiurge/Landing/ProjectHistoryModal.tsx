import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, MoreHorizontal, Trash2, X } from 'lucide-react';
import { translations, type Language } from '../AgentsConfig';
import { getBeeGameText } from '../BeeGameI18n';
import { useProjectStore } from '../../../store/projectStore';
import { useSystemStore } from '../../../store/systemStore';

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
                        className="fixed left-1/2 top-1/2 z-[70] flex max-h-[min(620px,calc(100vh-2rem))] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-[0_32px_120px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-950/90"
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold tracking-normal text-zinc-950 dark:text-white">
                                    {t.historyProjects}
                                </h2>
                                <p className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
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
                                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/30"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="min-h-48 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-premium">
                            {projects.length === 0 ? (
                                <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-zinc-200 text-zinc-400 dark:border-white/10 dark:text-zinc-500">
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
                                            className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-transparent bg-white/60 p-4 text-left outline-none transition-all hover:border-zinc-200 hover:bg-white focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:bg-white/5 dark:hover:border-white/10 dark:hover:bg-white/10 dark:focus-visible:ring-white/30"
                                        >
                                            <div className="min-w-0 pr-4">
                                                <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-white">
                                                    {project.name || text.untitledProject}
                                                </span>
                                                <span className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                                                    <Clock className="h-3 w-3" />
                                                    {formatProjectDate(project.created_at)}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`${text.moreActionsFor} ${project.name || text.untitledProject}`}
                                                onClick={(event) => toggleMenu(event, project.id)}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/30"
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
                                    className="fixed z-[90] min-w-[150px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900"
                                >
                                    {canDeleteProject ? (
                                        <button
                                            type="button"
                                            onClick={(event) => handleDelete(event, activeProject.id)}
                                            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-xs font-bold transition-colors ${confirmingDeleteId === activeProject.id
                                                ? 'bg-rose-500 text-white'
                                                : 'text-zinc-600 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-300 dark:hover:bg-rose-950/30 dark:hover:text-rose-300'
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
