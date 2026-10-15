import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import { Check, Gamepad2, LoaderCircle, MoreHorizontal, Search, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { useProjectStore } from '../../../store/projectStore';
import { getCreditSummary, type BeeGameUsageSummary } from '../../../services/creditsApi';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../beui/project-button';
import { Input } from '../../beui/registry/components/motion/input';
import { CloseIconButton } from '../../ui/CloseIconButton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';
import { DevProjectPurgePanel } from './DevProjectPurgePanel';
import { getProjectDisplayName } from '../../../utils/projectDisplayName';
import { api } from '../../../services/api';
import { EASE_OUT, EASE_OUT_CSS, SPRING_LAYOUT } from '../../beui/registry/lib/ease';
import { PresenceGate } from '../../beui/registry/lib/presence-gate';

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
  const reduceMotion = useReducedMotion();
  const contentTransition = { duration: reduceMotion ? 0.1 : 0.22, ease: EASE_OUT };
  const layoutTransition = reduceMotion ? { duration: 0 } : SPRING_LAYOUT;
  const windowTransition = {
    transitionProperty: reduceMotion ? 'opacity' : 'opacity, scale, translate',
    transitionDuration: reduceMotion ? '100ms' : isOpen ? '220ms' : '160ms',
    transitionTimingFunction: EASE_OUT_CSS,
  };
  const { projects, isLoading, projectsHasMore, projectsTotal, isLoadingMoreProjects, deleteProject, deleteProjects, loadProjects, loadMoreProjects } = useProjectStore(
    useShallow(state => ({
      projects: state.projects,
      isLoading: state.isLoading,
      projectsHasMore: state.projectsHasMore,
      projectsTotal: state.projectsTotal,
      isLoadingMoreProjects: state.isLoadingMoreProjects,
      deleteProject: state.deleteProject,
      deleteProjects: state.deleteProjects,
      loadProjects: state.loadProjects,
      loadMoreProjects: state.loadMoreProjects,
    })),
  );
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBatchDelete, setConfirmingBatchDelete] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; failed: number } | null>(null);
  const batchDeleteRef = useRef(false);
  const [creditSummaries, setCreditSummaries] = useState<Record<string, BeeGameUsageSummary>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<typeof projects>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchRetryVersion, setSearchRetryVersion] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const searchRequestRef = useRef(false);
  const searchQueryRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const creditSummariesRef = useRef<Record<string, BeeGameUsageSummary>>({});
  const creditSummaryLoadedAtRef = useRef<Record<string, number>>({});
  const t = useCommonText(lang);
  const text = useBeeGameText(lang);
  const hasSearch = Boolean(searchQuery.trim());
  const visibleProjects = useMemo(() => hasSearch ? searchResults : projects, [hasSearch, searchResults, projects]);
  const allLoadedSelected = visibleProjects.length > 0 && visibleProjects.every(project => selectedIds.has(project.id));
  const deletionPending = isBatchDeleting || Boolean(deletingProjectId);

  useEffect(() => {
    // Keep the outgoing contents intact. Reset only on the next opening,
    // including when an in-progress close is immediately reversed.
    if (isOpen) {
      setIsEditing(false);
      setSelectedIds(new Set());
      setConfirmingBatchDelete(false);
      setDeleteResult(null);
      setSearchQuery('');
      searchQueryRef.current = '';
      setSearchLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const visibleIds = new Set(visibleProjects.map(project => project.id));
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => visibleIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleProjects]);

  const toggleSelection = (id: string) => {
    if (deletionPending) return;
    setDeleteResult(null);
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEditing = () => {
    if (deletionPending) return;
    closeMenu();
    setIsEditing(value => !value);
    setSelectedIds(new Set());
    setDeleteResult(null);
  };

  const handleBatchDelete = async () => {
    if (batchDeleteRef.current || deletingProjectId || selectedIds.size === 0) return;
    batchDeleteRef.current = true;
    setIsBatchDeleting(true);
    setConfirmingBatchDelete(false);
    setDeleteResult(null);
    const ids = [...selectedIds];
    try {
      const result = await deleteProjects(ids);
      const deleted = new Set(result.deletedIds);
      setSearchResults(items => items.filter(project => !deleted.has(project.id)));
      setSelectedIds(new Set(result.failedIds));
      setDeleteResult({ deleted: result.deletedIds.length, failed: result.failedIds.length });
    } catch (error) {
      console.error('Failed to delete selected projects:', error);
      setDeleteResult({ deleted: 0, failed: ids.length });
    } finally {
      batchDeleteRef.current = false;
      setIsBatchDeleting(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !hasSearch) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.getProjectPage(0, searchQuery.trim()).then(page => {
        if (cancelled) return;
        setSearchResults(page.items);
        setSearchHasMore(page.hasMore);
      }).catch(error => {
        if (!cancelled) {
          console.error('Failed to search projects:', error);
          setLoadFailed(true);
        }
      }).finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasSearch, isOpen, searchQuery, searchRetryVersion]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!isOpen || batchDeleteRef.current) return;
    const list = event.currentTarget;
    if (loadFailed || list.scrollTop + list.clientHeight < list.scrollHeight - 100) return;
    if (!hasSearch) {
      void loadMoreProjects().catch(error => {
        console.error('Failed to load more projects:', error);
        setLoadFailed(true);
      });
      return;
    }
    if (!searchHasMore || searchLoading || searchRequestRef.current) return;
    searchRequestRef.current = true;
    setSearchLoadingMore(true);
    const query = searchQuery.trim();
    void api.getProjectPage(searchResults.length, query).then(page => {
      if (searchQueryRef.current !== query) return;
      setSearchResults(items => [...items, ...page.items]);
      setSearchHasMore(page.hasMore);
    }).catch(error => {
      console.error('Failed to load more search results:', error);
      setLoadFailed(true);
    }).finally(() => {
      searchRequestRef.current = false;
      setSearchLoadingMore(false);
    });
  };

  const retryLoad = () => {
    setLoadFailed(false);
    if (hasSearch) {
      setSearchLoading(true);
      setSearchResults([]);
      setSearchRetryVersion(version => version + 1);
    } else {
      void loadMoreProjects().catch(error => {
        console.error('Failed to load more projects:', error);
        setLoadFailed(true);
      });
    }
  };

  const handleClose = () => {
    if (deletionPending || batchDeleteRef.current) return;
    closeMenu();
    onClose();
  };

  const closeMenu = () => {
    setActiveMenuId(null);
    setMenuPosition(null);
    setConfirmingDeleteId(null);
  };

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (deletionPending || batchDeleteRef.current) return;
    if (confirmingDeleteId === id) {
      // Remove the destructive control before the request starts. This
      // prevents duplicate requests and makes the in-card loader the
      // single, stable indicator of the pending deletion.
      setDeletingProjectId(id);
      closeMenu();
      try {
        await deleteProject(id);
        setSearchResults(items => items.filter(project => project.id !== id));
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

  const activeProject = activeMenuId ? visibleProjects.find(project => project.id === activeMenuId) : undefined;
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
    if (!isOpen || isEditing || visibleProjects.length === 0) return;
    let cancelled = false;
    const now = Date.now();
    const missingProjects = visibleProjects.filter(project => (
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
    const startTimer = window.setTimeout(() => void loadMissingSummaries(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [isOpen, isEditing, visibleProjects]);

  // Dialog owns exit retention; returning null here cuts off its transition.
  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open, details) => {
        if (open) return;
        if (deletionPending || batchDeleteRef.current || confirmingBatchDelete) {
          details.cancel();
        } else if (isEditing && details.reason === 'escape-key') {
          details.cancel();
          toggleEditing();
        } else {
          handleClose();
        }
      }}>
        <DialogContent
          data-testid="project-history-window"
          inert={!isOpen}
          aria-hidden={!isOpen}
          style={windowTransition}
          backdropProps={{ className: 'project-history-backdrop data-[closed]:pointer-events-none', style: windowTransition }}
          className="flex h-[min(680px,calc(100dvh-2rem))] max-h-[min(680px,calc(100dvh-2rem))] max-w-xl flex-col overflow-hidden rounded-2xl p-6 data-[starting-style]:translate-y-[calc(-50%+4px)] data-[ending-style]:translate-y-[calc(-50%+4px)] motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:-translate-y-1/2 motion-reduce:data-[ending-style]:-translate-y-1/2"
          onKeyDown={event => {
            if (!isEditing || deletionPending || confirmingBatchDelete) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement && event.target.type !== 'checkbox')) {
              event.preventDefault();
              setSelectedIds(new Set(visibleProjects.map(project => project.id)));
              setDeleteResult(null);
            }
          }}
        >
        <motion.div
          data-testid="project-history-content"
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={contentTransition}
        >
        <div className="relative z-10 mb-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <DialogTitle className="type-title-3 text-foreground">{t.historyProjects}</DialogTitle>
              <button type="button" onClick={toggleEditing} disabled={deletionPending || isProjectListLoading} aria-pressed={isEditing} className="type-footnote min-h-8 bg-transparent px-1 text-info transition-opacity active:opacity-60 disabled:opacity-40 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring">
                {isEditing ? t.historyDone : t.historyEdit}
              </button>
            </div>
            <DialogDescription className="type-footnote mt-2 text-muted-foreground">
              {isProjectListLoading ? (
                <span className="block h-4 w-24 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              ) : (
                <>
                  {projectsTotal ?? `${projects.length}${projectsHasMore ? '+' : ''}`} {t.historyProjectCountLabel || t.recentProjects}
                </>
              )}
            </DialogDescription>
          </div>
          <CloseIconButton label={text.close} onClick={handleClose} disabled={deletionPending} className="bg-transparent hover:bg-transparent" />
        </div>

        <div className="relative z-10 mb-3 border-b border-border pb-5">
          <Input
            type="search"
            value={searchQuery}
            disabled={deletionPending}
            onChange={value => {
              setSelectedIds(new Set());
              setDeleteResult(null);
              setSearchQuery(value);
              searchQueryRef.current = value.trim();
              setSearchResults([]);
              setSearchHasMore(false);
              setSearchLoading(Boolean(value.trim()));
              setLoadFailed(false);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            leftIcon={<Search aria-hidden="true" />}
            placeholder={t.searchProjects || 'Search projects'}
            aria-label={t.searchProjects || 'Search projects'}
            classNames={{ field: 'bg-muted/40', input: 'text-sm' }}
          />
        </div>

        <div ref={listRef} onScroll={handleScroll} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-premium" data-testid="project-history-list">
          <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={isProjectListLoading || (hasSearch && searchLoading) ? 'loading' : 'results'}
            data-testid="project-history-list-surface"
            className={visibleProjects.length === 0 ? 'h-full' : undefined}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 0, transition: { duration: reduceMotion ? 0 : 0.08 } }}
            transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: EASE_OUT }}
          >
          <PresenceGate>{({ isPresent, gate }) => <div {...gate} aria-hidden={!isPresent} className={visibleProjects.length === 0 ? 'h-full' : undefined}>
          {isProjectListLoading ? (
            <ProjectHistoryListSkeleton />
          ) : projects.length === 0 && !hasSearch ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-8 text-center text-muted-foreground">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/70 text-muted-foreground">
                <Gamepad2 className="h-6 w-6 stroke-[1.5]" />
              </span>
              <span className="type-callout text-foreground">{text.noProjectsForAccount}</span>
              <span className="type-footnote max-w-sm text-muted-foreground">{text.localProjectsNeedMigration}</span>
            </div>
          ) : hasSearch && searchLoading ? (
            <ProjectHistoryListSkeleton />
          ) : loadFailed && visibleProjects.length === 0 ? null : visibleProjects.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t.noMatchingProjects || 'No matching projects'}</div>
          ) : (
            visibleProjects.map((project, index) => {
              const displayName = getProjectDisplayName(project, text.untitledProject);
              const creditSummary = creditSummaries[project.id];
              const isDeleting = deletingProjectId === project.id;
              const isPending = isDeleting;
              const projectDate = formatProjectDate(project.created_at);
              const previousDate = index > 0 ? formatProjectDate(visibleProjects[index - 1].created_at) : null;
              return (
                <div key={project.id} className="relative" aria-busy={isPending || undefined}>
                  {projectDate !== previousDate ? (
                    <div className="px-2 pb-2 pt-3 text-xs font-medium text-muted-foreground">
                      {projectDate}
                    </div>
                  ) : null}
                  <motion.div
                    layout={reduceMotion ? false : 'position'}
                    layoutDependency={isEditing}
                    transition={{ layout: layoutTransition }}
                    role={isEditing ? undefined : 'button'}
                    tabIndex={isEditing ? undefined : 0}
                    onClick={() => {
                      if (deletionPending) return;
                      if (isEditing) toggleSelection(project.id);
                      else onSelectProject(project.id);
                    }}
                    onKeyDown={event => {
                      if (deletionPending || isEditing) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectProject(project.id);
                      }
                    }}
                    className={`relative flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                      deletionPending
                        ? 'cursor-wait opacity-70'
                        : isEditing && selectedIds.has(project.id) ? 'cursor-pointer bg-info/10' : 'cursor-pointer hover:bg-surface-hover'
                    }`}
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                    {isEditing ? (
                      <motion.span
                        key="selection"
                        initial={{ opacity: 0, x: reduceMotion ? 0 : -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: reduceMotion ? 0 : -4 }}
                        transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: EASE_OUT }}
                        className="relative flex size-5 shrink-0 items-center justify-center"
                      >
                      <PresenceGate>{({ isPresent, gate }) => <span {...gate} aria-hidden={!isPresent} className="relative flex size-5 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(project.id)}
                          disabled={deletionPending || !isPresent}
                          aria-label={t.historySelectProject.replace('{{name}}', displayName)}
                          onClick={event => event.stopPropagation()}
                          onChange={() => toggleSelection(project.id)}
                          className="peer size-5 cursor-pointer appearance-none rounded-full border border-muted-foreground/60 bg-transparent transition-colors duration-100 checked:border-info checked:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
                        />
                        <Check aria-hidden="true" className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 transition-opacity duration-100 peer-checked:opacity-100" />
                      </span>}</PresenceGate>
                      </motion.span>
                    ) : null}
                    </AnimatePresence>
                    <motion.span layout={reduceMotion ? false : 'position'} layoutDependency={isEditing} transition={{ layout: layoutTransition }} className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground" aria-hidden="true">
                      <Gamepad2 className="size-5 stroke-[1.6]" />
                    </motion.span>
                    <motion.span layout={reduceMotion ? false : 'position'} layoutDependency={isEditing} transition={{ layout: layoutTransition }} className="type-callout min-w-0 flex-1 truncate text-foreground">{displayName}</motion.span>
                    <AnimatePresence initial={false} mode="popLayout">
                    {!isEditing ? <motion.div key="details" className="shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.08 : 0.12, ease: EASE_OUT }}>
                      <PresenceGate>{({ isPresent, gate }) => <div {...gate} aria-hidden={!isPresent} className="flex items-center gap-3">
                      <span className="type-caption-1 flex min-w-[5.5rem] shrink-0 justify-end text-muted-foreground">
                      {creditSummary ? (
                        <span className="text-foreground">{formatCreditAmount(creditSummary.consumedCredits)} credits</span>
                      ) : (
                        <Skeleton className="h-3 w-20 rounded-full bg-accent" aria-hidden="true" />
                      )}
                    </span>
                    {isPending ? (
                      <span
                        role="status"
                        aria-label={text.deletingProject}
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
                        disabled={isBatchDeleting || !isPresent}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    )}
                      </div>}</PresenceGate>
                    </motion.div> : null}
                    </AnimatePresence>
                  </motion.div>
                </div>
              );
            })
          )}
          </div>}</PresenceGate>
          </motion.div>
          </AnimatePresence>
          {loadFailed ? (
            <div className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground" role="alert">
              <span>{t.projectLoadFailed || 'Could not load projects.'}</span>
              <button type="button" onClick={retryLoad} className="text-foreground underline underline-offset-4">
                {t.retryProjectLoad || 'Retry'}
              </button>
            </div>
          ) : null}
          {(isLoadingMoreProjects || (hasSearch && searchLoadingMore)) ? (
            <div className="flex justify-center py-3" role="status" aria-label={text.loading || 'Loading'}><LoaderCircle className="size-4 animate-spin text-muted-foreground" /></div>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
        {isEditing ? (
          <motion.div
            key="selection-actions"
            data-testid="project-history-selection-actions"
            initial={{ height: reduceMotion ? 'auto' : 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: reduceMotion ? 'auto' : 0, opacity: 0 }}
            transition={{ height: layoutTransition, opacity: { duration: reduceMotion ? 0.08 : 0.16, ease: EASE_OUT } }}
            className="relative z-10 shrink-0 overflow-hidden"
          >
          <PresenceGate>{({ isPresent, gate }) => <div {...gate} aria-hidden={!isPresent} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <button type="button" disabled={deletionPending || !isPresent || visibleProjects.length === 0 || searchLoading} onClick={() => {
              setSelectedIds(allLoadedSelected ? new Set() : new Set(visibleProjects.map(project => project.id)));
              setDeleteResult(null);
            }} className="type-footnote min-h-8 bg-transparent text-info active:opacity-60 disabled:opacity-40">
              {allLoadedSelected ? t.historyDeselectAll : t.historySelectLoaded}
            </button>
            <div className="flex items-center gap-4">
              <span className="type-footnote text-muted-foreground" aria-live="polite">{t.historySelectedCount.replace('{{count}}', String(selectedIds.size))}</span>
              <button type="button" disabled={deletionPending || !isPresent || selectedIds.size === 0} onClick={() => setConfirmingBatchDelete(true)} className="type-footnote min-h-8 bg-transparent text-destructive active:opacity-60 disabled:opacity-40">
                {isBatchDeleting ? <span role="status" className="flex items-center gap-2"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />{t.historyDeleting}</span> : t.historyDelete}
              </button>
            </div>
          </div>}</PresenceGate>
          </motion.div>
        ) : null}
        </AnimatePresence>
        {deleteResult ? <p role={deleteResult.failed ? 'alert' : 'status'} className={`type-footnote relative z-10 mt-3 ${deleteResult.failed ? 'text-destructive' : 'text-muted-foreground'}`}>
          {(deleteResult.failed ? t.historyDeleteFailed : t.historyDeleteSucceeded)
            .replace('{{deleted}}', String(deleteResult.deleted)).replace('{{failed}}', String(deleteResult.failed))}
        </p> : null}
        {import.meta.env.DEV && !isEditing ? <DevProjectPurgePanel lang={lang} onDeleted={loadProjects} /> : null}
        </motion.div>
        </DialogContent>
        <Dialog open={isOpen && confirmingBatchDelete} onOpenChange={setConfirmingBatchDelete}>
          <DialogContent className="max-w-sm rounded-2xl p-6 motion-reduce:duration-100 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100">
            <DialogTitle className="text-center text-base">{(selectedIds.size === 1 ? t.historyDeleteTitleSingle : t.historyDeleteTitle).replace('{{count}}', String(selectedIds.size))}</DialogTitle>
            <DialogDescription className="mt-2 text-center">{t.historyDeleteSubtitle}</DialogDescription>
            <div className="mt-6 flex gap-3">
              <Button type="button" variant="outline" className="h-10 flex-1 rounded-full" onClick={() => setConfirmingBatchDelete(false)}>{t.historyCancel}</Button>
              <Button type="button" variant="outline" className="h-10 flex-1 rounded-full text-destructive hover:text-destructive" disabled={selectedIds.size === 0 || isBatchDeleting} onClick={() => void handleBatchDelete()}>{t.historyDelete}</Button>
            </div>
          </DialogContent>
        </Dialog>
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
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5"
          aria-hidden="true"
        >
          <Skeleton className="size-10 shrink-0 rounded-xl bg-accent" />
          <Skeleton className="h-4 w-44 max-w-full flex-1 rounded-full bg-accent" />
          <Skeleton className="h-3 w-16 rounded-full bg-accent" />
          <Skeleton className="size-8 shrink-0 rounded-full bg-accent" />
        </div>
      ))}
    </>
  );
}
