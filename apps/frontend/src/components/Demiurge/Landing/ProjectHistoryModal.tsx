import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, CopyPlus, LoaderCircle, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { useProjectStore } from '../../../store/projectStore';
import { getCreditSummary, type BeeGameUsageSummary } from '../../../services/creditsApi';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../beui/project-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';
import { DevProjectPurgePanel } from './DevProjectPurgePanel';
import { getProjectDisplayName } from '../../../utils/projectDisplayName';

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
const CREDIT_SUMMARY_BATCH_SIZE = 4;
const CREDIT_SUMMARY_CACHE_MS = 30_000;

export function ProjectHistoryModal({ isOpen, lang, onClose, onSelectProject }: ProjectHistoryModalProps) {
  const { projects, isLoading, deleteProject, createReviewCopy, loadProjects } = useProjectStore(
    useShallow(state => ({
      projects: state.projects,
      isLoading: state.isLoading,
      deleteProject: state.deleteProject,
      createReviewCopy: state.createReviewCopy,
      loadProjects: state.loadProjects,
    })),
  );
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [creatingReviewCopyId, setCreatingReviewCopyId] = useState<string | null>(null);
  const [creditSummaries, setCreditSummaries] = useState<Record<string, BeeGameUsageSummary>>({});
  const creditSummariesRef = useRef<Record<string, BeeGameUsageSummary>>({});
  const creditSummaryLoadedAtRef = useRef<Record<string, number>>({});
  const t = useCommonText(lang);
  const text = useBeeGameText(lang);

  const closeMenu = () => {
    setActiveMenuId(null);
    setMenuPosition(null);
    setConfirmingDeleteId(null);
  };

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (deletingProjectId) return;
    if (confirmingDeleteId === id) {
      // Remove the destructive control before the request starts. This
      // prevents duplicate requests and makes the in-card loader the
      // single, stable indicator of the pending deletion.
      setDeletingProjectId(id);
      closeMenu();
      try {
        await deleteProject(id);
      } catch {
        // The store retains the project for a failed remote delete.
        // Restore its actions so the user can retry.
      } finally {
        setDeletingProjectId(current => (current === id ? null : current));
      }
      return;
    }
    setConfirmingDeleteId(id);
  };

  const handleCreateReviewCopy = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (creatingReviewCopyId || deletingProjectId) return;
    setCreatingReviewCopyId(id);
    closeMenu();
    try {
      const project = await createReviewCopy(id);
      onSelectProject(project.id);
      onClose();
    } catch {
      // The source row remains available; the shared API error toast retains
      // the backend's original failure reason.
    } finally {
      setCreatingReviewCopyId(current => (current === id ? null : current));
    }
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

  const activeProject = activeMenuId ? projects.find(project => project.id === activeMenuId) : undefined;
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
    if (!isOpen || projects.length === 0) return;
    let cancelled = false;
    let startTimer: number | undefined;
    const now = Date.now();
    const missingProjects = projects.filter(project => (
      !creditSummariesRef.current[project.id] ||
      now - (creditSummaryLoadedAtRef.current[project.id] || 0) >= CREDIT_SUMMARY_CACHE_MS
    ));

    const loadMissingSummaries = async () => {
      for (let index = 0; index < missingProjects.length && !cancelled; index += CREDIT_SUMMARY_BATCH_SIZE) {
        const batch = missingProjects.slice(index, index + CREDIT_SUMMARY_BATCH_SIZE);
        const entries = await Promise.all(batch.map(async project => {
          try {
            const summary = await getCreditSummary(project.id);
            return [project.id, summary] as const;
          } catch {
            return null;
          }
        }));
        if (cancelled) return;
        const loaded = entries.filter(Boolean) as Array<readonly [string, BeeGameUsageSummary]>;
        if (loaded.length > 0) {
          const next = { ...creditSummariesRef.current, ...Object.fromEntries(loaded) };
          const loadedAt = Date.now();
          for (const [projectId] of loaded) creditSummaryLoadedAtRef.current[projectId] = loadedAt;
          creditSummariesRef.current = next;
          setCreditSummaries(next);
        }
      }
    };

    // Let the dialog commit and paint before starting secondary per-project
    // usage requests. Loading in small batches avoids an N-request burst.
    startTimer = window.setTimeout(() => void loadMissingSummaries(), 0);
    return () => {
      cancelled = true;
      if (startTimer !== undefined) window.clearTimeout(startTimer);
    };
  }, [isOpen, projects]);

  if (!isOpen) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { closeMenu(); onClose(); } }}>
        <DialogContent className="flex h-[min(620px,calc(100dvh-2rem))] max-h-[min(620px,calc(100dvh-2rem))] max-w-xl flex-col overflow-hidden p-5">
        <div className="relative z-10 mb-5 flex items-center justify-between">
          <div>
            <DialogTitle className="type-title-3 text-foreground">{t.historyProjects}</DialogTitle>
            <DialogDescription className="type-footnote mt-2 text-muted-foreground">
              {isProjectListLoading ? (
                <span className="block h-4 w-24 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              ) : (
                <>
                  {projects.length} {t.recentProjects}
                </>
              )}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={text.close}
            onClick={() => {
              closeMenu();
              onClose();
            }}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pt-3 scrollbar-premium">
          {isProjectListLoading ? (
            <ProjectHistoryListSkeleton />
          ) : projects.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-8 text-center text-muted-foreground">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/70 text-muted-foreground">
                <Clock className="h-6 w-6 stroke-[1.5]" />
              </span>
              <span className="type-callout text-foreground">{text.noProjectsForAccount}</span>
              <span className="type-footnote max-w-sm text-muted-foreground">{text.localProjectsNeedMigration}</span>
            </div>
          ) : (
            projects.map(project => {
              const displayName = getProjectDisplayName(project, text.untitledProject);
              const creditSummary = creditSummaries[project.id];
              const isDeleting = deletingProjectId === project.id;
              const isCreatingReviewCopy = creatingReviewCopyId === project.id;
              const isPending = isDeleting || isCreatingReviewCopy;
              return (
                <div key={project.id} className="relative" aria-busy={isPending || undefined}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!isPending) onSelectProject(project.id);
                    }}
                    onKeyDown={event => {
                      if (isPending) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectProject(project.id);
                      }
                    }}
                    className={`flex w-full items-center justify-between rounded-lg border border-border bg-muted/40 p-4 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring ${
                      isPending
                        ? 'cursor-wait opacity-70'
                        : 'cursor-pointer hover:translate-x-1 hover:border-border-strong hover:bg-surface-hover'
                    }`}
                  >
                    <div className="min-w-0 pr-4">
                      <span className="type-callout block truncate text-foreground">{displayName}</span>
                      <span className="type-caption-1 mt-2 flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatProjectDate(project.created_at)}
                      </span>
                      <span className="type-caption-1 mt-2 flex min-h-[1rem] flex-wrap items-center gap-2 text-muted-foreground">
                        {creditSummary ? (
                          <>
                            <span className="text-foreground">
                              {formatCreditAmount(creditSummary.consumedCredits)} credits
                            </span>
                          </>
                        ) : (
                          <Skeleton className="h-3 w-32 rounded-full bg-accent" aria-hidden="true" />
                        )}
                      </span>
                    </div>
                    {isPending ? (
                      <span
                        role="status"
                        aria-label={isDeleting ? text.deletingProject : text.creatingReviewCopy}
                        className="flex h-9 w-9 shrink-0 items-center justify-center text-foreground"
                      >
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${text.moreActionsFor} ${displayName}`}
                        onClick={event => toggleMenu(event, project.id)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {import.meta.env.DEV ? <DevProjectPurgePanel lang={lang} onDeleted={loadProjects} /> : null}
        </DialogContent>
      </Dialog>
      {isOpen && activeProject && menuPosition
        ? createPortal(
            <div
              style={{ left: menuPosition.left, top: menuPosition.top }}

              onPointerDown={event => event.stopPropagation()}
              className="bg-background fixed z-[260] min-w-[150px] overflow-hidden rounded-lg p-1.5 text-foreground shadow-lg"
            >
              <button
                type="button"
                onClick={event => handleCreateReviewCopy(event, activeProject.id)}
                className="type-footnote flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CopyPlus className="h-3.5 w-3.5" />
                {text.createReviewCopy}
              </button>
              <button
                type="button"
                onClick={event => handleDelete(event, activeProject.id)}
                className={`type-footnote flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors ${
                  confirmingDeleteId === activeProject.id
                    ? 'bg-rose-500 text-foreground'
                    : 'text-foreground hover:bg-rose-500/10 hover:text-rose-200'
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

function formatCreditAmount(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
}

function ProjectHistoryListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/40 p-4"
          aria-hidden="true"
        >
          <div className="min-w-0 flex-1 pr-4">
            <Skeleton className="h-5 w-44 max-w-full rounded-full bg-accent" />
            <div className="mt-3 flex items-center gap-2">
              <Skeleton className="h-3 w-3 rounded-full bg-accent" />
              <Skeleton className="h-3 w-24 rounded-full bg-accent" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Skeleton className="h-4 w-24 rounded-full bg-accent" />
              <Skeleton className="h-4 w-20 rounded-full bg-accent" />
            </div>
          </div>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full bg-accent" />
        </div>
      ))}
    </>
  );
}
