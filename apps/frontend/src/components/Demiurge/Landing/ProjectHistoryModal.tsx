import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { useProjectStore } from '../../../store/projectStore';
import { getCreditSummary, type BeeGameCreditSummary } from '../../../services/creditsApi';
import { Skeleton } from '../../ui/skeleton';

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

const getPathFolderName = (path?: string): string => {
    const normalized = String(path || '').replaceAll('\\', '/').replace(/\/+$/, '');
    return normalized.split('/').filter(Boolean).at(-1) || '';
};

const getProjectDisplayName = (project: { name?: string; root_path?: string }, fallback: string): string => (
    getPathFolderName(project.root_path) || project.name || fallback
);

const MENU_WIDTH = 150;
const MENU_MARGIN = 12;
const MENU_OFFSET = 8;

export function ProjectHistoryModal({ isOpen, lang, onClose, onSelectProject }: ProjectHistoryModalProps) {
    const { projects, isLoading, deleteProject } = useProjectStore();
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
    const [creditSummaries, setCreditSummaries] = useState<Record<string, BeeGameCreditSummary>>({});
    const t = useCommonText(lang);
    const text = useBeeGameText(lang);

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
    const isProjectListLoading = isLoading && projects.length === 0;

    useEffect(() => {
        if (!isOpen || !activeMenuId) return undefined;

        const handlePointerDown = () => closeMenu();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeMenuId, isOpen]);

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

    if (!isOpen) return null;

    return (
                <>
                    <div
                        onClick={() => {
                            closeMenu();
                            onClose();
                        }}
                        className="fixed inset-0 z-[60] bg-zinc-950/45 backdrop-blur-sm"
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={t.historyProjects}
                        data-surface="frosted-glass"
                        data-style-source="pixelfork"
                        data-glass-density="reinforced"
                        className="input-surface glass-panel fixed left-1/2 top-1/2 z-[70] flex max-h-[min(620px,calc(100vh-2rem))] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[32px] p-5 text-zinc-100"
                    >
                        <div className="relative z-10 mb-5 flex items-center justify-between">
                            <div>
                                <h2 className="type-title-3 text-white">
                                    {t.historyProjects}
                                </h2>
                                <div className="type-footnote mt-2 text-zinc-400">
                                    {isProjectListLoading ? (
                                        <Skeleton className="h-4 w-24 rounded-full bg-white/10" aria-hidden="true" />
                                    ) : (
                                        <>{projects.length} {t.recentProjects}</>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label={text.close}
                                onClick={() => {
                                    closeMenu();
                                    onClose();
                                }}
	                                className="glass-icon-button flex h-10 w-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="relative z-10 min-h-48 flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-premium">
                            {isProjectListLoading ? (
                                <ProjectHistoryListSkeleton />
                            ) : projects.length === 0 ? (
                                <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/15 bg-white/[0.03] px-8 text-center text-zinc-400">
                                    <Clock className="h-8 w-8 stroke-1" />
                                    <span className="type-callout text-zinc-200">{text.noProjectsForAccount}</span>
                                    <span className="type-footnote max-w-sm text-zinc-500">{text.localProjectsNeedMigration}</span>
                                </div>
                            ) : (
                                projects.map((project) => {
                                    const displayName = getProjectDisplayName(project, text.untitledProject);
                                    const creditSummary = creditSummaries[project.id];
                                    return (
                                    <div key={project.id} className="relative">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => onSelectProject(project.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    onSelectProject(project.id);
                                                }
                                            }}
                                            className="flex w-full cursor-pointer items-center justify-between rounded-3xl border border-white/10 bg-white/[0.045] p-4 text-left outline-none transition-all hover:translate-x-1 hover:border-white/20 hover:bg-white/[0.075] focus-visible:ring-2 focus-visible:ring-white/35"
                                        >
                                            <div className="min-w-0 pr-4">
                                                <span className="type-callout block truncate text-white">
                                                    {displayName}
                                                </span>
                                                <span className="type-caption-1 mt-2 flex items-center gap-1.5 text-zinc-400">
                                                    <Clock className="h-3 w-3" />
                                                    {formatProjectDate(project.created_at)}
                                                </span>
                                                <span className="type-caption-1 mt-2 flex min-h-[1rem] flex-wrap items-center gap-2 text-zinc-500">
                                                    {creditSummary ? (
                                                        <>
                                                            <span className="text-zinc-300">{creditSummary.settledCredits.toLocaleString()} credits</span>
                                                            {creditSummary.outstandingReservedCredits > 0 ? (
                                                                <span>
                                                                    {creditSummary.outstandingReservedCredits.toLocaleString()} reserved
                                                                </span>
                                                            ) : null}
                                                        </>
                                                    ) : (
                                                        <Skeleton className="h-3 w-32 rounded-full bg-white/10" aria-hidden="true" />
                                                    )}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`${text.moreActionsFor} ${displayName}`}
                                                onClick={(event) => toggleMenu(event, project.id)}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                                            >
                                                <MoreHorizontal className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    {activeProject && menuPosition
                        ? createPortal(
                                <div
                                    style={{ left: menuPosition.left, top: menuPosition.top }}
                                    data-surface="frosted-glass"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    className="input-surface glass-panel fixed z-[90] min-w-[150px] overflow-hidden rounded-3xl p-1.5 text-zinc-100 shadow-xl"
                                >
                                    <button
                                        type="button"
                                        onClick={(event) => handleDelete(event, activeProject.id)}
                                        className={`type-footnote flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${confirmingDeleteId === activeProject.id
                                            ? 'bg-rose-500 text-white'
                                            : 'text-zinc-300 hover:bg-rose-500/10 hover:text-rose-200'
                                            }`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        {confirmingDeleteId === activeProject.id ? text.confirmDelete : text.deleteProject}
                                    </button>
                                </div>,
                            document.body,
                        )
                        : null}
                </>
    );
}

function ProjectHistoryListSkeleton() {
    return (
        <>
            {Array.from({ length: 3 }).map((_, index) => (
                <div
                    key={index}
                    className="flex w-full items-center justify-between rounded-3xl border border-white/10 bg-white/[0.045] p-4"
                    aria-hidden="true"
                >
                    <div className="min-w-0 flex-1 pr-4">
                        <Skeleton className="h-5 w-44 max-w-full rounded-full bg-white/10" />
                        <div className="mt-3 flex items-center gap-2">
                            <Skeleton className="h-3 w-3 rounded-full bg-white/10" />
                            <Skeleton className="h-3 w-24 rounded-full bg-white/10" />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Skeleton className="h-4 w-24 rounded-full bg-white/10" />
                            <Skeleton className="h-4 w-20 rounded-full bg-white/10" />
                        </div>
                    </div>
                    <Skeleton className="h-9 w-9 shrink-0 rounded-full bg-white/10" />
                </div>
            ))}
        </>
    );
}
