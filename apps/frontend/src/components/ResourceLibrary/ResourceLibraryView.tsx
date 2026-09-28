import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, File, Info, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  ResourceLibraryApiError,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackSummary,
  type ResourceProcessingJob,
  type ResourcePublishReadiness,
} from '../../services/resourceLibraryApi';
import { CreateResourcePackDialog } from './CreateResourcePackDialog';
import { EditResourcePackDialog } from './EditResourcePackDialog';
import { RenameResourceDialog } from './RenameResourceDialog';
import { isSupportedModelPreview, ResourcePreview } from './ResourcePreview';
import { ResourcePackExplorer } from './ResourcePackExplorer';
import { CurationWorkbench, type ResourceCurationApi } from './CurationWorkbench';
import { buildExplorerTree } from './resourcePackExplorerTree';
import type { ModelMetrics } from './ModelPreview';
import { decodeMaterialTextureBindings, encodeMaterialTextureBindings, type MaterialTextureBindings } from './materialTextureBindings';
import { decodeStyleOverride, encodeStyleOverride, packStyleOptions } from './styleOverride';
import { closeResourcePackRoute, getResourcePackRoute, openResourcePackRoute } from './resourceLibraryRoute';
import { api as beeGameApi, type BeeGameResourcePackImpactPayload } from '../../services/api';
import { useToastContext } from '../../contexts/ToastContext';
import { WorkspaceLoadingPage } from '../Common/WorkspaceLoadingPage';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs';
import { ProjectSelect } from '../beui/project-select';
import {
  createResourceUploadTask,
  listResourceUploadTasks,
  removeResourceUploadTask,
  saveResourceUploadTask,
  type ResourceUploadTask,
} from '../../services/resourceUploadQueue';

type ResourceLibraryApi = Pick<
  typeof resourceLibraryApi,
  'listPacks' | 'getPack' | 'listElements' | 'getElement' | 'updatePack' | 'uploadPackCover' | 'addElement'
  | 'createPack' | 'listFolders' | 'createFolder' | 'updateFolder' | 'deleteFolder'
  | 'updateElement' | 'inspectElement' | 'startProcessingJob' | 'getLatestProcessingJob' | 'getProcessingJob' | 'retryProcessingJob' | 'cancelProcessingJob' | 'getElementResourceUrl'
  | 'deleteElement' | 'publishPack' | 'archivePack' | 'getPublishReadiness'
> & Partial<Pick<typeof resourceLibraryApi, 'getCurationQueue' | 'startSemanticCuration' | 'getLatestSemanticCurationJob' | 'getSemanticCurationJob' | 'retrySemanticCuration'>>;

type ResourceLibraryViewProps = {
  apiClient?: ResourceLibraryApi;
  initialPackId?: string;
  onBack?: () => void;
};

type UploadDestination = { category: string; folderPath: string };
type ResourceUploadEntry = { file: File; destination: UploadDestination };
type FailedElementUpload = { file: File; destination: UploadDestination; message: string; taskId?: string };
type ElementUploadStatus = {
  done: number;
  total: number;
  failed: FailedElementUpload[];
  phase: 'uploading' | 'failed' | 'complete' | 'cancelled';
  bytesDone?: number;
  bytesTotal?: number;
  activeFileName?: string;
};

const uploadRetryDelaysMs = [500, 1_250] as const;
const directoryInputAttributes = { webkitdirectory: '', directory: '' } as Record<string, string>;

function browserRelativePathParts(file: File): string[] {
  const relativePath = String((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').trim();
  if (!relativePath) return [];
  const parts = relativePath.split('\\').join('/').split('/').filter((part) => part && part !== '.');
  return parts.some((part) => part === '..') ? [] : parts;
}

function isRetryableUploadError(error: unknown): boolean {
  // A retry must never turn validation, permissions, or incompatible-file errors
  // into a hidden loop. Only a throttled, unavailable, or interrupted request is
  // safe to retry automatically.
  if (!(error instanceof ResourceLibraryApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function waitForUploadRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}


const resourceFormOptions = [
  ['sprite', '2D 图像 / 精灵'], ['tilemap', 'Tilemap'], ['model', '3D 模型'], ['material', '材质'], ['animation', '动画与骨骼'],
  ['ui', 'UI'], ['vfx', '特效'], ['audio', '音频'], ['font', '字体'], ['video', '视频'], ['document', '文档'], ['file', '其他文件'],
] as const;
const assetKindOptions = [
  ['image', '图像'], ['texture', '贴图'], ['sprite', '精灵'], ['sprite-sheet', '精灵表'], ['sprite-atlas', '精灵图集'], ['frame-animation', '逐帧动画'], ['tileset', 'Tileset'], ['tilemap', 'Tilemap'],
  ['mesh', 'Mesh'], ['model', '模型 / 3D 资产'], ['scene', '场景资产'], ['material', '材质'], ['rig', '独立骨骼'], ['animation-clip', '独立动画片段'], ['animation-library', '独立动画库'],
  ['ui-document', 'UI 文档'], ['ui-screen', 'UI 页面'], ['font', '字体'], ['audio-clip', '音频片段'], ['audio-cue', '音频事件'], ['audio-bank', '音频库'], ['music', '音乐'], ['ambience', '环境音'], ['voice', '语音'], ['vfx', '特效'],
  ['shader', 'Shader'], ['physical-material', '物理材质'], ['collider', '独立碰撞体'], ['input-profile', '输入配置'], ['data', '数据'],
] as const;
const capabilityOptions = [
  ['alpha', '透明通道'], ['tileable', '可平铺'], ['nine-slice', '九宫格'], ['sprite-slicing', '精灵切片'], ['frame-sequence', '帧序列'], ['atlas-regions', '图集区域'], ['tile-collision', '格子碰撞'],
  ['skinned', '包含蒙皮'], ['rigged', '包含骨骼'], ['contains-animations', '包含动画'], ['contains-materials', '包含材质'], ['contains-textures', '包含贴图'], ['morph-targets', '包含 Morph Target'], ['lod', 'LOD'], ['collision', '碰撞'], ['navigation', '导航'], ['modular', '模块化'], ['connection-points', '连接点'],
  ['scene-layout', '场景布局'], ['spawn-markers', '出生点'], ['objective-markers', '目标点'], ['ui-states', 'UI 状态'], ['focus-navigation', '焦点导航'], ['safe-area', '安全区域'], ['particle', '粒子'], ['flipbook', 'Flipbook'], ['trail', '拖尾'],
  ['spatial-audio', '空间音频'], ['loop-points', '循环点'], ['audio-variants', '音频变体'], ['physical-properties', '物理属性'], ['ragdoll', '布娃娃'], ['input-actions', '输入动作'], ['touch-controls', '触控'], ['gamepad-controls', '手柄'],
] as const;
const relationKindOptions = [
  ['uses-texture', '使用贴图'], ['uses-material', '使用材质'], ['uses-rig', '使用骨骼'], ['animation-for', '适用于骨骼/角色'], ['collision-for', '碰撞体属于'], ['lod-of', 'LOD 属于'], ['variant-of', '变体属于'], ['component-of', '组件属于'], ['audio-for', '音频属于'], ['vfx-for', '特效属于'],
] as const;

function normaliseUsageTags(value: readonly string[] | undefined): string[] {
  return value ? [...new Set(value)] : [];
}

function canonicalResourcePath(value: string): string {
  return value.split('\\').join('/').split('/').filter(Boolean).join('/').toLocaleLowerCase();
}

function resolveExternalReferencePath(elementPath: string, referencePath: string): string | undefined {
  const reference = referencePath.split('\\').join('/');
  if (!reference || reference.startsWith('/')) return undefined;
  const parts = [...elementPath.split('/').slice(0, -1), ...reference.split('/')];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!resolved.length) return undefined;
      resolved.pop();
    } else resolved.push(part);
  }
  return canonicalResourcePath(resolved.join('/'));
}

/**
 * Applies only metadata that follows directly from the Pack taxonomy or an
 * unambiguous exact file identity. Ambiguous assets deliberately remain in the
 * publish report for a curator to configure.
 */
export function buildSafePublishFix(element: ResourceElement, allElements: readonly ResourceElement[]): Partial<ResourceElement> | undefined {
  const references = parseExternalReferences(element.specs.externalReferences);
  const dependencyBindings = [...(element.dependencyBindings || [])];
  let bindingsChanged = false;
  for (const reference of references) {
    if (dependencyBindings.some(binding => binding.referencePath === reference)) continue;
    const canonicalReference = resolveExternalReferencePath(element.path, reference);
    if (!canonicalReference) continue;
    const candidates = allElements.filter(candidate => {
      if (candidate.id === element.id || candidate.status !== 'ready') return false;
      return canonicalResourcePath(candidate.path) === canonicalReference;
    });
    if (candidates.length === 1) {
      dependencyBindings.push({ referencePath: reference, dependencyElementId: candidates[0].id });
      bindingsChanged = true;
    }
  }
  if (!bindingsChanged) return undefined;
  return {
    ...(bindingsChanged ? {
      dependencyBindings,
      dependencies: [...new Set([...element.dependencies, ...dependencyBindings.map(binding => binding.dependencyElementId)])],
    } : {}),
  };
}

export function ResourceLibraryView({ apiClient = resourceLibraryApi, initialPackId = getResourcePackRoute(), onBack }: ResourceLibraryViewProps) {
  const { t } = useTranslation('resourceLibrary');
  const copy = {
    all: t('list.all'), search: t('list.search'), empty: t('list.empty'), emptyHint: t('list.emptyHint'), previous: t('list.previous'), next: t('list.next'),
    allDimensions: t('list.allDimensions'), allStatuses: t('list.allStatuses'), allGameTypes: t('list.allGameTypes'), allTags: t('list.allTags'),
    draft: t('list.draft'), published: t('list.published'), archived: t('list.archived'),
  };
  const [packs, setPacks] = useState<ResourcePackSummary[]>([]);
  const [selectedPack, setSelectedPack] = useState<ResourcePackSummary | null>(null);
  const [elements, setElements] = useState<ResourceElement[]>([]);
  const [loadedElementCategories, setLoadedElementCategories] = useState<string[]>([]);
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [selectedElement, setSelectedElement] = useState<ResourceElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [activeFolderPath, setActiveFolderPath] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dimension, setDimension] = useState<'all' | '2D' | '3D'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [gameTypeFilter, setGameTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [elementUpload, setElementUpload] = useState<ElementUploadStatus | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [publishReadiness, setPublishReadiness] = useState<ResourcePublishReadiness | null>(null);
  const [archiveImpact, setArchiveImpact] = useState<BeeGameResourcePackImpactPayload | null>(null);
  const editPackButtonRef = useRef<HTMLButtonElement>(null);

  const packSessionRef = useRef(0);
  const categoryRequestRef = useRef(0);
  // A Pack id from the URL is a one-shot mount restoration intent. Keeping a
  // live prop here creates a second navigation source: after an explicit Back,
  // a stale parent render can otherwise reopen the Pack asynchronously.
  const initialPackRouteRef = useRef(initialPackId);
  const cancelUploadRef = useRef(false);
  const activeUploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .listPacks()
      .then((result) => {
        if (!cancelled) setPacks(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const openPack = async (pack: ResourcePackSummary) => {
    const session = ++packSessionRef.current;
    categoryRequestRef.current += 1;
    openResourcePackRoute(pack.id);
    setError('');
    setLoading(true);
    try {
      const detail = await apiClient.getPack(pack.id);
      const nextFolders = await apiClient.listFolders(pack.id);
      // Workspace loading intentionally lists every element; folders are not categories.
      const nextElements = await apiClient.listElements(pack.id);
      if (session !== packSessionRef.current) return;
      const category = nextElements[0]?.category;
      setSelectedPack(detail);
      setFolders(nextFolders);
      setActiveCategory(category);
      setActiveFolderPath(undefined);
      setElements(nextElements);
      setLoadedElementCategories([...new Set(nextElements.map((element) => element.category))]);
      setSelectedElement(null);
    } catch (err) {
      if (session === packSessionRef.current) setError(err instanceof Error ? err.message : t('errors.loadFailed'));
    } finally {
      if (session === packSessionRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const routePackId = initialPackRouteRef.current;
    if (!routePackId || selectedPack || loading) return;
    const pack = packs.find((item) => item.id === routePackId);
    if (pack) {
      initialPackRouteRef.current = undefined;
      void openPack(pack);
    }
  }, [loading, packs, selectedPack]);

  const gameTypeOptions = useMemo(() => [...new Set(packs.flatMap((pack) => pack.gameTypes ?? []))].sort((left, right) => left.localeCompare(right)), [packs]);
  const tagOptions = useMemo(() => [...new Set(packs.flatMap((pack) => pack.tags ?? []))].sort((left, right) => left.localeCompare(right)), [packs]);
  const visiblePacks = useMemo(() => packs.filter((pack) => {
    const matchesQuery = !query.trim() || [pack.name, ...pack.styles, ...(pack.gameTypes || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || pack.status === statusFilter;
    const matchesGameType = !gameTypeFilter || (pack.gameTypes ?? []).some((gameType) => gameType.localeCompare(gameTypeFilter, undefined, { sensitivity: 'accent' }) === 0);
    const matchesTag = !tagFilter || (pack.tags ?? []).some((tag) => tag.localeCompare(tagFilter, undefined, { sensitivity: 'accent' }) === 0);
    return matchesQuery &&
      (dimension === 'all' || pack.dimension === dimension) &&
      matchesStatus &&
      matchesGameType &&
      matchesTag;
  }), [dimension, gameTypeFilter, packs, query, statusFilter, tagFilter]);
  const pageCount = Math.max(1, Math.ceil(visiblePacks.length / 64));
  const pagedPacks = visiblePacks.slice((page - 1) * 64, page * 64);

  const uploadQueuedElements = async (uploads: Array<{ file: File; destination: UploadDestination; task?: ResourceUploadTask }>) => {
    if (!selectedPack || uploads.length === 0) return;
    const session = packSessionRef.current;
    cancelUploadRef.current = false;
    setError('');
    const queue = uploads.map(({ file, destination, task }) => task ?? createResourceUploadTask(selectedPack.id, file, destination));
    await Promise.all(queue.map((task) => saveResourceUploadTask({ ...task, status: 'queued', message: undefined })));
    const bytesTotal = queue.reduce((total, task) => total + task.file.size, 0);
    let completedBytes = 0;
    setElementUpload({ done: 0, total: queue.length, failed: [], phase: 'uploading', bytesDone: 0, bytesTotal });
    const failed: FailedElementUpload[] = [];
    for (const task of queue) {
      const { file, destination } = task;
      if (cancelUploadRef.current) {
        await saveResourceUploadTask({ ...task, status: 'cancelled', message: t('errors.uploadCancelled') });
        failed.push({ file, destination, message: t('errors.uploadCancelled'), taskId: task.id });
        setElementUpload((current) => current ? { ...current, done: current.done + 1 } : current);
        continue;
      }
      try {
        let next: ResourceElement | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt <= uploadRetryDelaysMs.length; attempt += 1) {
          try {
            const controller = new AbortController();
            activeUploadAbortRef.current = controller;
            await saveResourceUploadTask({ ...task, status: 'uploading', attempts: task.attempts + attempt + 1, message: undefined });
            setElementUpload((current) => current ? { ...current, activeFileName: file.name } : current);
            next = await apiClient.addElement(selectedPack.id, file, destination.category, destination.folderPath, {
              signal: controller.signal,
              onProgress: (loaded) => setElementUpload((current) => current ? { ...current, bytesDone: Math.min(current.bytesTotal || 0, completedBytes + loaded) } : current),
            });
            activeUploadAbortRef.current = null;
            break;
          } catch (err) {
            activeUploadAbortRef.current = null;
            lastError = err;
            if (cancelUploadRef.current || (err instanceof DOMException && err.name === 'AbortError')) break;
            if (!isRetryableUploadError(err) || attempt === uploadRetryDelaysMs.length) break;
            await waitForUploadRetry(uploadRetryDelaysMs[attempt]);
          }
        }
        if (!next) throw lastError instanceof Error ? lastError : new Error(t('errors.uploadFailed'));
        await removeResourceUploadTask(task.id);
        completedBytes += file.size;
        if (session !== packSessionRef.current) continue;
        setElements((current) => [...current, next]);
        setLoadedElementCategories((current) => [...new Set([...current, next.category])]);
        setSelectedPack((current) => current ? { ...current, elementCount: current.elementCount + 1 } : current);
        setPacks((current) => current.map((pack) => pack.id === selectedPack.id ? { ...pack, elementCount: pack.elementCount + 1 } : pack));
        // Uploading must not steal the current inspector/preview focus. The
        // user can select any uploaded item deliberately from the tree.
      } catch (err) {
        const message = cancelUploadRef.current ? t('errors.uploadCancelled') : (err instanceof Error ? err.message : t('errors.uploadFailed'));
        const status = cancelUploadRef.current ? 'cancelled' : 'failed';
        await saveResourceUploadTask({ ...task, status, attempts: task.attempts + 1, message });
        failed.push({ file, destination, message, taskId: task.id });
      } finally {
        setElementUpload((current) => current ? { ...current, done: current.done + 1, bytesDone: Math.min(current.bytesTotal || 0, completedBytes), activeFileName: undefined } : current);
      }
    }
    if (session !== packSessionRef.current) return;
    if (failed.length) {
      setElementUpload({ done: uploads.length, total: uploads.length, failed, phase: cancelUploadRef.current ? 'cancelled' : 'failed' });
      setError(t('errors.uploadFailureCount', { count: failed.length }));
      return;
    }
    setElementUpload({ done: uploads.length, total: uploads.length, failed: [], phase: 'complete', bytesDone: bytesTotal, bytesTotal });
    window.setTimeout(() => setElementUpload((current) => current?.phase === 'complete' ? null : current), 1_200);
  };

  const uploadElements = async (files: File[], destination?: UploadDestination) => {
    const uploadCategory = destination?.category || activeCategory || 'environment';
    const uploadFolderPath = destination?.folderPath || activeFolderPath || uploadCategory;
    await uploadQueuedElements(files.map((file) => ({ file, destination: { category: uploadCategory, folderPath: uploadFolderPath } })));
  };

  const retryFailedUploads = async () => {
    if (!elementUpload?.failed.length) return;
    await Promise.all(elementUpload.failed.map((upload) => upload.taskId ? removeResourceUploadTask(upload.taskId) : Promise.resolve()));
    await uploadQueuedElements(elementUpload.failed.map(({ file, destination }) => ({ file, destination })));
  };

  const dismissFailedUploads = () => {
    const taskIds = elementUpload?.failed.flatMap((upload) => upload.taskId ? [upload.taskId] : []) ?? [];
    setElementUpload(null);
    setError('');
    cancelUploadRef.current = false;
    activeUploadAbortRef.current = null;
    void Promise.all(taskIds.map((taskId) => removeResourceUploadTask(taskId)));
  };

  useEffect(() => {
    if (!selectedPack) return;
    let disposed = false;
    void listResourceUploadTasks(selectedPack.id).then((tasks) => {
      if (disposed || !tasks.length) return;
      const pending = tasks.filter((task) => task.status === 'queued' || task.status === 'uploading');
      const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled');
      const resumable = [...pending, ...failed];
      setElementUpload({
        done: 0,
        total: resumable.length,
        failed: resumable.map((task) => ({ file: task.file, destination: task.destination, message: task.message || t('errors.resumeUploadPending'), taskId: task.id })),
        phase: failed.length ? (failed.some((task) => task.status === 'failed') ? 'failed' : 'cancelled') : 'cancelled',
        bytesDone: 0,
        bytesTotal: resumable.reduce((total, task) => total + task.file.size, 0),
      });
    });
    return () => { disposed = true; };
  }, [selectedPack?.id]);

  if (loading && !selectedPack && !error) {
    return <WorkspaceLoadingPage title={t('list.loading')} description="" ariaLabel={t('list.loading')} />;
  }

  if (selectedPack) {
    return (
      <>
      <EditResourcePackDialog open={editDialogOpen} pack={selectedPack} finalFocus={() => editPackButtonRef.current} onClose={() => setEditDialogOpen(false)} onUploadCover={async (file) => { const uploaded = await apiClient.uploadPackCover(selectedPack.id, file); setSelectedPack(uploaded); setPacks((current) => current.map((item) => item.id === uploaded.id ? uploaded : item)); return uploaded; }} onSave={async (input) => { const saved = await apiClient.updatePack(selectedPack.id, input); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); return saved; }} />
      {archiveImpact ? <ArchivePackDialog pack={selectedPack} impact={archiveImpact} onClose={() => setArchiveImpact(null)} onArchive={async () => { const archived = await apiClient.archivePack(selectedPack.id); setSelectedPack(archived); setPacks((current) => current.map((item) => item.id === archived.id ? archived : item)); setArchiveImpact(null); }} /> : null}
      {publishReadiness ? <PublishReadinessDialog report={publishReadiness} autoFixableCount={elements.filter(element => Boolean(buildSafePublishFix(element, elements))).length} onClose={() => setPublishReadiness(null)} onSelectElement={(elementId) => { const element = elements.find((item) => item.id === elementId); if (element) setSelectedElement(element); setPublishReadiness(null); }} onAutoFix={async () => {
        const fixes = elements.map(element => ({ element, fix: buildSafePublishFix(element, elements) })).filter((entry): entry is { element: ResourceElement; fix: Partial<ResourceElement> } => Boolean(entry.fix));
        if (fixes.length) {
          const updated = await Promise.all(fixes.map(({ element, fix }) => apiClient.updateElement(selectedPack.id, element.id, fix)));
          setElements(current => current.map(element => updated.find(item => item.id === element.id) || element));
          setSelectedElement(current => current ? updated.find(item => item.id === current.id) || current : null);
        }
        return apiClient.getPublishReadiness(selectedPack.id);
      }} /> : null}
      <PackBrowser
        apiClient={apiClient}
        pack={selectedPack}
        elements={elements}
        loadedElementCategories={loadedElementCategories}
        selectedElement={selectedElement}
        loading={loading}
        error={error}
        onBack={() => {
          initialPackRouteRef.current = undefined;
          closeResourcePackRoute();
          packSessionRef.current += 1;
          categoryRequestRef.current += 1;
          setSelectedPack(null);
          setSelectedElement(null);
          setLoadedElementCategories([]);
          setFolders([]);
          setLoading(false);
        }}
        onElement={setSelectedElement}
        onClearElement={() => setSelectedElement(null)}
        editPackButtonRef={editPackButtonRef}
        onEditPack={() => setEditDialogOpen(true)}
        onArchivePack={async () => { try { setArchiveImpact(await beeGameApi.getResourcePackImpact(selectedPack.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : t('errors.impactLoadFailed')); } }}
        onAddFiles={(files, destination) => void uploadElements(files, destination)}
        onAddFileEntries={uploadQueuedElements}
        onDropFiles={(files, destination) => void uploadElements(files, destination)}
        uploadStatus={elementUpload}
        onRetryFailedUploads={() => void retryFailedUploads()}
        onCancelUploads={() => { cancelUploadRef.current = true; activeUploadAbortRef.current?.abort(); }}
        onDismissUploads={dismissFailedUploads}
        folders={folders}
        onCreateFolder={async (name) => { const folder = await apiClient.createFolder(selectedPack.id, { name }); setFolders((current) => [...current, folder]); }}
        onUpdateElement={async (elementId, body) => { const updated = await apiClient.updateElement(selectedPack.id, elementId, body); setElements((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelectedElement(updated); }}
        onPublish={async () => { const report = await apiClient.getPublishReadiness(selectedPack.id); if (!report.canPublish) { setPublishReadiness(report); return; } const published = await apiClient.publishPack(selectedPack.id); setSelectedPack(published); setPacks((current) => current.map((item) => item.id === published.id ? published : item)); }}
        onRefreshWorkspace={async () => { const [nextFolders, nextElements] = await Promise.all([apiClient.listFolders(selectedPack.id), apiClient.listElements(selectedPack.id)]); setFolders(nextFolders); setElements(nextElements); setLoadedElementCategories([...new Set(nextElements.map((element) => element.category))]); setSelectedElement((current) => current ? nextElements.find((element) => element.id === current.id) ?? null : null); }}
      /></>
    );
  }

  return (
    <section className="relative min-h-full bg-background px-4 py-5 text-foreground sm:px-6 sm:py-6">
      <CreateResourcePackDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} onCreate={async (input) => { const created = await apiClient.createPack(input); setPacks((current) => [created, ...current]); return created; }} />
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground"
        >
          {error}
        </div>
      ) : null}
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-2 text-xl font-semibold">
          {onBack ? <button type="button" aria-label={t('list.backToWorkspace')} title={t('list.backToWorkspace')} onClick={onBack} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button> : null}
          <span>{copy.all}</span>
          <button type="button" aria-label={t('create')} onClick={() => setCreateDialogOpen(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent">+</button>
        </div>
        <div className="flex-1" />
        <label className="flex h-9 w-64 min-w-48 items-center gap-2 rounded-lg border border-input bg-background px-3 text-muted-foreground">
          <Search className="h-4 w-4" />
          <input aria-label={copy.search} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={copy.search} className="type-input min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <div aria-label={copy.allDimensions} className="flex rounded-lg border border-border p-0.5">
          {(['all', '2D', '3D'] as const).map((value) => (
            <button key={value} type="button" onClick={() => { setDimension(value); setPage(1); }} className={`rounded-md px-3 py-1.5 text-xs ${dimension === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
              {value === 'all' ? copy.allDimensions : value}
            </button>
          ))}
        </div>
        <ProjectSelect ariaLabel={copy.allStatuses} value={statusFilter} onValueChange={value => { setStatusFilter(value as typeof statusFilter); setPage(1); }} options={[{ value: 'all', label: copy.allStatuses }, { value: 'draft', label: copy.draft }, { value: 'published', label: copy.published }, { value: 'archived', label: copy.archived }]} triggerClassName="h-9 rounded-lg text-xs" />
        {gameTypeOptions.length > 0 ? <ProjectSelect ariaLabel={copy.allGameTypes} value={gameTypeFilter} onValueChange={value => { setGameTypeFilter(value); setPage(1); }} options={[{ value: '', label: copy.allGameTypes }, ...gameTypeOptions.map(gameType => ({ value: gameType, label: gameType }))]} className="max-w-44" triggerClassName="h-9 rounded-lg text-xs" /> : null}
        {tagOptions.length > 0 ? <ProjectSelect ariaLabel={copy.allTags} value={tagFilter} onValueChange={value => { setTagFilter(value); setPage(1); }} options={[{ value: '', label: copy.allTags }, ...tagOptions.map(tag => ({ value: tag, label: tag }))]} className="max-w-40" triggerClassName="h-9 rounded-lg text-xs" /> : null}
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {pagedPacks.map((pack) => (
          <PackCard key={pack.id} pack={pack} onOpen={() => void openPack(pack)} />
        ))}
      </div>
      {!loading && visiblePacks.length === 0 ? <EmptyState onImport={() => setCreateDialogOpen(true)} title={copy.empty} hint={copy.emptyHint} importLabel={t('create')} /> : null}
      {pageCount > 1 ? (
        <div className="mt-7 flex items-center justify-center gap-3">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-3 py-2 disabled:opacity-40">{copy.previous}</button>
          <span className="text-xs text-muted-foreground">{page} / {pageCount}</span>
          <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-3 py-2 disabled:opacity-40">{copy.next}</button>
        </div>
      ) : null}
    </section>
  );
}

export function ResourceLibraryPage({ onBack }: { onBack: () => void }) {
  const [initialPackId] = useState(() => getResourcePackRoute());
  const { t } = useTranslation('resourceLibrary');
  return (
    <Dialog open onOpenChange={open => { if (!open) onBack(); }}>
      <DialogContent
        aria-label={t('library')}
        className="inset-0 left-0 top-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0"
      >
        <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
          <ResourceLibraryView initialPackId={initialPackId} onBack={onBack} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onImport, title, hint, importLabel }: { onImport: () => void; title: string; hint: string; importLabel: string }) {
  return (
    <div className="mt-8 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center">
      <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg border border-border bg-muted text-xl text-muted-foreground">＋</div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{hint}</p>
      <button type="button" onClick={onImport} className="mt-5 h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">{importLabel}</button>
    </div>
  );
}

function PublishReadinessDialog({ report, autoFixableCount, onClose, onSelectElement, onAutoFix }: { report: ResourcePublishReadiness; autoFixableCount: number; onClose: () => void; onSelectElement: (elementId: string) => void; onAutoFix: () => Promise<ResourcePublishReadiness> }) {
  const { t } = useTranslation('resourceLibrary');
  const [activeReport, setActiveReport] = useState(report);
  const [isFixing, setIsFixing] = useState(false);
  useEffect(() => setActiveReport(report), [report]);
  const IssueList = ({ issues, tone }: { issues: readonly { code: string; message: string; elementId?: string }[]; tone: 'blocking' | 'warning' }) => <ul className="space-y-2">{issues.map((issue, index) => <li key={`${issue.code}-${issue.elementId || index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 type-caption-2 ${tone === 'blocking' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-warning/40 bg-warning/10 text-warning'}`}><span className="mt-0.5">{tone === 'blocking' ? '×' : '!'}</span><span className="min-w-0 flex-1">{issue.message}</span>{issue.elementId ? <button type="button" onClick={() => onSelectElement(issue.elementId!)} className="shrink-0 text-foreground underline underline-offset-2">{t('detail.locate')}</button> : null}</li>)}</ul>;
  const canAutoFix = autoFixableCount > 0;
  const autoFix = async () => { setIsFixing(true); try { setActiveReport(await onAutoFix()); } finally { setIsFixing(false); } };
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent aria-label={t('detail.publishCheck')} className="max-w-md p-5"><section className="w-full text-foreground"><div className="flex items-start justify-between gap-4 border-b border-border pb-4"><div><p className="text-xs font-medium text-muted-foreground">{t('library')}</p><DialogTitle className="mt-1 text-lg">{t('detail.publishCheck')}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{t('detail.publishHint')}</p></div><button type="button" aria-label={t('detail.closePublishCheck')} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:bg-accent"><X className="size-4" aria-hidden="true" /></button></div>{canAutoFix ? <div className="mt-4 rounded-lg border border-info-500/30 bg-muted p-3"><p className="text-sm text-muted-foreground">{t('detail.autoFixHint', { count: autoFixableCount })}</p><button type="button" disabled={isFixing} onClick={() => void autoFix()} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button mt-3 w-full px-4 py-2 disabled:opacity-50">{t(isFixing ? 'detail.autoFixing' : 'detail.autoFix')}</button></div> : null}<div className="max-h-[52vh] space-y-4 overflow-y-auto py-4">{activeReport.blocking.length ? <section><h3 className="mb-2 text-sm font-medium text-destructive">{t('detail.blocking')} · {activeReport.blocking.length}</h3><IssueList issues={activeReport.blocking} tone="blocking" /></section> : <p className="rounded-lg border border-success-500/30 bg-muted px-3 py-2 text-sm text-foreground dark:text-foreground">{t('detail.allResolved')}</p>}{activeReport.warnings.length ? <section><h3 className="mb-2 text-sm font-medium text-warning">{t('detail.warnings')} · {activeReport.warnings.length}</h3><IssueList issues={activeReport.warnings} tone="warning" /></section> : null}</div><button type="button" onClick={onClose} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button w-full px-4 py-2">{t('detail.backToFix')}</button></section></DialogContent></Dialog>
}

function PackCard({ pack, onOpen }: { pack: ResourcePackSummary; onOpen: () => void }) {
  const { t } = useTranslation('resourceLibrary');
  const [coverUnavailable, setCoverUnavailable] = useState(false);
  const hasCover = Boolean(pack.coverPath) && !coverUnavailable;
  return (
    <button
      type="button"
      aria-label={pack.name}
      onClick={onOpen}
      className="group grid aspect-[4/3] overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative min-h-0 overflow-hidden bg-muted">
        {hasCover ? (/(mp4|webm)/i.test(pack.coverPath!) ? <video src={pack.coverPath} muted autoPlay loop playsInline onError={() => setCoverUnavailable(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" /> : <img src={pack.coverPath} alt="" onError={() => setCoverUnavailable(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />) : <div className="grid h-full place-items-center text-5xl text-muted-foreground" aria-hidden="true">✦</div>}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <span className="rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-foreground shadow-sm">{t('list.elements', { count: pack.elementCount })}</span>
          <span className={`rounded-md border px-2 py-1 text-xs shadow-sm ${pack.status === 'published' ? 'border-success-500/30 bg-muted text-foreground dark:text-foreground' : pack.status === 'archived' ? 'border-warning-500/30 bg-muted text-warning' : 'border-border bg-background/90 text-muted-foreground'}`}>{t(`list.${pack.status}`)}</span>
        </div>
      </div>
      <div className="min-w-0 border-t border-border bg-card p-4">
        <h2 className="truncate text-base font-semibold text-foreground">{pack.name}</h2>
        <p className="mt-1 truncate text-sm text-muted-foreground">v{pack.version || '—'} · {pack.license || t('list.unlicensed')} · {t(`primaryCategories.${pack.primaryCategory}`)}</p>
      </div>
    </button>
  );
}

function PackBrowser({
  apiClient,
  pack,
  elements,
  loadedElementCategories,
  selectedElement,
  loading,
  error,
  onBack,
  onElement,
  onClearElement,
  editPackButtonRef,
  onEditPack,
  onArchivePack,
  onAddFiles,
  onAddFileEntries,
  onDropFiles,
  folders,
  onCreateFolder,
  uploadStatus,
  onRetryFailedUploads,
  onCancelUploads,
  onDismissUploads,
  onPublish,
  onUpdateElement,
  onRefreshWorkspace,
}: {
  apiClient: ResourceLibraryApi;
  pack: ResourcePackSummary;
  elements: ResourceElement[];
  loadedElementCategories: string[];
  selectedElement: ResourceElement | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onElement: (element: ResourceElement) => void;
  onClearElement: () => void;
  editPackButtonRef: RefObject<HTMLButtonElement | null>;
  onEditPack: () => void;
  onArchivePack: () => Promise<void>;
  onAddFiles: (files: File[], destination: UploadDestination) => void;
  onAddFileEntries: (entries: ResourceUploadEntry[]) => Promise<void>;
  onDropFiles: (files: File[], destination: UploadDestination) => void;
  folders: ResourceFolder[];
  onCreateFolder: (name: string) => Promise<void>;
  onUpdateElement: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  onRefreshWorkspace: () => Promise<void>;
  uploadStatus: ElementUploadStatus | null;
  onRetryFailedUploads: () => void;
  onCancelUploads: () => void;
  onDismissUploads: () => void;
  onPublish: () => Promise<void>;
}) {
  const { showSuccess } = useToastContext();
  const { t } = useTranslation('resourceLibrary');
  const categories = useMemo(() => [...new Set([...loadedElementCategories, ...elements.map((element) => element.category)].filter((category) => category.trim().length > 0))], [elements, loadedElementCategories]);
  const explorerTree = useMemo(() => buildExplorerTree(pack, folders, elements, (category) => t(`categories.${category}`, { defaultValue: category })), [elements, folders, pack, t]);
  const explorerHostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const directoryUploadTargetRef = useRef<{ destination: UploadDestination; parentFolderId?: string } | undefined>(undefined);
  const [explorerHeight, setExplorerHeight] = useState(0);
  const [uploadDestination, setUploadDestination] = useState<UploadDestination>({ category: categories[0] || 'models', folderPath: categories[0] || 'models' });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resourceUrl, setResourceUrl] = useState<string>();
  const [resourceError, setResourceError] = useState('');
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [boundTextureUrls, setBoundTextureUrls] = useState<Record<string, string>>({});
  const [externalResources, setExternalResources] = useState<{ bindingsKey: string; urls: Record<string, string> }>({ bindingsKey: '', urls: {} });
  const [renameTarget, setRenameTarget] = useState<{ type: 'folder' | 'file'; mode: 'create' | 'rename'; name: string; folder?: ResourceFolder; element?: ResourceElement } | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const selectedElements = useMemo(() => elements.filter(element => selectedElementIds.includes(element.id)), [elements, selectedElementIds]);
  const [moveError, setMoveError] = useState('');
  const [inspectionJob, setInspectionJob] = useState<ResourceProcessingJob | null>(null);
  const refreshedProcessingJobsRef = useRef(new Set<string>());
  const [curationOpen, setCurationOpen] = useState(false);
  const [pendingCurationCount, setPendingCurationCount] = useState(0);
  const [usageTagOptions, setUsageTagOptions] = useState<string[]>([]);
  const dependencyBindingsKey = JSON.stringify(selectedElement?.dependencyBindings ?? []);
  const externalResourcesReady = externalResources.bindingsKey === dependencyBindingsKey;
  useEffect(() => {
    setSelectedElementIds(current => current.filter(id => elements.some(element => element.id === id)));
  }, [elements]);
  useLayoutEffect(() => {
    const host = explorerHostRef.current;
    if (!host) return;
    const update = () => setExplorerHeight(Math.max(1, Math.floor(host.getBoundingClientRect().height)));
    update();
    if (typeof ResizeObserver === 'undefined') {
      // JSDOM has no layout observer; production always measures the host.
      setExplorerHeight(560);
      return;
    }
    const observer = new ResizeObserver(update); observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setInspectorOpen(false); }, [selectedElement?.id]);
  useEffect(() => {
    let active = true;
    void apiClient.getLatestProcessingJob(pack.id).then(job => {
      if (active && job && ['queued', 'running', 'failed'].includes(job.status)) setInspectionJob(job);
    }).catch(cause => { if (active) setMoveError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [apiClient, pack.id]);
  useEffect(() => {
    let active = true;
    if (!apiClient.getCurationQueue) return () => { active = false; };
    void apiClient.getCurationQueue(pack.id).then(queue => {
      if (!active) return;
      setPendingCurationCount(queue.counts.pendingItems);
      setUsageTagOptions([...queue.usageTagOptions]);
    }).catch(() => {
      if (active) {
        setPendingCurationCount(0);
        setUsageTagOptions([]);
      }
    });
    return () => { active = false; };
  }, [apiClient, pack.id]);
  useEffect(() => {
    if (!inspectionJob || !['queued', 'running'].includes(inspectionJob.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    const poll = async () => {
      try {
        const next = await apiClient.getProcessingJob(pack.id, inspectionJob.id);
        if (!active) return;
        consecutiveFailures = 0;
        setMoveError('');
        if (['queued', 'running'].includes(next.status)) {
          setInspectionJob(next);
          timer = setTimeout(() => void poll(), 800);
        } else if (!refreshedProcessingJobsRef.current.has(next.id)) {
          // Do not expose a terminal state until the refreshed workspace is
          // available. If refresh fails, keep polling instead of stranding a
          // completed 100% cover on screen.
          await onRefreshWorkspace();
          if (!active) return;
          refreshedProcessingJobsRef.current.add(next.id);
          if (next.status === 'completed') {
            setInspectionJob(null);
            showSuccess(t('errors.analysisComplete', { count: next.completedItems }));
          } else setInspectionJob(next);
        } else if (next.status === 'completed') {
          setInspectionJob(null);
        } else {
          setInspectionJob(next);
        }
      } catch (cause) {
        if (!active) return;
        consecutiveFailures += 1;
        setMoveError(cause instanceof Error ? cause.message : String(cause));
        const retryDelayMs = Math.min(8_000, 1_000 * (2 ** Math.min(consecutiveFailures - 1, 3)));
        timer = setTimeout(() => void poll(), retryDelayMs);
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [apiClient, inspectionJob?.id, inspectionJob?.status, onRefreshWorkspace, pack.id, showSuccess, t]);
  useEffect(() => {
    let active = true;
    setResourceUrl(undefined); setResourceError('');
    if (!selectedElement) return () => { active = false; };
    void apiClient.getElementResourceUrl(pack.id, selectedElement.id).then(url => { if (active) setResourceUrl(url); }).catch(() => { if (active) setResourceError(t('errors.previewLoadFailed')); });
    return () => { active = false; };
  }, [apiClient, pack.id, resourceAttempt, selectedElement]);
  const materialTextureBindings = useMemo(() => decodeMaterialTextureBindings(selectedElement?.specs.materialTextureBindings), [selectedElement?.specs.materialTextureBindings]);
  useEffect(() => {
    let active = true;
    const ids = [...new Set(Object.values(materialTextureBindings).flatMap(binding => binding.baseColor ? [binding.baseColor] : []))];
    if (!ids.length) { setBoundTextureUrls({}); return () => { active = false; }; }
    void Promise.all(ids.map(async id => [id, await apiClient.getElementResourceUrl(pack.id, id)] as const)).then(entries => {
      if (active) setBoundTextureUrls(Object.fromEntries(entries));
    }).catch(() => { if (active) setBoundTextureUrls({}); });
    return () => { active = false; };
  }, [apiClient, materialTextureBindings, pack.id]);
  useEffect(() => {
    let active = true;
    const bindings = JSON.parse(dependencyBindingsKey) as Array<{ referencePath: string; dependencyElementId: string }>;
    if (!bindings.length) {
      setExternalResources({ bindingsKey: dependencyBindingsKey, urls: {} });
      return () => { active = false; };
    }
    void Promise.allSettled(bindings.map(async binding => [binding.referencePath, await apiClient.getElementResourceUrl(pack.id, binding.dependencyElementId)] as const)).then(results => {
      if (!active) return;
      setExternalResources({ bindingsKey: dependencyBindingsKey, urls: Object.fromEntries(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])) });
    });
    return () => { active = false; };
  }, [apiClient, dependencyBindingsKey, pack.id]);
  const saveMetrics = useCallback(async (metrics: ModelMetrics) => {
    if (!selectedElement) return;
    const nextMetrics: Record<string, string | number | boolean | null> = {
      triangles: metrics.triangles,
      vertices: metrics.vertices,
      materialCount: metrics.materialCount,
      materialSlots: metrics.materialSlots.join(' · '),
      textureReferences: metrics.textureReferences.join(' · '),
      unresolvedTextureReferences: metrics.unresolvedTextureReferences.join(' · '),
      boundsSizeX: metrics.bounds.width,
      boundsSizeY: metrics.bounds.height,
      boundsSizeZ: metrics.bounds.depth,
      previewStatus: 'ready',
      inspectionStatus: 'complete',
    };
    const existingBindings = decodeMaterialTextureBindings(selectedElement.specs.materialTextureBindings);
    const encodedBindings = encodeMaterialTextureBindings(existingBindings);
    const componentKinds = new Set(metrics.components.map(component => component.kind));
    const inspectedCapabilities = [
      componentKinds.has('skinned-mesh') ? 'skinned' : '',
      componentKinds.has('skeleton') ? 'rigged' : '',
      componentKinds.has('animation-clip') ? 'contains-animations' : '',
      componentKinds.has('material') ? 'contains-materials' : '',
      componentKinds.has('texture') ? 'contains-textures' : '',
      componentKinds.has('morph-target') ? 'morph-targets' : '',
    ].filter(Boolean);
    const capabilities = [...new Set([...(selectedElement.capabilities ?? []), ...inspectedCapabilities])];
    const externalReferences = parseExternalReferences(selectedElement.specs.externalReferences);
    const inspectedProfile: NonNullable<ResourceElement['contentProfile']> = {
      packaging: externalReferences.length ? 'external-dependencies' : 'self-contained',
      components: metrics.components,
      inspection: { status: 'complete' as const, source: 'client' as const, inspectorVersion: 'model-preview-v1' },
    };
    const currentProfileComparable = selectedElement.contentProfile ? {
      ...selectedElement.contentProfile,
      inspection: {
        status: selectedElement.contentProfile.inspection.status,
        source: selectedElement.contentProfile.inspection.source,
        inspectorVersion: selectedElement.contentProfile.inspection.inspectorVersion,
      },
    } : undefined;
    const profileChanged = JSON.stringify(currentProfileComparable) !== JSON.stringify(inspectedProfile);
    const contentProfile: NonNullable<ResourceElement['contentProfile']> = profileChanged ? {
      ...inspectedProfile,
      inspection: { ...inspectedProfile.inspection, inspectedAt: new Date().toISOString() },
    } : selectedElement.contentProfile!;
    const changed = Object.entries(nextMetrics).some(([key, value]) => selectedElement.specs[key] !== value)
      || selectedElement.specs.materialTextureBindings !== encodedBindings
      || profileChanged
      || JSON.stringify(selectedElement.capabilities ?? []) !== JSON.stringify(capabilities);
    if (changed) await onUpdateElement(selectedElement.id, { capabilities, contentProfile, specs: { ...selectedElement.specs, ...nextMetrics, materialTextureBindings: encodedBindings } });
  }, [onUpdateElement, selectedElement]);
  const startFolderUpload = (node: { id: string; name: string; folder?: ResourceFolder }) => {
    const category = node.folder
      ? (elements.find((element) => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'models')
      : (node.id.startsWith('category:') ? node.id.slice('category:'.length) : categories[0] || 'models');
    setUploadDestination({ category, folderPath: node.folder?.path || category });
    fileInputRef.current?.click();
  };
  const renameFolder = (folder: ResourceFolder) => setRenameTarget({ type: 'folder', mode: 'rename', name: folder.name, folder });
  const deleteFolder = async (folder: ResourceFolder) => {
    const message = t('errors.deleteFolderConfirm', { name: folder.name });
    if (!window.confirm(message)) return;
    await apiClient.deleteFolder(pack.id, folder.id);
    await onRefreshWorkspace();
  };
  const renameElement = (element: ResourceElement) => setRenameTarget({ type: 'file', mode: 'rename', name: element.name, element });
  const deleteElement = async (element: ResourceElement) => { if (window.confirm(t('errors.deleteFileConfirm', { name: element.name }))) { await apiClient.deleteElement(pack.id, element.id); await onRefreshWorkspace(); } };
  const moveElements = async (items: ResourceElement[], folder: ResourceFolder) => {
    const unique = [...new Map(items.map(item => [item.id, item])).values()];
    const moves = unique.filter(item => item.path !== `${folder.path}/${item.name}`);
    if (!moves.length) return;
    const results = await Promise.allSettled(moves.map(item => onUpdateElement(item.id, { path: `${folder.path}/${item.name}` })));
    await onRefreshWorkspace();
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length) setMoveError(t('errors.moveFailed', { count: failed.length }));
    else setSelectedElementIds(moves.map(item => item.id));
  };
  const inspectUnprocessedElements = async () => {
    const pending = elements.filter(element => !element.contentProfile || element.contentProfile.inspection.status !== 'complete');
    if (!pending.length) return;
    setMoveError('');
    try { setInspectionJob(await apiClient.startProcessingJob(pack.id, pending.map(element => element.id))); }
    catch (cause) { setMoveError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const destinationForNode = (node: { id: string; folder?: ResourceFolder }): UploadDestination => {
    const category = node.folder
      ? (elements.find((element) => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'models')
      : (node.id.startsWith('category:') ? node.id.slice('category:'.length) : categories[0] || 'models');
    return { category, folderPath: node.folder?.path || category };
  };
  const startFolderDirectoryUpload = (node: { id: string; folder?: ResourceFolder }) => {
    const destination = destinationForNode(node);
    setUploadDestination(destination);
    directoryUploadTargetRef.current = { destination, ...(node.folder ? { parentFolderId: node.folder.id } : {}) };
    folderInputRef.current?.click();
  };
  const uploadDirectorySelection = async (files: File[]) => {
    if (!files.length) return;
    const selected = files.map((file) => ({ file, parts: browserRelativePathParts(file) }));
    if (selected.some(({ parts }) => parts.length < 2)) {
      setMoveError(t('errors.directoryMissing'));
      return;
    }
    setMoveError('');
    const uploadTarget = directoryUploadTargetRef.current ?? { destination: uploadDestination };
    const parentFolderId = uploadTarget.parentFolderId || '';
    const knownFolders = new Map(folders.map((folder) => [folder.path.split('\\').join('/'), folder]));
    let createdFolder = false;
    const entries: ResourceUploadEntry[] = [];
    try {
      for (const { file, parts } of selected) {
        let parent = parentFolderId ? folders.find((folder) => folder.id === parentFolderId) : undefined;
        let currentPath = parent?.path.split('\\').join('/') || '';
        for (const segment of parts.slice(0, -1)) {
          const desiredPath = currentPath ? `${currentPath}/${segment}` : segment;
          let folder = knownFolders.get(desiredPath);
          if (!folder) {
            folder = await apiClient.createFolder(pack.id, { name: segment, ...(parent ? { parentId: parent.id } : {}) });
            knownFolders.set(folder.path.split('\\').join('/'), folder);
            createdFolder = true;
          }
          parent = folder;
          currentPath = folder.path.split('\\').join('/');
        }
        entries.push({ file, destination: { category: uploadTarget.destination.category, folderPath: currentPath || uploadTarget.destination.folderPath } });
      }
      if (createdFolder) await onRefreshWorkspace();
      await onAddFileEntries(entries);
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const contextLabels = { upload: t('detail.uploadFiles'), uploadFolder: t('detail.uploadFolder'), rename: t('detail.rename'), inspect: t('detail.reinspect'), inspectAll: t('detail.inspectAll'), delete: t('detail.delete'), newFolder: t('detail.newFolder') };
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('list.backToPacks')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{pack.name}</h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {t(`primaryCategories.${pack.primaryCategory}`)} · {pack.styles.join(' · ')}{pack.gameTypes?.length ? ` · ${pack.gameTypes[0]}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex overflow-hidden rounded-lg border border-border bg-background">
          <button ref={editPackButtonRef} type="button" className="h-9 border-0 px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent" onClick={event => { event.currentTarget.focus(); onEditPack(); }}>{t('list.editPack')}</button>
          <button type="button" disabled={pack.status === 'published'} className="h-9 border-l border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:text-muted-foreground" onClick={() => void onPublish()}>{t(pack.status === 'archived' ? 'list.republish' : 'list.publish')}</button>
          </div>
          {apiClient.getCurationQueue ? <button type="button" onClick={() => setCurationOpen(true)} className="h-9 rounded-lg border border-info-500/30 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted dark:text-foreground">{t('list.curation')}{pendingCurationCount ? ` · ${pendingCurationCount}` : ''}</button> : null}
          {pack.status !== 'archived' ? <button type="button" onClick={() => void onArchivePack()} className="h-9 rounded-lg border border-warning/40 px-3 text-xs font-medium text-warning transition-colors hover:bg-warning/10">{t('list.archivePack')}</button> : <span className="text-xs text-warning">{t('list.archived')}</span>}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="flex min-h-0 max-h-64 flex-col overflow-hidden border-b border-border bg-surface-1 md:max-h-none md:border-b-0 md:border-r">
          <div ref={explorerHostRef} className="min-h-0 flex-1 overflow-hidden"><ResourcePackExplorer tree={explorerTree} height={explorerHeight} selectedElementId={selectedElement?.id} selectedElementIds={selectedElementIds} onElement={onElement} onSelectionChange={(items) => { setSelectedElementIds(items.map(item => item.id)); if (items.length !== 1) onClearElement(); }} labels={contextLabels} onCreateFolder={() => setRenameTarget({ type: 'folder', mode: 'create', name: '' })} onUploadToFolder={startFolderUpload} onUploadFolderToFolder={startFolderDirectoryUpload} onDropFilesToFolder={(files, node) => { if (!node.folder) return; const category = elements.find(element => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'models'; onAddFiles(files, { category, folderPath: node.folder.path }); }} onRenameFolder={(node) => node.folder && renameFolder(node.folder)} onDeleteFolder={(node) => node.folder && void deleteFolder(node.folder)} onRenameElement={renameElement} onInspectElement={(element) => { setMoveError(''); void apiClient.inspectElement(pack.id, element.id).then(async updated => { await onRefreshWorkspace(); if (selectedElement?.id === updated.id) onElement(updated); }).catch(cause => setMoveError(cause instanceof Error ? cause.message : String(cause))); }} onInspectAll={() => { void inspectUnprocessedElements(); }} onDeleteElement={(element) => void deleteElement(element)} onMoveElements={(items, node) => node.folder && void moveElements(items, node.folder)} /></div>
          <input ref={fileInputRef} aria-label={t('list.selectFiles')} type="file" multiple className="hidden" onChange={(event) => { onAddFiles(Array.from(event.target.files || []), uploadDestination); event.target.value = ''; }} />
          <input ref={folderInputRef} aria-label={t('list.selectFolder')} type="file" multiple {...directoryInputAttributes} className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadDirectorySelection(files); }} />
        </aside>
        <main className="relative min-h-0 min-w-0 overflow-hidden bg-muted/30" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropFiles(Array.from(event.dataTransfer.files), uploadDestination); }}>
          {error || moveError ? (
            <div role="alert" className="type-callout absolute left-4 right-4 top-4 z-30 rounded-xl bg-destructive/10 p-3 text-destructive shadow-lg">
              {error || moveError}
            </div>
          ) : null}
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-muted/30">
            {selectedElements.length > 1 ? <BatchElementInspector pack={pack} elements={selectedElements} usageTagOptions={usageTagOptions} onApply={async (input) => {
              const results = await Promise.allSettled(selectedElements.map(element => onUpdateElement(element.id, {
                ...(input.kind ? { kind: input.kind } : {}),
                ...(input.status ? { status: input.status } : {}),
                ...(input.dimensionOverride ? { dimensionOverride: input.dimensionOverride } : {}),
                ...(input.styleOverride !== undefined ? { styleOverride: input.styleOverride } : {}),
                ...((input.addUsageTags?.length || input.removeUsageTags?.length) ? { usageTags: [...new Set(normaliseUsageTags(element.usageTags).filter(tag => !input.removeUsageTags?.includes(tag)).concat(input.addUsageTags || []))] } : {}),
              })));
              const failed = results.filter(result => result.status === 'rejected').length;
              if (failed) setMoveError(t('errors.batchSaveFailed', { count: failed }));
              else await onRefreshWorkspace();
            }} /> : null}
            {selectedElements.length > 1 ? null : selectedElement ? (
              resourceUrl && (!isModelElement(selectedElement) || externalResourcesReady) ? <Preview element={selectedElement} pack={pack} url={resourceUrl} elements={elements} usageTagOptions={usageTagOptions} materialTextureBindings={materialTextureBindings} textureUrls={boundTextureUrls} externalResourceUrls={externalResources.urls} inspectorOpen={inspectorOpen} onOpenInspector={() => setInspectorOpen(true)} onCloseInspector={() => setInspectorOpen(false)} onMetrics={saveMetrics} onSave={onUpdateElement} /> : resourceError ? <div role="alert" className="grid place-items-center gap-3 text-center type-footnote text-destructive"><span>{resourceError}</span><button type="button" aria-label={t('list.retryPreview')} onClick={() => setResourceAttempt(current => current + 1)} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-3 py-1.5">{t('list.retry')}</button></div> : <div className="type-footnote text-muted-foreground">{t('list.loadingPreview')}</div>
            ) : (
              loading ? <div className="type-footnote text-muted-foreground">{t('list.loadingWorkspace')}</div> : <EmptyPreviewState />
            )}
          </div>
        </main>
      </div>
      {uploadStatus ? <UploadProgressCover status={uploadStatus} onRetryFailed={onRetryFailedUploads} onCancel={onCancelUploads} onDismiss={onDismissUploads} /> : null}
      {inspectionJob ? <InspectionProgressCover job={inspectionJob} elements={elements} onClose={() => setInspectionJob(null)} onCancel={async () => setInspectionJob(await apiClient.cancelProcessingJob(pack.id, inspectionJob.id))} onRetry={async () => setInspectionJob(await apiClient.retryProcessingJob(pack.id, inspectionJob.id))} /> : null}
      {curationOpen && apiClient.getCurationQueue ? <CurationWorkbench packId={pack.id} api={apiClient as ResourceCurationApi} onClose={() => { setCurationOpen(false); void onRefreshWorkspace(); void apiClient.getCurationQueue?.(pack.id).then(queue => setPendingCurationCount(queue.counts.pendingItems)); }} /> : null}
      {renameTarget ? <RenameResourceDialog open resourceType={renameTarget.type} mode={renameTarget.mode} initialName={renameTarget.name} onClose={() => setRenameTarget(null)} onRename={async (name) => { if (renameTarget.mode === 'create') { await onCreateFolder(name); return; } if (renameTarget.folder) { if (name !== renameTarget.folder.name) { await apiClient.updateFolder(pack.id, renameTarget.folder.id, { name }); await onRefreshWorkspace(); } return; } if (renameTarget.element) { if (name === renameTarget.element.name) return; const separator = renameTarget.element.path.lastIndexOf('/'); await onUpdateElement(renameTarget.element.id, { name, path: `${separator >= 0 ? renameTarget.element.path.slice(0, separator + 1) : ''}${name}` }); } }} /> : null}
    </section>
  );
}

function InspectionProgressCover({ job, elements, onClose, onCancel, onRetry }: { job: ResourceProcessingJob; elements: readonly ResourceElement[]; onClose: () => void; onCancel: () => Promise<void>; onRetry: () => Promise<void> }) {
  const { t } = useTranslation('resourceLibrary');
  const done = job.completedItems + job.failedItems;
  const active = job.status === 'queued' || job.status === 'running';
  const percent = job.totalItems ? Math.round(done / job.totalItems * 100) : 100;
  const names = new Map(elements.map(element => [element.id, element.name]));
  return <div role="status" aria-live="polite" aria-label={t('detail.analyzing')} className="fixed inset-0 z-[100] grid place-items-center bg-background/95 p-5"><div className="flex w-full max-w-md flex-col items-center text-center"><span aria-hidden="true" className={`h-12 w-12 rounded-full border-2 border-border ${job.status === 'failed' ? 'border-t-destructive' : 'border-t-warning'} ${active ? 'animate-spin' : ''}`} /><p className="type-headline mt-4 text-foreground">{percent}%</p><p className="type-caption-2 mt-2 text-muted-foreground">{done} / {job.totalItems}{job.failedItems ? ` · ${job.failedItems} ${t('detail.failed')}` : ''}</p>{job.failures?.length ? <div className="mt-4 max-h-48 w-full space-y-2 overflow-y-auto rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-left">{job.failures.map(failure => <div key={failure.elementId} className="min-w-0"><p className="type-footnote truncate text-foreground">{names.get(failure.elementId) || failure.elementId}</p><p className="type-caption-2 mt-0.5 break-words text-destructive/75">{failure.error}</p></div>)}</div> : null}<div className="mt-5 flex gap-3">{active ? <button type="button" onClick={() => void onCancel()} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2">{t('detail.cancel')}</button> : null}{job.status === 'failed' ? <button type="button" onClick={() => void onRetry()} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button px-4 py-2">{t('detail.retryFailed')}</button> : null}{!active ? <button type="button" onClick={onClose} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2">{t('detail.done')}</button> : null}</div></div></div>;
}

function UploadProgressCover({ status, onRetryFailed, onCancel, onDismiss }: { status: ElementUploadStatus; onRetryFailed: () => void; onCancel: () => void; onDismiss: () => void }) {
  const { t } = useTranslation('resourceLibrary');
  const percent = status.total ? Math.min(100, Math.round(status.done / status.total * 100)) : 0;
  const bytePercent = status.bytesTotal ? Math.min(100, Math.round((status.bytesDone || 0) / status.bytesTotal * 100)) : undefined;
  return <div role="status" aria-live="polite" aria-label={t('detail.uploading')} className="fixed inset-0 z-[100] grid place-items-center bg-background/95">
    <div className="flex flex-col items-center text-center">
      <span aria-hidden="true" className={`h-12 w-12 rounded-full border-2 border-border border-t-warning ${status.phase === 'uploading' ? 'animate-spin' : ''} ${status.phase === 'failed' ? 'border-t-destructive' : status.phase === 'complete' ? 'border-t-success' : ''}`} />
      <p className="type-headline mt-4 text-foreground">{percent}%</p>
      {status.phase === 'uploading' && status.activeFileName ? <p className="type-caption-2 mt-2 max-w-72 truncate text-muted-foreground">{status.activeFileName}{bytePercent !== undefined ? ` · ${bytePercent}%` : ''}</p> : null}
      {status.phase === 'failed' || status.phase === 'cancelled' ? <div className="mt-5 flex items-center gap-3"><button type="button" onClick={onDismiss} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2 text-foreground">{t(status.phase === 'cancelled' ? 'detail.endUpload' : 'detail.close')}</button><button type="button" onClick={onRetryFailed} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2 text-destructive">{t(status.phase === 'cancelled' ? 'detail.resumeUpload' : 'detail.retryFailedFiles')}</button></div> : null}
      {status.phase === 'uploading' ? <button type="button" onClick={onCancel} className="type-caption-2 mt-5 text-muted-foreground hover:text-foreground">{t('detail.cancelRemaining')}</button> : null}
    </div>
  </div>;
}

function ArchivePackDialog({ pack, impact, onClose, onArchive }: { pack: ResourcePackSummary; impact: BeeGameResourcePackImpactPayload; onClose: () => void; onArchive: () => Promise<void> }) {
  const { t } = useTranslation('resourceLibrary');
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent aria-label={t('list.archivePack')} className="max-w-md p-6"><div className="w-full text-foreground"><DialogTitle className="text-lg">{t('detail.archiveTitle', { name: pack.name })}</DialogTitle><p className="mt-3 text-sm text-muted-foreground">{t('detail.archiveHint')}</p>{impact.references.length ? <div className="mt-4 max-h-44 overflow-y-auto rounded-lg border border-warning-500/30 bg-muted p-3"><p className="text-sm text-warning">{t('detail.archiveReferences', { count: impact.projectCount })}</p><div className="mt-2 space-y-1">{impact.references.map(reference => <p key={`${reference.projectId}:${reference.resourceId}`} className="text-xs text-muted-foreground">{reference.projectName} · {reference.resourceId} · v{reference.packVersion}</p>)}</div></div> : <p className="mt-4 text-sm text-muted-foreground">{t('detail.archiveNone')}</p>}{impact.unreadableProjects.length ? <div className="mt-4 rounded-lg border border-warning-500/30 bg-muted p-3"><p className="text-sm text-warning">{t('detail.archiveInvalid', { count: impact.unreadableProjects.length })}</p><div className="mt-2 space-y-1">{impact.unreadableProjects.map(project => <p key={project.projectId} className="text-xs text-muted-foreground">{project.projectName}</p>)}</div></div> : null}{error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" disabled={archiving} onClick={onClose} className="rounded-md border border-border bg-secondary text-secondary-foreground type-button px-4 py-2">{t('detail.cancel')}</button><button type="button" disabled={archiving} onClick={() => { setArchiving(true); void onArchive().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setArchiving(false)); }} className="rounded-lg border border-warning-500/30 bg-muted px-4 py-2 text-sm text-warning disabled:opacity-60">{t(archiving ? 'detail.archiving' : 'detail.confirmArchive')}</button></div></div></DialogContent></Dialog>
}

function BatchElementInspector({ pack, elements, usageTagOptions, onApply }: { pack: ResourcePackSummary; elements: ResourceElement[]; usageTagOptions: readonly string[]; onApply: (input: { kind?: string; status?: string; dimensionOverride?: ResourceElement['dimensionOverride']; styleOverride?: string | null; addUsageTags?: string[]; removeUsageTags?: string[] }) => Promise<void> }) {
  const { t } = useTranslation('resourceLibrary');
  const commonKind = elements.every(element => element.kind === elements[0]?.kind) ? elements[0]?.kind || '' : '';
  const commonStatus = elements.every(element => element.status === elements[0]?.status) ? elements[0]?.status || '' : '';
  const commonDimension = elements.every(element => (element.dimensionOverride || 'agnostic') === (elements[0]?.dimensionOverride || 'agnostic')) ? elements[0]?.dimensionOverride || 'agnostic' : '';
  const commonStyle = elements.every(element => (element.styleOverride || '') === (elements[0]?.styleOverride || '')) ? elements[0]?.styleOverride || '' : '';
  const commonUsageTags = useMemo(() => {
    const first = normaliseUsageTags(elements[0]?.usageTags);
    return first.filter(tag => elements.every(element => normaliseUsageTags(element.usageTags).includes(tag)));
  }, [elements]);
  const [kind, setKind] = useState(commonKind);
  const [status, setStatus] = useState(commonStatus);
  const [dimensionOverride, setDimensionOverride] = useState<ResourceElement['dimensionOverride'] | ''>(commonDimension);
  const [styleMode, setStyleMode] = useState<'keep' | 'inherit' | 'replace'>('keep');
  const [styleOverride, setStyleOverride] = useState<string[]>(() => decodeStyleOverride(commonStyle));
  const [usageTags, setUsageTags] = useState<string[]>(commonUsageTags);
  const [initialUsageTags, setInitialUsageTags] = useState<string[]>(commonUsageTags);
  const [usageMenuOpen, setUsageMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setKind(commonKind); setStatus(commonStatus); setDimensionOverride(commonDimension); setStyleMode('keep'); setStyleOverride(decodeStyleOverride(commonStyle)); setUsageTags(commonUsageTags); setInitialUsageTags(commonUsageTags); setUsageMenuOpen(false); }, [commonDimension, commonKind, commonStatus, commonStyle, commonUsageTags]);
  const addedUsageTags = usageTags.filter(tag => !initialUsageTags.includes(tag));
  const removedUsageTags = initialUsageTags.filter(tag => !usageTags.includes(tag));
  const styles = packStyleOptions(pack.styles, styleOverride);
  const changed = Boolean(kind || status || dimensionOverride || styleMode !== 'keep' || addedUsageTags.length || removedUsageTags.length);
  const apply = async () => { if (!changed) return; setSaving(true); try { await onApply({ ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(dimensionOverride ? { dimensionOverride } : {}), ...(styleMode === 'inherit' ? { styleOverride: null } : styleMode === 'replace' ? { styleOverride: encodeStyleOverride(styleOverride) } : {}), ...(addedUsageTags.length ? { addUsageTags: addedUsageTags } : {}), ...(removedUsageTags.length ? { removeUsageTags: removedUsageTags } : {}) }); } finally { setSaving(false); } };
  return <aside aria-label={t('detail.batchEdit', { count: elements.length })} className="absolute inset-x-3 top-1/2 z-20 mx-auto min-w-0 max-w-[420px] -translate-y-1/2 rounded-xl border border-border bg-background p-4 text-foreground shadow-lg">
    <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-medium text-foreground">{t('detail.batchEdit', { count: elements.length })}</div><p className="mt-1 text-xs text-muted-foreground">{t('detail.batchHint')}</p></div><span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">{elements.length}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3"><ResourceSelectField label={t('detail.resourceKind')} value={kind} onValueChange={setKind} options={[['', t('detail.selectMixed')], ...resourceFormOptions.map(([value, label]) => [value, t(`resourceKinds.${value}`, { defaultValue: label })] as const)]} /><ResourceSelectField label={t('detail.status')} value={status} onValueChange={setStatus} options={[['', t('detail.selectMixed')], ['ready', t('detail.ready')], ['hidden', t('detail.hidden')], ['archived', t('list.archived')]]} /></div>
    <div className="mt-3"><ResourceSelectField label={t('detail.dimensionOverride')} value={dimensionOverride ?? ''} onValueChange={value => setDimensionOverride(value as ResourceElement['dimensionOverride'] | '')} options={[['', t('detail.selectMixed')], ['agnostic', t('detail.inheritPack')], ['2D', '2D'], ['3D', '3D']]} /></div>
    <div className="mt-3 grid gap-1"><ResourceSelectField label={t('detail.styleOverride')} value={styleMode} onValueChange={value => setStyleMode(value as typeof styleMode)} options={[['keep', t('detail.keepExisting')], ['inherit', t('detail.inheritAllStyles')], ['replace', t('detail.replaceStyles')]]} />{styleMode === 'replace' ? <StyleOverrideMultiSelect values={styleOverride} options={styles} onChange={setStyleOverride} /> : null}</div>
    <div className="mt-3 grid min-w-0 gap-1"><span className="type-caption-2 text-muted-foreground">{t('detail.selectedCommonUsage')}</span><UsageTagMultiSelect values={usageTags} options={usageTagOptions} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /></div>
    <button type="button" disabled={saving || !changed} onClick={() => void apply()} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button mt-4 w-full px-3 py-2 disabled:opacity-50">{t(saving ? 'detail.applying' : 'detail.applySelected')}</button>
  </aside>
}

function StyleOverrideMultiSelect({ values, options, onChange }: { values: string[]; options: readonly string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{options.map(option => <button key={option} type="button" aria-pressed={values.includes(option)} onClick={() => toggle(option)} className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${values.includes(option) ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}>{option}</button>)}</div>;
}

function ResourceSelectField({ label, value, onValueChange, options }: { label: string; value: string; onValueChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <div className="grid gap-1"><span className="text-xs text-muted-foreground">{label}</span><ProjectSelect ariaLabel={label} value={value} onValueChange={onValueChange} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} className="min-w-0" triggerClassName="h-8 rounded-md px-2 text-xs" /></div>;
}

function UsageTagMultiSelect({ values, options, open, onOpenChange, onChange }: { values: string[]; options: readonly string[]; open: boolean; onOpenChange: (open: boolean) => void; onChange: (values: string[]) => void }) {
  const { t } = useTranslation('resourceLibrary');
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabels = values;
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(tag => tag !== value) : [...values, value]);
  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onOpenChange]);
  return <div ref={rootRef} className="relative min-w-0 max-w-full"><button type="button" aria-label={t('detail.usage')} aria-expanded={open} aria-haspopup="listbox" title={selectedLabels.join(' · ')} onClick={() => onOpenChange(!open)} className="flex min-h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg border border-input bg-background px-2 py-1 text-left text-xs"><span className={`min-w-0 flex-1 truncate ${selectedLabels.length ? 'text-foreground' : 'text-muted-foreground'}`}>{selectedLabels.length ? selectedLabels.join(' · ')  : t('detail.selectUsage')}</span><span className="shrink-0 text-muted-foreground">⌄</span></button>{open ? <div role="listbox" aria-multiselectable="true" className="absolute inset-x-0 z-30 mt-1 max-h-56 min-w-0 overflow-y-auto rounded-lg border border-border bg-background p-1.5 shadow-lg">{options.map(value => <button key={value} type="button" role="option" aria-selected={values.includes(value)} onClick={() => toggle(value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${values.includes(value) ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border'}`}>{values.includes(value) ? '✓' : null}</span>{value}</button>)}</div> : null}</div>;
}

function Preview({ element, pack, url, elements, usageTagOptions, materialTextureBindings, textureUrls, externalResourceUrls, inspectorOpen, onOpenInspector, onCloseInspector, onMetrics, onSave }: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  url: string;
  elements: ResourceElement[];
  usageTagOptions: readonly string[];
  materialTextureBindings: MaterialTextureBindings;
  textureUrls: Readonly<Record<string, string>>;
  externalResourceUrls: Readonly<Record<string, string>>;
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onCloseInspector: () => void;
  onMetrics: (metrics: ModelMetrics) => void;
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
}) {
  const { t } = useTranslation('resourceLibrary');
  return (
    <div className="relative h-full w-full min-h-0 bg-muted/20">
      <FileInfoOverlay element={element} />
      {!inspectorOpen ? <button type="button" aria-label={t('detail.showInfo')} title={t('detail.elementInfo')} onClick={onOpenInspector} className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"><Info className="h-4 w-4" /></button> : null}
      <div className="h-full min-h-0 w-full"><ResourcePreview element={element} url={url} onMetrics={onMetrics} materialTextureBindings={materialTextureBindings} textureUrls={textureUrls} externalResourceUrls={externalResourceUrls} externalReferences={parseExternalReferences(element.specs.externalReferences)} onPreviewError={(error) => { console.error('Resource preview failed', { elementId: element.id, name: element.name, error }); if (element.specs.previewStatus !== 'failed') void onSave(element.id, { specs: { ...element.specs, previewStatus: 'failed', previewError: error.message || 'Preview loading failed' } }); }} /></div>
      {inspectorOpen ? <ResourceInspectorOverlay element={element} pack={pack} elements={elements} usageTagOptions={usageTagOptions} onSave={onSave} onClose={onCloseInspector} /> : null}
    </div>
  );
}

function FileInfoOverlay({ element }: { element: ResourceElement }) {
  const { t } = useTranslation('resourceLibrary');
  const extension = typeof element.specs.extension === 'string' ? element.specs.extension : element.name.includes('.') ? element.name.split('.').pop() : '—';
  const size = typeof element.specs.size === 'number' ? formatFileSize(element.specs.size) : '—';
  const triangles = typeof element.specs.triangles === 'number' ? String(element.specs.triangles) : '—';
  const materials = typeof element.specs.materialCount === 'number' ? String(element.specs.materialCount) : '—';
  return <div className="absolute left-4 top-4 z-10 min-w-44 rounded-lg border border-border bg-background/95 px-3 py-2.5 text-xs text-muted-foreground shadow-sm"><div className="truncate font-medium text-foreground">{element.name}</div><div>{t('detail.extension')}: {extension}</div><div>{t('detail.size')}: {size}</div>{isModelElement(element) ? <><div>{t('detail.triangles')}: {triangles}</div><div>{t('detail.materials')}: {materials}</div></> : null}</div>;
}

function EmptyPreviewState() {
  const { t } = useTranslation('resourceLibrary');
  return <div className="flex max-w-sm flex-col items-center text-center"><div className="mb-3 grid h-12 w-12 place-items-center rounded-lg border border-border bg-muted text-muted-foreground"><File className="h-5 w-5" /></div><div className="text-sm font-semibold text-foreground">{t('detail.emptyPreview')}</div><p className="mt-1 text-xs text-muted-foreground">{t('detail.emptyPreviewHint')}</p></div>;
}

function isModelElement(element: ResourceElement) {
  return isSupportedModelPreview(element);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ResourceInspectorOverlay({
  element,
  pack,
  elements,
  usageTagOptions,
  onSave,
  onClose,
}: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  elements: ResourceElement[];
  usageTagOptions: readonly string[];
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('resourceLibrary');
  const [kind, setKind] = useState(element.kind);
  const [assetKind, setAssetKind] = useState(element.assetKind || '');
  const [capabilities, setCapabilities] = useState<string[]>(() => [...(element.capabilities ?? [])]);
  const [contentProfile, setContentProfile] = useState(element.contentProfile);
  const [relations, setRelations] = useState(() => [...(element.relations ?? [])]);
  const [usageTags, setUsageTags] = useState<string[]>(() => normaliseUsageTags(element.usageTags));
  const [usageTagsMode, setUsageTagsMode] = useState<ResourceElement['usageTagsMode']>(() => element.usageTagsMode || (element.usageTags?.length ? 'override' : 'inherit'));
  const [usageMenuOpen, setUsageMenuOpen] = useState(false);
  const [styleOverride, setStyleOverride] = useState<string[]>(() => decodeStyleOverride(element.styleOverride));
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [customStyle, setCustomStyle] = useState('');
  const [dimensionOverride, setDimensionOverride] = useState(element.dimensionOverride || 'agnostic');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'config'>('info');
  const [materialBindings, setMaterialBindings] = useState<MaterialTextureBindings>(() => decodeMaterialTextureBindings(element.specs.materialTextureBindings));
  const [dependencyBindings, setDependencyBindings] = useState(() => element.dependencyBindings ? [...element.dependencyBindings] : []);
  useEffect(() => { setKind(element.kind); setAssetKind(element.assetKind || ''); setCapabilities([...(element.capabilities ?? [])]); setContentProfile(element.contentProfile); setRelations([...(element.relations ?? [])]); setUsageTags(normaliseUsageTags(element.usageTags)); setUsageTagsMode(element.usageTagsMode || (element.usageTags?.length ? 'override' : 'inherit')); setUsageMenuOpen(false); setStyleOverride(decodeStyleOverride(element.styleOverride)); setStyleMenuOpen(false); setCustomStyle(''); setDimensionOverride(element.dimensionOverride || 'agnostic'); setMaterialBindings(decodeMaterialTextureBindings(element.specs.materialTextureBindings)); setDependencyBindings(element.dependencyBindings ? [...element.dependencyBindings] : []); }, [element]);
  const save = async () => { setSaving(true); try { const dependencies = [...new Set([...element.dependencies, ...Object.values(materialBindings).flatMap(binding => binding.baseColor ? [binding.baseColor] : []), ...dependencyBindings.map(binding => binding.dependencyElementId)])]; await onSave(element.id, { kind, assetKind: assetKind || null, capabilities, contentProfile, relations, usageTags: usageTagsMode === 'override' ? usageTags : [], usageTagsMode, styleOverride: encodeStyleOverride(styleOverride), dimensionOverride: dimensionOverride as ResourceElement['dimensionOverride'], specs: { ...element.specs, materialTextureBindings: encodeMaterialTextureBindings(materialBindings) }, dependencies, dependencyBindings }); } finally { setSaving(false); } };
  const styleOptions = packStyleOptions(pack.styles, styleOverride);
  return (
    <aside
      role="complementary"
      aria-label={t('detail.elementProperties')}
      className="absolute inset-x-3 bottom-3 mx-auto max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-background/95 p-3 text-foreground shadow-lg md:inset-x-auto md:right-3 md:mx-0"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <button
            type="button"
            aria-label={element.name}
            className="text-sm font-medium text-left text-foreground"
          >
            {element.name}
          </button>
          <div className="mt-1 text-xs text-muted-foreground">
            {t(`categories.${element.category}`, { defaultValue: element.category })} / {element.kind}
          </div>
        </div>
        <button type="button" aria-label={t('detail.closeInfo')} onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'info' | 'config')}>
      <TabsList className="mb-3 h-9 rounded-lg border border-border bg-muted p-0.5" aria-label={t('detail.elementPanel')}>
        <TabsTrigger value="info" className="flex-1 rounded-md px-2 py-1.5 text-xs data-[active]:bg-background data-[active]:shadow-sm">{t('detail.elementInfo')}</TabsTrigger>
        <TabsTrigger value="config" className="flex-1 rounded-md px-2 py-1.5 text-xs data-[active]:bg-background data-[active]:shadow-sm">{t('detail.elementConfig')}</TabsTrigger>
      </TabsList>
      <TabsContent value="info"><InspectorInfoTab element={element} elements={elements} /></TabsContent>
      <TabsContent value="config" className="space-y-3 border-t border-border pt-3">
        <div className="grid gap-1"><ResourceSelectField label={t('detail.usage')} value={usageTagsMode ?? 'inherit'} onValueChange={value => setUsageTagsMode(value as ResourceElement['usageTagsMode'])} options={[["inherit", t('detail.uncategorizedNoMatch')], ['override', t('detail.elementTags')], ['manual-only', t('detail.manualOnly')]]} />{usageTagsMode === 'override' ? <UsageTagMultiSelect values={usageTags} options={usageTagOptions} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /> : null}<span className="type-caption-2 text-muted-foreground">{t('detail.currentSource')}: {t(element.usageTagsSource === 'element' ? 'detail.elementTags' : 'detail.notSet')}</span></div>
        <ResourceSelectField label={t('detail.resourceKind')} value={kind} onValueChange={setKind} options={(!resourceFormOptions.some(([value]) => value === kind) ? [[kind, kind] as const, ...resourceFormOptions] : resourceFormOptions).map(([value, label]) => [value, t(`resourceKinds.${value}`, { defaultValue: label })] as const)} />
        <div className="grid gap-1"><ResourceSelectField label={t('detail.assetKind')} value={assetKind} onValueChange={setAssetKind} options={[["", t('detail.notCategorized')] as const, ...assetKindOptions.map(([value, label]) => [value, t(`assetKinds.${value}`, { defaultValue: label })] as const)]} /><span className="type-caption-2 text-muted-foreground">{t('detail.assetKindHint')}</span></div>
        <ElementCapabilityEditor values={capabilities} onChange={setCapabilities} />
        <EmbeddedComponentRoleEditor profile={contentProfile} onChange={setContentProfile} />
        <SemanticRelationsEditor element={element} elements={elements} relations={relations} onChange={setRelations} />
        <div className="grid gap-1"><span className="type-caption-2 text-muted-foreground">{t('detail.styleOverride')}</span><div className="relative"><button type="button" aria-expanded={styleMenuOpen} aria-haspopup="menu" onClick={() => setStyleMenuOpen(open => !open)} className="border border-input bg-background flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left type-caption-2"><span className="truncate">{styleOverride.length ? styleOverride.join(' · ') : t('detail.inheritStyles', { styles: pack.styles.join(' · ') })}</span><span className="text-muted-foreground">⌄</span></button>{styleMenuOpen ? <div role="menu" className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-background p-1.5 shadow-lg">{styleOptions.map(option => <button key={option} type="button" role="menuitemcheckbox" aria-checked={styleOverride.includes(option)} onClick={() => setStyleOverride(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option])} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption-2 text-foreground hover:bg-accent"><span className={`grid h-3.5 w-3.5 place-items-center rounded border ${styleOverride.includes(option) ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border'}`}>{styleOverride.includes(option) ? '✓' : null}</span>{option}</button>)}</div> : null}</div><div className="flex gap-1.5"><input aria-label={t('detail.customOverrideStyle')} value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="border border-input bg-background min-w-0 flex-1 rounded-lg px-2 py-1 type-input min-[900px]:text-md" placeholder={t('customStyle')} /><button type="button" onClick={() => { const value = customStyle.trim(); if (value) setStyleOverride(current => current.includes(value) ? current : [...current, value]); setCustomStyle(''); }} className="rounded-md border border-border bg-secondary text-secondary-foreground px-2 type-caption-2">{t('add')}</button></div><span className="type-caption-2 text-muted-foreground">{t('detail.inheritStyleHint')}</span></div>
        <div className="grid gap-1"><ResourceSelectField label={t('detail.dimensionOverride')} value={dimensionOverride} onValueChange={value => setDimensionOverride(value as '2D' | '3D' | 'agnostic')} options={[["agnostic", t('detail.inheritPack')], ['2D', '2D'], ['3D', '3D']]} /><span className="type-caption-2 text-muted-foreground">{t('detail.current')}: <span>{dimensionOverride === 'agnostic' ? pack.dimension : dimensionOverride}</span></span></div>
        {isModelElement(element) ? <ModelMaterialBindings specs={element.specs} elements={elements} bindings={materialBindings} onBindingChange={setMaterialBindings} /> : null}
        <ExternalDependencyBindings specs={element.specs} elements={elements} bindings={dependencyBindings} onChange={setDependencyBindings} />
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-md border border-transparent bg-primary text-primary-foreground type-button w-full px-3 py-2 disabled:opacity-50">{t(saving ? 'detail.saving' : 'detail.saveConfig')}</button>
      </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmbeddedComponentRoleEditor({ profile, onChange }: { profile: ResourceElement['contentProfile']; onChange: (profile: ResourceElement['contentProfile']) => void }) {
  const { t } = useTranslation('resourceLibrary');
  if (!profile?.components.length) return null;
  const editable = profile.components.filter(component => ['animation-clip', 'scene-node', 'collider', 'morph-target'].includes(component.kind));
  if (!editable.length) return null;
  return <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5"><div className="type-caption-2 font-medium text-foreground">{t('detail.internalRoles')}</div><p className="type-caption-2 text-muted-foreground">{t('detail.internalRolesHint')}</p>{editable.map(component => <label key={component.id} className="grid gap-1"><span className="type-caption-2 truncate text-muted-foreground">{component.kind} · {component.name || component.id}</span><input value={(component.roles ?? []).join(', ')} onChange={(event) => { const roles = event.target.value.split(',').map(value => value.trim()).filter(Boolean); onChange({ ...profile, components: profile.components.map(item => item.id === component.id ? { ...item, roles } : item) }); }} className="border border-input bg-background rounded-lg px-2 py-1 type-caption-2" placeholder={t('detail.internalRolesExample')} /></label>)}</div>;
}

function ExternalDependencyBindings({ specs, elements, bindings, onChange }: { specs: ResourceElement['specs']; elements: ResourceElement[]; bindings: readonly NonNullable<ResourceElement['dependencyBindings']>[number][]; onChange: (bindings: Array<NonNullable<ResourceElement['dependencyBindings']>[number]>) => void }) {
  const { t } = useTranslation('resourceLibrary');
  const references = parseExternalReferences(specs.externalReferences);
  if (!references.length) return null;
  return <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5"><div className="type-caption-2 font-medium text-foreground">{t('detail.externalDependencies')}</div><p className="type-caption-2 text-muted-foreground">{t('detail.externalDependenciesHint')}</p>{references.map(reference => { const binding = bindings.find(item => item.referencePath === reference); return <div key={reference} className="grid gap-1"><span className="type-caption-2 truncate text-muted-foreground" title={reference}>{reference}</span><ProjectSelect ariaLabel={reference} value={binding?.dependencyElementId || ''} onValueChange={value => onChange(value ? [...bindings.filter(item => item.referencePath !== reference), { referencePath: reference, dependencyElementId: value }] : bindings.filter(item => item.referencePath !== reference))} options={[{ value: '', label: t('detail.unlinkedBlocksPublish') }, ...elements.filter(candidate => candidate.status === 'ready').map(candidate => ({ value: candidate.id, label: candidate.name }))]} triggerClassName="h-8 rounded-lg px-2 type-caption-2" /></div>})}</div>
}

function ElementCapabilityEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const { t } = useTranslation('resourceLibrary');
  return <div className="grid gap-1"><span className="type-caption-2 text-muted-foreground">{t('detail.capabilityTags')}</span><div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-border bg-muted/40 p-1.5">{capabilityOptions.map(([value, label]) => { const selected = values.includes(value); return <button key={value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? values.filter(item => item !== value) : [...values, value])} className={`rounded-md border px-1.5 py-1 type-caption-2 ${selected ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>{t(`capabilities.${value}`, { defaultValue: label })}</button>})}</div></div>;
}

function SemanticRelationsEditor({ element, elements, relations, onChange }: { element: ResourceElement; elements: ResourceElement[]; relations: Array<NonNullable<ResourceElement['relations']>[number]>; onChange: (relations: Array<NonNullable<ResourceElement['relations']>[number]>) => void }) {
  const { t } = useTranslation('resourceLibrary');
  const targets = elements.filter(candidate => candidate.id !== element.id && candidate.status === 'ready');
  const addRelation = () => {
    const target = targets[0];
    if (!target) return;
    onChange([...relations, { kind: relationKindOptions[0][0], targetElementId: target.id, required: true }]);
  };
  return <details className="rounded-lg border border-border bg-muted/40 p-2.5"><summary className="type-caption-2 cursor-pointer font-medium text-foreground">{t('detail.externalRelations')}</summary><p className="type-caption-2 mt-1.5 text-muted-foreground">{t('detail.relationHint')}</p><div className="mt-2 flex justify-end"><button type="button" onClick={addRelation} disabled={!targets.length} className="rounded-md border border-border bg-secondary text-secondary-foreground px-2 py-1 type-caption-2 disabled:opacity-40">{t('detail.addRelation')}</button></div>{relations.map((relation, index) => <div key={`${relation.kind}-${relation.targetElementId}-${index}`} className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1"><ProjectSelect ariaLabel={t('detail.relationType', { number: index + 1 })} value={relation.kind} onValueChange={value => onChange(relations.map((item, itemIndex) => itemIndex === index ? { ...item, kind: value } : item))} options={relationKindOptions.map(([value, label]) => ({ value, label: t(`relationKinds.${value}`, { defaultValue: label }) }))} className="min-w-0" triggerClassName="h-7 rounded-md px-1.5 type-caption-2" /><ProjectSelect ariaLabel={t('detail.relationTarget', { number: index + 1 })} value={relation.targetElementId} onValueChange={value => onChange(relations.map((item, itemIndex) => itemIndex === index ? { ...item, targetElementId: value } : item))} options={targets.map(target => ({ value: target.id, label: target.name }))} className="min-w-0" triggerClassName="h-7 rounded-md px-1.5 type-caption-2" /><button type="button" aria-label={t('detail.removeRelation', { number: index + 1 })} onClick={() => onChange(relations.filter((_, itemIndex) => itemIndex !== index))} className="grid place-items-center border border-border bg-background h-7 w-7"><X className="h-3.5 w-3.5" /></button></div>)}</details>;
}

function parseExternalReferences(...values: unknown[]): string[] {
  const references: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) references.push(...parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())));
      else references.push(...value.split(' · ').map(item => item.trim()).filter(Boolean));
    } catch { references.push(...value.split(' · ').map(item => item.trim()).filter(Boolean)); }
  }
  return [...new Set(references)];
}

function InspectorInfoTab({ element, elements }: { element: ResourceElement; elements: ResourceElement[] }) {
  const { t } = useTranslation('resourceLibrary');
  const bindings = decodeMaterialTextureBindings(element.specs.materialTextureBindings);
  const bindingValues = Object.entries(bindings).map(([slot, binding]) => `${slot} → ${elements.find(candidate => candidate.id === binding.baseColor)?.name || binding.baseColor}`);
  const usageLabels = normaliseUsageTags(element.usageTags);
  const assetKindLabel = element.assetKind ? t(`assetKinds.${element.assetKind}`, { defaultValue: element.assetKind }) : t('detail.notCategorized');
  const capabilityLabels = (element.capabilities ?? []).map(value => t(`capabilities.${value}`, { defaultValue: value }));
  const relationLabels = (element.relations ?? []).map(relation => `${t(`relationKinds.${relation.kind}`, { defaultValue: relation.kind })} → ${elements.find(candidate => candidate.id === relation.targetElementId)?.name || relation.targetElementId}`);
  const componentLabels = (element.contentProfile?.components ?? []).map(component => `${component.kind}${component.name ? ` · ${component.name}` : ''}${component.roles?.length ? ` · ${component.roles.join(' / ')}` : ''}`);
  return <div role="tabpanel" className="space-y-2 border-t border-border pt-3"><Property label={t('detail.semanticSource')} value={element.usageTagsSource === 'element' ? t('detail.elementTags') : t('detail.unsetNeedsCuration')} /><Property label={t('detail.path')} value={element.path} /><Property label={t('detail.status')} value={element.status} /><Property label={t('detail.resourceGroup')} value={t(`categories.${element.category}`, { defaultValue: element.category })} /><Property label={t('detail.deliveryType')} value={assetKindLabel} /><MetadataList label={t('detail.usage')} values={usageLabels} empty={t('detail.noUsage')} /><MetadataList label={t('detail.overallCapabilities')} values={capabilityLabels} empty={t('detail.noCapabilities')} /><Property label={t('detail.packaging')} value={element.contentProfile?.packaging || t('detail.notInspected')} /><MetadataList label={t('detail.internalContents')} values={componentLabels} empty={t('detail.notInspected')} /><MetadataList label={t('detail.externalRelations')} values={relationLabels} empty={t('detail.noRelations')} />{isModelElement(element) ? <ModelAssetMetadata specs={element.specs} bindings={bindingValues} /> : null}<MetadataList label={t('detail.specs')} values={Object.entries(element.specs).filter(([key]) => key !== 'materialTextureBindings' && key !== 'materialTextureCandidates' && key !== 'usageTags').map(([key, value]) => `${key}: ${value}`)} empty={t('detail.noSpecs')} /></div>
}

function ModelAssetMetadata({ specs, bindings }: { specs: ResourceElement['specs']; bindings: string[] }) {
  const { t } = useTranslation('resourceLibrary');
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? [...new Set(specs.materialSlots.split(' · '))] : [];
  const textureReferences = typeof specs.textureReferences === 'string' && specs.textureReferences ? specs.textureReferences.split(' · ') : [];
  const unresolved = typeof specs.unresolvedTextureReferences === 'string' && specs.unresolvedTextureReferences ? specs.unresolvedTextureReferences.split(' · ') : [];
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="type-caption-2 font-medium text-foreground">{t('detail.modelResource')}</div>
      <Property label={t('detail.vertices')} value={typeof specs.vertices === 'number' ? String(specs.vertices) : '—'} />
      <Property label={t('detail.triangles')} value={typeof specs.triangles === 'number' ? String(specs.triangles) : '—'} />
      <MetadataList label={t('detail.materialSlots')} values={materialSlots} empty={t('detail.noMaterials')} />
      <MetadataList label={t('detail.loadedTextures')} values={textureReferences} empty={t('detail.noEmbeddedTextures')} />
      {unresolved.length ? <MetadataList label={t('detail.unresolvedTextures')} values={unresolved} empty="" warning /> : null}
      <MetadataList label={t('detail.boundTextures')} values={bindings} empty={t('detail.noBoundTextures')} />
    </div>
  );
}

function ModelMaterialBindings({ specs, elements, bindings, onBindingChange }: { specs: ResourceElement['specs']; elements: ResourceElement[]; bindings: MaterialTextureBindings; onBindingChange: (bindings: MaterialTextureBindings) => void }) {
  const { t } = useTranslation('resourceLibrary');
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? [...new Set(specs.materialSlots.split(' · '))] : [];
  return <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5"><div className="type-caption-2 font-medium text-foreground">{t('detail.textureBindings')}</div><p className="type-caption-2 text-muted-foreground">{t('detail.textureBindingsHint')}</p>{materialSlots.map(slot => <div key={slot} className="grid gap-1"><span className="type-caption-2 text-muted-foreground">{slot} · {t('detail.baseColor')}</span><ProjectSelect ariaLabel={`${slot} · ${t('detail.baseColor')}`} value={bindings[slot]?.baseColor || ''} onValueChange={value => onBindingChange({ ...bindings, [slot]: value ? { baseColor: value } : {} })} options={[{ value: '', label: t('detail.unlinked') }, ...elements.filter(candidate => candidate.kind === 'image' || candidate.category === 'textures').map(candidate => ({ value: candidate.id, label: candidate.name }))]} triggerClassName="h-8 rounded-lg px-2 type-caption-2" /></div>)}</div>
}

function MetadataList({ label, values, empty, warning = false }: { label: string; values: string[]; empty: string; warning?: boolean }) {
  return <div className="grid gap-1"><span className="type-caption-2 text-muted-foreground">{label}</span>{values.length ? <div className="grid gap-1">{values.map((value, index) => <span key={`${index}:${value}`} title={value} className={`type-caption-2 truncate ${warning ? 'text-foreground' : 'text-foreground'}`}>{value}</span>)}</div> : <span className="type-caption-2 text-muted-foreground">{empty}</span>}</div>;
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="type-caption-2 text-muted-foreground">{label}</span>
      <span className="type-caption-2 max-w-[170px] truncate text-right text-foreground">
        {value}
      </span>
    </div>
  );
}
