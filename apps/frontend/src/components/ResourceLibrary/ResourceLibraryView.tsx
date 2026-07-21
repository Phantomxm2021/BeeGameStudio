import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, File, Info, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  ResourceLibraryApiError,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackPrimaryCategory,
  type ResourcePackSummary,
  type ResourceProcessingJob,
  type ResourcePublishReadiness,
} from '../../services/resourceLibraryApi';
import { CreateResourcePackDialog } from './CreateResourcePackDialog';
import { EditResourcePackDialog } from './EditResourcePackDialog';
import { RenameResourceDialog } from './RenameResourceDialog';
import { isSupportedModelPreview, ResourcePreview } from './ResourcePreview';
import { ResourcePackExplorer } from './ResourcePackExplorer';
import { buildExplorerTree } from './resourcePackExplorerTree';
import type { ModelMetrics } from './ModelPreview';
import { decodeMaterialTextureBindings, encodeMaterialTextureBindings, type MaterialTextureBindings } from './materialTextureBindings';
import { decodeStyleOverride, encodeStyleOverride, packStyleOptions } from './styleOverride';
import { closeResourcePackRoute, getResourcePackRoute, openResourcePackRoute } from './resourceLibraryRoute';
import { api as beeGameApi, type BeeGameResourcePackImpactPayload } from '../../services/api';
import { useToastContext } from '../../contexts/ToastContext';
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
>;

type ResourceLibraryViewProps = {
  apiClient?: ResourceLibraryApi;
  initialPackId?: string;
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


const categoryLabels: Record<string, string> = {
  sprites: '2D 图像与精灵',
  tilemaps: '场景与地图',
  scenes: '场景与地图',
  characters: '角色与生物',
  environment: '环境与道具',
  tiles: '场景与地图',
  models: '环境与道具',
  materials: '贴图与材质',
  animation: '动画',
  ui: 'UI',
  vfx: '特效',
  fonts: '字体',
  audio: '音频',
  textures: '贴图',
};

// "用途" describes the game responsibility of an asset. It is deliberately
// independent from the file form (model, texture, audio, etc.) and from the
// repository category used for storage and permissions.
const useDomainOptions = [
  ['character', '角色'], ['npc', 'NPC'], ['creature', '生物'],
  ['weapon-equipment', '武器与装备'], ['prop', '道具'], ['vehicle', '载具'],
  ['building', '建筑'], ['environment', '环境'], ['terrain', '地形'], ['vegetation', '植被'],
  ['scene', '场景'], ['level-map', '地图与关卡'], ['tile', '格子与关卡块'],
  ['ui', '界面'], ['icon', '图标'], ['effect', '视觉特效'],
  ['combat', '战斗'], ['interaction', '交互'], ['narrative', '叙事'],
  ['music', '音乐'], ['sound-effect', '音效'], ['ambient-audio', '环境音'], ['voice', '语音'],
] as const;
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

const primaryCategoryLabels: Record<'en' | 'zh', Record<ResourcePackPrimaryCategory, string>> = {
  en: {
    '2d-art': '2D Art Pack', '3d-assets': '3D Asset Pack', 'animation-rig': 'Animation/Rig Pack', 'ui-kit': 'UI Kit',
    vfx: 'VFX Pack', audio: 'Audio Pack', fonts: 'Font Pack', 'world-scene': 'World/Scene Pack', mixed: 'Mixed Resource Pack',
  },
  zh: {
    '2d-art': '2D 美术包', '3d-assets': '3D 资产包', 'animation-rig': '动画与骨骼包', 'ui-kit': 'UI Kit',
    vfx: 'VFX 包', audio: '音频包', fonts: '字体包', 'world-scene': '世界与场景包', mixed: '综合资源包',
  },
};

const primaryCategoryLabel = (primaryCategory: ResourcePackPrimaryCategory, isZh: boolean) => primaryCategoryLabels[isZh ? 'zh' : 'en'][primaryCategory];

export function ResourceLibraryView({ apiClient = resourceLibraryApi, initialPackId = getResourcePackRoute() }: ResourceLibraryViewProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const copy = isZh ? {
    all: '所有资源包', search: '搜索资源包', empty: '暂无资源包', emptyHint: '创建一个 Pack 后，按风格、类型和维度管理其中的资源。', previous: '上一页', next: '下一页',
    allDimensions: '全部维度', allStatuses: '全部状态', allGameTypes: '全部游戏类型', allTags: '全部标签', draft: '草稿', published: '已发布', archived: '已归档',
  } : {
    all: 'All resource packs', search: 'Search resource packs', empty: 'No resource packs', emptyHint: 'Create a Pack to manage its resources by style, type, and dimension.', previous: 'Previous', next: 'Next',
    allDimensions: 'All dimensions', allStatuses: 'All statuses', allGameTypes: 'All game types', allTags: 'All tags', draft: 'Draft', published: 'Published', archived: 'Archived',
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
        if (!cancelled) setError(err instanceof Error ? err.message : '资源包加载失败');
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
      if (session === packSessionRef.current) setError(err instanceof Error ? err.message : '资源包加载失败');
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
    const matchesQuery = !query.trim() || [pack.name, pack.style, ...(pack.gameTypes || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
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
        await saveResourceUploadTask({ ...task, status: 'cancelled', message: '上传已取消' });
        failed.push({ file, destination, message: '上传已取消', taskId: task.id });
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
        if (!next) throw lastError instanceof Error ? lastError : new Error('元素上传失败');
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
        const message = cancelUploadRef.current ? '上传已取消' : (err instanceof Error ? err.message : '元素上传失败');
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
      setError(`${failed.length} 个文件上传失败；请重试或检查文件与权限。`);
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
        failed: resumable.map((task) => ({ file: task.file, destination: task.destination, message: task.message || '等待继续上传', taskId: task.id })),
        phase: failed.length ? (failed.some((task) => task.status === 'failed') ? 'failed' : 'cancelled') : 'cancelled',
        bytesDone: 0,
        bytesTotal: resumable.reduce((total, task) => total + task.file.size, 0),
      });
    });
    return () => { disposed = true; };
  }, [selectedPack?.id]);

  if (selectedPack) {
    return (
      <>
      {editDialogOpen ? <EditResourcePackDialog open pack={selectedPack} onClose={() => setEditDialogOpen(false)} onUploadCover={async (file) => { const uploaded = await apiClient.uploadPackCover(selectedPack.id, file); setSelectedPack(uploaded); setPacks((current) => current.map((item) => item.id === uploaded.id ? uploaded : item)); return uploaded; }} onSave={async (input) => { const saved = await apiClient.updatePack(selectedPack.id, input); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); return saved; }} /> : null}
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
        isZh={isZh}
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
        onEditPack={() => setEditDialogOpen(true)}
        onUpdatePackDefaults={async (elementDefaults) => { const saved = await apiClient.updatePack(selectedPack.id, { elementDefaults }); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); }}
        onArchivePack={async () => { try { setArchiveImpact(await beeGameApi.getResourcePackImpact(selectedPack.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取引用项目'); } }}
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
    <section className="relative min-h-full bg-zinc-950 px-8 py-8 text-zinc-100">
      <CreateResourcePackDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} onCreate={async (input) => { const created = await apiClient.createPack(input); setPacks((current) => [created, ...current]); return created; }} />
      {error ? (
        <div
          role="alert"
          className="type-callout mb-5 rounded-2xl border border-red-300/20 bg-red-400/10 p-4 text-red-200"
        >
          {error}
        </div>
      ) : null}
      {loading && packs.length === 0 ? (
        <div className="type-caption-2 text-zinc-500">正在加载资源包…</div>
      ) : null}
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
        <div className="type-headline flex items-center gap-3">{copy.all} <button type="button" aria-label="创建 Pack" onClick={() => setCreateDialogOpen(true)} className="glass-icon-button h-8 w-8 text-lg">+</button></div>
        <div className="flex-1" />
        <label className="glass-control flex h-9 w-64 min-w-48 items-center gap-2 rounded-xl px-3 text-zinc-500">
          <Search className="h-4 w-4" />
          <input aria-label={copy.search} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={copy.search} className="type-input min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <div aria-label={copy.allDimensions} className="flex rounded-xl border border-white/10 p-0.5">
          {(['all', '2D', '3D'] as const).map((value) => (
            <button key={value} type="button" onClick={() => { setDimension(value); setPage(1); }} className={`type-caption-1 rounded-lg px-3 py-1.5 ${dimension === value ? 'bg-orange-400/10 text-orange-200' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {value === 'all' ? copy.allDimensions : value}
            </button>
          ))}
        </div>
        <select aria-label={copy.allStatuses} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} className="glass-control h-9 rounded-xl px-3 type-caption-2 text-zinc-300">
          <option value="all">{copy.allStatuses}</option>
          <option value="draft">{copy.draft}</option>
          <option value="published">{copy.published}</option>
          <option value="archived">{copy.archived}</option>
        </select>
        {gameTypeOptions.length > 0 ? <select aria-label={copy.allGameTypes} value={gameTypeFilter} onChange={(event) => { setGameTypeFilter(event.target.value); setPage(1); }} className="glass-control h-9 max-w-44 rounded-xl px-3 type-caption-2 text-zinc-300"><option value="">{copy.allGameTypes}</option>{gameTypeOptions.map((gameType) => <option key={gameType} value={gameType}>{gameType}</option>)}</select> : null}
        {tagOptions.length > 0 ? <select aria-label={copy.allTags} value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setPage(1); }} className="glass-control h-9 max-w-40 rounded-xl px-3 type-caption-2 text-zinc-300"><option value="">{copy.allTags}</option>{tagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select> : null}
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {pagedPacks.map((pack) => (
          <PackCard key={pack.id} pack={pack} isZh={isZh} onOpen={() => void openPack(pack)} />
        ))}
      </div>
      {!loading && visiblePacks.length === 0 ? <EmptyState onImport={() => setCreateDialogOpen(true)} title={copy.empty} hint={copy.emptyHint} importLabel="创建 Pack" /> : null}
      {pageCount > 1 ? (
        <div className="mt-7 flex items-center justify-center gap-3">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="secondary-pill type-button px-3 py-2 disabled:opacity-40">{copy.previous}</button>
          <span className="type-caption-2 text-zinc-500">{page} / {pageCount}</span>
          <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="secondary-pill type-button px-3 py-2 disabled:opacity-40">{copy.next}</button>
        </div>
      ) : null}
    </section>
  );
}

export function ResourceLibraryPage({ onBack }: { onBack: () => void }) {
  void onBack;
  const [initialPackId] = useState(() => getResourcePackRoute());
  return (
    <div className="fixed inset-0 z-[200] overflow-auto bg-zinc-950">
      <ResourceLibraryView initialPackId={initialPackId} />
    </div>
  );
}

function EmptyState({ onImport, title, hint, importLabel }: { onImport: () => void; title: string; hint: string; importLabel: string }) {
  return (
    <div className="mt-8 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-2xl text-zinc-400">＋</div>
      <h2 className="type-headline text-zinc-200">{title}</h2>
      <p className="type-footnote mt-2 max-w-sm text-zinc-500">{hint}</p>
      <button type="button" onClick={onImport} className="primary-pill type-button mt-5 px-4 py-2">{importLabel}</button>
    </div>
  );
}

function PublishReadinessDialog({ report, autoFixableCount, onClose, onSelectElement, onAutoFix }: { report: ResourcePublishReadiness; autoFixableCount: number; onClose: () => void; onSelectElement: (elementId: string) => void; onAutoFix: () => Promise<ResourcePublishReadiness> }) {
  const [activeReport, setActiveReport] = useState(report);
  const [isFixing, setIsFixing] = useState(false);
  useEffect(() => setActiveReport(report), [report]);
  const IssueList = ({ issues, tone }: { issues: readonly { code: string; message: string; elementId?: string }[]; tone: 'blocking' | 'warning' }) => <ul className="space-y-2">{issues.map((issue, index) => <li key={`${issue.code}-${issue.elementId || index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 type-caption-2 ${tone === 'blocking' ? 'border-red-300/20 bg-red-400/10 text-red-100' : 'border-amber-200/15 bg-amber-300/10 text-amber-100'}`}><span className="mt-0.5">{tone === 'blocking' ? '×' : '!'}</span><span className="min-w-0 flex-1">{issue.message}</span>{issue.elementId ? <button type="button" onClick={() => onSelectElement(issue.elementId!)} className="shrink-0 text-zinc-50 underline underline-offset-2">定位</button> : null}</li>)}</ul>;
  const canAutoFix = autoFixableCount > 0;
  const autoFix = async () => { setIsFixing(true); try { setActiveReport(await onAutoFix()); } finally { setIsFixing(false); } };
  return <div role="dialog" aria-modal="true" aria-label="发布检查" className="fixed inset-0 z-[220] grid place-items-center bg-black/60 p-5 backdrop-blur-sm"><section className="w-full max-w-md rounded-2xl border border-white/12 bg-[#17181d] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4"><div><p className="type-caption-1 text-[#c6a367]">资源库</p><h2 className="type-headline mt-1 text-zinc-50">发布检查</h2><p className="type-caption-2 mt-1 text-zinc-500">发布前需先处理所有阻塞项。</p></div><button type="button" aria-label="关闭发布检查" onClick={onClose} className="glass-icon-button h-8 w-8">×</button></div>{canAutoFix ? <div className="mt-4 rounded-xl border border-sky-200/15 bg-sky-300/[0.06] p-3"><p className="type-caption-2 text-zinc-300">可自动修复 {autoFixableCount} 个明确项：补齐可由资源组确定的用途，并关联唯一精确匹配的外部文件。其余项目保留供人工确认。</p><button type="button" disabled={isFixing} onClick={() => void autoFix()} className="primary-pill type-button mt-3 w-full px-4 py-2 disabled:opacity-50">{isFixing ? '正在一键修复…' : '一键修复可推断项'}</button></div> : null}<div className="max-h-[52vh] space-y-4 overflow-y-auto py-4">{activeReport.blocking.length ? <section><h3 className="type-caption-1 mb-2 text-red-200">阻塞项 · {activeReport.blocking.length}</h3><IssueList issues={activeReport.blocking} tone="blocking" /></section> : <p className="type-caption-2 rounded-lg border border-emerald-200/15 bg-emerald-300/10 px-3 py-2 text-emerald-100">所有阻塞项均已处理，可再次发布。</p>}{activeReport.warnings.length ? <section><h3 className="type-caption-1 mb-2 text-amber-100">警告 · {activeReport.warnings.length}</h3><IssueList issues={activeReport.warnings} tone="warning" /></section> : null}</div><button type="button" onClick={onClose} className="secondary-pill type-button w-full px-4 py-2">返回继续修复</button></section></div>
}

function PackCard({ pack, isZh, onOpen }: { pack: ResourcePackSummary; isZh: boolean; onOpen: () => void }) {
  const [coverUnavailable, setCoverUnavailable] = useState(false);
  const hasCover = Boolean(pack.coverPath) && !coverUnavailable;
  return (
    <button
      type="button"
      aria-label={pack.name}
      onClick={onOpen}
      className="group relative isolate aspect-video overflow-hidden rounded-[1.4rem] border border-white/10 bg-zinc-950 text-left transition hover:border-white/25 hover:shadow-2xl hover:shadow-black/30"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-orange-200/30 via-zinc-800 to-zinc-950">
        {hasCover ? (/(mp4|webm)/i.test(pack.coverPath!) ? <video src={pack.coverPath} muted autoPlay loop playsInline onError={() => setCoverUnavailable(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <img src={pack.coverPath} alt="" onError={() => setCoverUnavailable(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />) : <div className="grid h-full place-items-center text-6xl" aria-hidden="true">✦</div>}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/10" />
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span className="type-caption-2 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-zinc-100 backdrop-blur-sm">{pack.elementCount} 个元素</span>
        <span className={`type-caption-2 rounded-full border px-2.5 py-1 backdrop-blur-sm ${pack.status === 'published' ? 'border-emerald-200/20 bg-emerald-300/15 text-emerald-100' : pack.status === 'archived' ? 'border-amber-200/20 bg-amber-300/15 text-amber-100' : 'border-white/15 bg-black/35 text-zinc-100'}`}>● {pack.status === 'published' ? '已发布' : pack.status === 'archived' ? '已归档' : '草稿'}</span>
      </div>
      <div className="relative flex h-full flex-col justify-end p-5">
        <h2 className="type-headline truncate text-zinc-50">{pack.name}</h2>
        <p className="type-footnote mt-1 text-zinc-300">v{pack.version || '—'} · {pack.license || '未标注授权'} · {primaryCategoryLabel(pack.primaryCategory, isZh)}</p>
      </div>
    </button>
  );
}

function PackBrowser({
  apiClient,
  pack,
  isZh,
  elements,
  loadedElementCategories,
  selectedElement,
  loading,
  error,
  onBack,
  onElement,
  onClearElement,
  onEditPack,
  onUpdatePackDefaults,
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
  isZh: boolean;
  elements: ResourceElement[];
  loadedElementCategories: string[];
  selectedElement: ResourceElement | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onElement: (element: ResourceElement) => void;
  onClearElement: () => void;
  onEditPack: () => void;
  onUpdatePackDefaults: (defaults: NonNullable<ResourcePackSummary['elementDefaults']>) => Promise<void>;
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
  const categories = useMemo(() => [...new Set([...loadedElementCategories, ...elements.map((element) => element.category)].filter((category) => category.trim().length > 0))], [elements, loadedElementCategories]);
  const explorerTree = useMemo(() => buildExplorerTree(pack, folders, elements, (category) => categoryLabels[category] || category), [elements, folders, pack]);
  const explorerHostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const directoryUploadTargetRef = useRef<{ destination: UploadDestination; parentFolderId?: string } | undefined>(undefined);
  const [explorerHeight, setExplorerHeight] = useState(0);
  const [uploadDestination, setUploadDestination] = useState<UploadDestination>({ category: categories[0] || 'environment', folderPath: categories[0] || 'environment' });
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
  const [defaultsTarget, setDefaultsTarget] = useState<{ kind: 'pack' } | { kind: 'folder'; folder: ResourceFolder } | null>(null);
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
            showSuccess(isZh
              ? `资源分析完成，共处理 ${next.completedItems} 个元素。`
              : `Resource analysis complete. ${next.completedItems} elements processed.`);
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
  }, [apiClient, inspectionJob?.id, inspectionJob?.status, isZh, onRefreshWorkspace, pack.id, showSuccess]);
  useEffect(() => {
    let active = true;
    setResourceUrl(undefined); setResourceError('');
    if (!selectedElement) return () => { active = false; };
    void apiClient.getElementResourceUrl(pack.id, selectedElement.id).then(url => { if (active) setResourceUrl(url); }).catch(() => { if (active) setResourceError('预览资源加载失败'); });
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
      boundsWidth: metrics.bounds.width,
      boundsHeight: metrics.bounds.height,
      boundsDepth: metrics.bounds.depth,
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
      ? (elements.find((element) => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'environment')
      : (node.id.startsWith('category:') ? node.id.slice('category:'.length) : categories[0] || 'environment');
    setUploadDestination({ category, folderPath: node.folder?.path || category });
    fileInputRef.current?.click();
  };
  const renameFolder = (folder: ResourceFolder) => setRenameTarget({ type: 'folder', mode: 'rename', name: folder.name, folder });
  const deleteFolder = async (folder: ResourceFolder) => {
    const message = isZh
      ? `删除文件夹“${folder.name}”及其中所有文件和子文件夹？此操作不可恢复。`
      : `Delete “${folder.name}” and every file and subfolder inside it? This cannot be undone.`;
    if (!window.confirm(message)) return;
    await apiClient.deleteFolder(pack.id, folder.id);
    await onRefreshWorkspace();
  };
  const renameElement = (element: ResourceElement) => setRenameTarget({ type: 'file', mode: 'rename', name: element.name, element });
  const deleteElement = async (element: ResourceElement) => { if (window.confirm(`删除文件“${element.name}”？`)) { await apiClient.deleteElement(pack.id, element.id); await onRefreshWorkspace(); } };
  const moveElements = async (items: ResourceElement[], folder: ResourceFolder) => {
    const unique = [...new Map(items.map(item => [item.id, item])).values()];
    const moves = unique.filter(item => item.path !== `${folder.path}/${item.name}`);
    if (!moves.length) return;
    const results = await Promise.allSettled(moves.map(item => onUpdateElement(item.id, { path: `${folder.path}/${item.name}` })));
    await onRefreshWorkspace();
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length) setMoveError(`有 ${failed.length} 个文件未能移动；目录已刷新。`);
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
      ? (elements.find((element) => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'environment')
      : (node.id.startsWith('category:') ? node.id.slice('category:'.length) : categories[0] || 'environment');
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
      setMoveError(isZh ? '无法读取所选文件夹的相对路径，请重新选择整个文件夹。' : 'The selected directory did not expose relative file paths. Please select the whole folder again.');
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
  const contextLabels = isZh ? { upload: '上传文件', uploadFolder: '上传文件夹', rename: '重命名', inspect: '重新分析', inspectAll: '分析未处理文件', defaults: '默认元素用途', delete: '删除', newFolder: '新建文件夹' } : { upload: 'Upload files', uploadFolder: 'Upload folder', rename: 'Rename', inspect: 'Reinspect', inspectAll: 'Inspect unprocessed files', defaults: 'Default element usage', delete: 'Delete', newFolder: 'New folder' };
  return (
    <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#090a0c] text-zinc-100">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#2d2e34] bg-[#17181d] px-[18px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="grid h-[29px] w-[29px] shrink-0 place-items-center rounded-full bg-[#292a30] text-zinc-300 transition-colors hover:bg-[#36373e] hover:text-white"
            aria-label="返回资源包"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold leading-none tracking-[-0.01em] text-zinc-100">{pack.name}</h1>
            <p className="mt-1 truncate text-[11px] leading-none text-[#8d8f99]">
              {primaryCategoryLabel(pack.primaryCategory, isZh)} · {pack.style}{pack.gameTypes?.length ? ` · ${pack.gameTypes[0]}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex overflow-hidden rounded-full border border-[#474850] bg-transparent">
          <button type="button" className="h-[33px] border-0 px-[13px] text-[11px] font-medium text-[#e1e1e5] transition-colors hover:bg-white/[0.05]" onClick={onEditPack}>编辑 Pack</button>
          <button type="button" disabled={pack.status === 'published'} className="h-[33px] border-l border-[#474850] px-[13px] text-[11px] font-medium text-[#e1e1e5] transition-colors hover:bg-white/[0.05] disabled:text-zinc-600" onClick={() => void onPublish()}>{pack.status === 'archived' ? '重新发布' : '发布'}</button>
          </div>
          {pack.status !== 'archived' ? <button type="button" onClick={() => void onArchivePack()} className="h-[33px] rounded-full border border-amber-300/35 px-[13px] text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-300/10">归档 Pack</button> : <span className="type-caption-2 text-amber-200">已归档</span>}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-[#2c2d33] bg-[#15161b]">
          <div ref={explorerHostRef} className="min-h-0 flex-1 overflow-hidden"><ResourcePackExplorer tree={explorerTree} height={explorerHeight} selectedElementId={selectedElement?.id} selectedElementIds={selectedElementIds} onElement={onElement} onSelectionChange={(items) => { setSelectedElementIds(items.map(item => item.id)); if (items.length !== 1) onClearElement(); }} labels={contextLabels} onCreateFolder={() => setRenameTarget({ type: 'folder', mode: 'create', name: '' })} onUploadToFolder={startFolderUpload} onUploadFolderToFolder={startFolderDirectoryUpload} onDropFilesToFolder={(files, node) => { if (!node.folder) return; const category = elements.find(element => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'environment'; onAddFiles(files, { category, folderPath: node.folder.path }); }} onConfigureDefaults={(node) => setDefaultsTarget(node?.folder ? { kind: 'folder', folder: node.folder } : { kind: 'pack' })} onRenameFolder={(node) => node.folder && renameFolder(node.folder)} onDeleteFolder={(node) => node.folder && void deleteFolder(node.folder)} onRenameElement={renameElement} onInspectElement={(element) => { setMoveError(''); void apiClient.inspectElement(pack.id, element.id).then(async updated => { await onRefreshWorkspace(); if (selectedElement?.id === updated.id) onElement(updated); }).catch(cause => setMoveError(cause instanceof Error ? cause.message : String(cause))); }} onInspectAll={() => { void inspectUnprocessedElements(); }} onDeleteElement={(element) => void deleteElement(element)} onMoveElements={(items, node) => node.folder && void moveElements(items, node.folder)} /></div>
          <input ref={fileInputRef} aria-label="选择要添加的文件" type="file" multiple className="hidden" onChange={(event) => { onAddFiles(Array.from(event.target.files || []), uploadDestination); event.target.value = ''; }} />
          <input ref={folderInputRef} aria-label="选择要添加的文件夹" type="file" multiple {...directoryInputAttributes} className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadDirectorySelection(files); }} />
        </aside>
        <main className="relative min-h-0 min-w-0 overflow-hidden bg-[#090a0c]" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropFiles(Array.from(event.dataTransfer.files), uploadDestination); }}>
          {error || moveError ? (
            <div role="alert" className="type-callout absolute left-4 right-4 top-4 z-30 rounded-xl bg-red-400/10 p-3 text-red-200 shadow-xl">
              {error || moveError}
            </div>
          ) : null}
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-[radial-gradient(circle_at_48%_44%,#444852,#1b1d23_37%,#101115_70%)]">
            {selectedElements.length > 1 ? <BatchElementInspector pack={pack} elements={selectedElements} onApply={async (input) => {
              const results = await Promise.allSettled(selectedElements.map(element => onUpdateElement(element.id, {
                ...(input.kind ? { kind: input.kind } : {}),
                ...(input.status ? { status: input.status } : {}),
                ...(input.dimensionOverride ? { dimensionOverride: input.dimensionOverride } : {}),
                ...(input.styleOverride !== undefined ? { styleOverride: input.styleOverride } : {}),
                ...((input.addUsageTags?.length || input.removeUsageTags?.length) ? { usageTags: [...new Set(normaliseUsageTags(element.usageTags).filter(tag => !input.removeUsageTags?.includes(tag)).concat(input.addUsageTags || []))] } : {}),
              })));
              const failed = results.filter(result => result.status === 'rejected').length;
              if (failed) setMoveError(`有 ${failed} 个元素未能保存批量设置。`);
              else await onRefreshWorkspace();
            }} /> : null}
            {selectedElements.length > 1 ? null : selectedElement ? (
              resourceUrl && (!isModelElement(selectedElement) || externalResourcesReady) ? <Preview element={selectedElement} pack={pack} url={resourceUrl} elements={elements} materialTextureBindings={materialTextureBindings} textureUrls={boundTextureUrls} externalResourceUrls={externalResources.urls} inspectorOpen={inspectorOpen} onOpenInspector={() => setInspectorOpen(true)} onCloseInspector={() => setInspectorOpen(false)} onMetrics={saveMetrics} onSave={onUpdateElement} /> : resourceError ? <div role="alert" className="grid place-items-center gap-3 text-center type-footnote text-red-200"><span>{resourceError}</span><button type="button" aria-label="重试加载预览" onClick={() => setResourceAttempt(current => current + 1)} className="secondary-pill type-button px-3 py-1.5">重试</button></div> : <div className="type-footnote text-zinc-600">正在加载预览…</div>
            ) : (
              loading ? <div className="type-footnote text-zinc-600">正在加载…</div> : <EmptyPreviewState />
            )}
          </div>
        </main>
      </div>
      {uploadStatus ? <UploadProgressCover status={uploadStatus} onRetryFailed={onRetryFailedUploads} onCancel={onCancelUploads} onDismiss={onDismissUploads} /> : null}
      {inspectionJob ? <InspectionProgressCover isZh={isZh} job={inspectionJob} elements={elements} onClose={() => setInspectionJob(null)} onCancel={async () => setInspectionJob(await apiClient.cancelProcessingJob(pack.id, inspectionJob.id))} onRetry={async () => setInspectionJob(await apiClient.retryProcessingJob(pack.id, inspectionJob.id))} /> : null}
      {defaultsTarget ? <ElementDefaultsDialog isZh={isZh} targetName={defaultsTarget.kind === 'pack' ? pack.name : defaultsTarget.folder.name} initialTags={defaultsTarget.kind === 'pack' ? pack.elementDefaults?.usageTags : defaultsTarget.folder.elementDefaults?.usageTags} onClose={() => setDefaultsTarget(null)} onSave={async (usageTags) => { if (defaultsTarget.kind === 'pack') await onUpdatePackDefaults({ usageTags }); else await apiClient.updateFolder(pack.id, defaultsTarget.folder.id, { elementDefaults: { usageTags } }); await onRefreshWorkspace(); setDefaultsTarget(null); }} /> : null}
      {renameTarget ? <RenameResourceDialog open resourceType={renameTarget.type} mode={renameTarget.mode} initialName={renameTarget.name} onClose={() => setRenameTarget(null)} onRename={async (name) => { if (renameTarget.mode === 'create') { await onCreateFolder(name); return; } if (renameTarget.folder) { if (name !== renameTarget.folder.name) { await apiClient.updateFolder(pack.id, renameTarget.folder.id, { name }); await onRefreshWorkspace(); } return; } if (renameTarget.element) { if (name === renameTarget.element.name) return; const separator = renameTarget.element.path.lastIndexOf('/'); await onUpdateElement(renameTarget.element.id, { name, path: `${separator >= 0 ? renameTarget.element.path.slice(0, separator + 1) : ''}${name}` }); } }} /> : null}
    </section>
  );
}

function ElementDefaultsDialog({ isZh, targetName, initialTags, onClose, onSave }: { isZh: boolean; targetName: string; initialTags?: readonly string[]; onClose: () => void; onSave: (tags: string[]) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>(() => [...(initialTags ?? [])]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return <div role="dialog" aria-modal="true" aria-label={isZh ? '默认元素用途' : 'Default element usage'} className="fixed inset-0 z-[110] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#17181d] p-5 shadow-2xl"><div className="type-caption-2 text-zinc-500">{targetName}</div><h2 className="type-title-2 mt-1 text-zinc-50">{isZh ? '默认元素用途' : 'Default element usage'}</h2><p className="type-caption-2 mt-2 text-zinc-500">{isZh ? '未单独设置用途的文件会继承这里的选择。不会根据文件名猜测。' : 'Files without an explicit usage inherit this selection. Filenames are never used to guess semantics.'}</p><div className="mt-4"><UsageTagMultiSelect values={tags} open={open} onOpenChange={setOpen} onChange={setTags} /></div><div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => { setSaving(true); void onSave(tags).finally(() => setSaving(false)); }} className="primary-pill type-button px-4 py-2 disabled:opacity-50">{saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}</button></div></div></div>;
}

function InspectionProgressCover({ isZh, job, elements, onClose, onCancel, onRetry }: { isZh: boolean; job: ResourceProcessingJob; elements: readonly ResourceElement[]; onClose: () => void; onCancel: () => Promise<void>; onRetry: () => Promise<void> }) {
  const done = job.completedItems + job.failedItems;
  const active = job.status === 'queued' || job.status === 'running';
  const percent = job.totalItems ? Math.round(done / job.totalItems * 100) : 100;
  const names = new Map(elements.map(element => [element.id, element.name]));
  return <div role="status" aria-live="polite" aria-label={isZh ? '正在分析资源' : 'Analyzing resources'} className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-5 backdrop-blur-sm"><div className="flex w-full max-w-md flex-col items-center text-center"><span aria-hidden="true" className={`h-12 w-12 rounded-full border-2 border-white/15 ${job.status === 'failed' ? 'border-t-red-300' : 'border-t-orange-200'} ${active ? 'animate-spin' : ''}`} /><p className="type-headline mt-4 text-zinc-50">{percent}%</p><p className="type-caption-2 mt-2 text-zinc-400">{done} / {job.totalItems}{job.failedItems ? ` · ${job.failedItems} ${isZh ? '失败' : 'failed'}` : ''}</p>{job.failures?.length ? <div className="mt-4 max-h-48 w-full space-y-2 overflow-y-auto rounded-2xl border border-red-300/15 bg-red-300/[0.04] p-3 text-left">{job.failures.map(failure => <div key={failure.elementId} className="min-w-0"><p className="type-footnote truncate text-zinc-200">{names.get(failure.elementId) || failure.elementId}</p><p className="type-caption-2 mt-0.5 break-words text-red-200/75">{failure.error}</p></div>)}</div> : null}<div className="mt-5 flex gap-3">{active ? <button type="button" onClick={() => void onCancel()} className="secondary-pill type-button px-4 py-2">{isZh ? '取消' : 'Cancel'}</button> : null}{job.status === 'failed' ? <button type="button" onClick={() => void onRetry()} className="primary-pill type-button px-4 py-2">{isZh ? '重试失败项' : 'Retry failed'}</button> : null}{!active ? <button type="button" onClick={onClose} className="secondary-pill type-button px-4 py-2">{isZh ? '完成' : 'Done'}</button> : null}</div></div></div>;
}

function UploadProgressCover({ status, onRetryFailed, onCancel, onDismiss }: { status: ElementUploadStatus; onRetryFailed: () => void; onCancel: () => void; onDismiss: () => void }) {
  const percent = status.total ? Math.min(100, Math.round(status.done / status.total * 100)) : 0;
  const bytePercent = status.bytesTotal ? Math.min(100, Math.round((status.bytesDone || 0) / status.bytesTotal * 100)) : undefined;
  return <div role="status" aria-live="polite" aria-label="正在上传资源" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 backdrop-blur-sm">
    <div className="flex flex-col items-center text-center">
      <span aria-hidden="true" className={`h-12 w-12 rounded-full border-2 border-white/15 border-t-orange-200 ${status.phase === 'uploading' ? 'animate-spin' : ''} ${status.phase === 'failed' ? 'border-t-red-300' : status.phase === 'complete' ? 'border-t-emerald-300' : ''}`} />
      <p className="type-headline mt-4 text-zinc-50">{percent}%</p>
      {status.phase === 'uploading' && status.activeFileName ? <p className="type-caption-2 mt-2 max-w-72 truncate text-zinc-400">{status.activeFileName}{bytePercent !== undefined ? ` · ${bytePercent}%` : ''}</p> : null}
      {status.phase === 'failed' || status.phase === 'cancelled' ? <div className="mt-5 flex items-center gap-3"><button type="button" onClick={onDismiss} className="secondary-pill type-button px-4 py-2 text-zinc-300">{status.phase === 'cancelled' ? '结束上传' : '关闭'}</button><button type="button" onClick={onRetryFailed} className="secondary-pill type-button px-4 py-2 text-red-100">{status.phase === 'cancelled' ? '继续上传' : '重试失败文件'}</button></div> : null}
      {status.phase === 'uploading' ? <button type="button" onClick={onCancel} className="type-caption-2 mt-5 text-zinc-400 hover:text-white">取消剩余上传</button> : null}
    </div>
  </div>;
}

function ArchivePackDialog({ pack, impact, onClose, onArchive }: { pack: ResourcePackSummary; impact: BeeGameResourcePackImpactPayload; onClose: () => void; onArchive: () => Promise<void> }) {
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')
  return <div role="dialog" aria-modal="true" aria-label="归档 Pack" className="fixed inset-0 z-[270] grid place-items-center bg-black/65 p-5 backdrop-blur-sm"><div className="glass-panel w-full max-w-md rounded-3xl p-6 text-zinc-100"><div className="type-title-3">归档 {pack.name}</div><p className="type-footnote mt-3 text-zinc-400">归档不会删除资源或已复制到项目的文件。已有项目会继续锁定当前版本。</p>{impact.references.length ? <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-amber-300/20 bg-amber-300/5 p-3"><p className="type-footnote text-amber-100">{impact.projectCount} 个项目正在引用此 Pack</p><div className="mt-2 space-y-1">{impact.references.map(reference => <p key={`${reference.projectId}:${reference.importId}`} className="type-caption-2 text-zinc-300">{reference.projectName} · {reference.importId} · v{reference.packVersion}</p>)}</div></div> : <p className="type-footnote mt-4 text-zinc-500">没有项目引用此 Pack。</p>}{error ? <p role="alert" className="type-footnote mt-4 text-red-300">{error}</p> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" disabled={archiving} onClick={onClose} className="secondary-pill type-button px-4 py-2">取消</button><button type="button" disabled={archiving} onClick={() => { setArchiving(true); void onArchive().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setArchiving(false)); }} className="type-button rounded-full border border-amber-300/40 bg-amber-300/10 px-4 py-2 text-amber-100 disabled:opacity-60">{archiving ? '归档中…' : '确认归档'}</button></div></div></div>
}

function BatchElementInspector({ pack, elements, onApply }: { pack: ResourcePackSummary; elements: ResourceElement[]; onApply: (input: { kind?: string; status?: string; dimensionOverride?: ResourceElement['dimensionOverride']; styleOverride?: string | null; addUsageTags?: string[]; removeUsageTags?: string[] }) => Promise<void> }) {
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
  const styles = packStyleOptions(pack.style, styleOverride);
  const changed = Boolean(kind || status || dimensionOverride || styleMode !== 'keep' || addedUsageTags.length || removedUsageTags.length);
  const apply = async () => { if (!changed) return; setSaving(true); try { await onApply({ ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(dimensionOverride ? { dimensionOverride } : {}), ...(styleMode === 'inherit' ? { styleOverride: null } : styleMode === 'replace' ? { styleOverride: encodeStyleOverride(styleOverride) } : {}), ...(addedUsageTags.length ? { addUsageTags: addedUsageTags } : {}), ...(removedUsageTags.length ? { removeUsageTags: removedUsageTags } : {}) }); } finally { setSaving(false); } };
  return <aside aria-label="批量编辑元素" className="absolute inset-x-4 top-1/2 z-20 mx-auto min-w-0 max-w-[420px] -translate-y-1/2 rounded-2xl border border-white/10 bg-[#15161b]/95 p-4 shadow-2xl backdrop-blur-xl">
    <div className="flex items-start justify-between gap-4"><div><div className="type-footnote font-medium text-zinc-100">批量编辑 {elements.length} 个元素</div><p className="type-caption-2 mt-1 text-zinc-500">仅会应用你在此面板中明确修改的字段；混合值保持不变。</p></div><span className="type-caption-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-400">{elements.length}</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="type-caption-2 text-zinc-500">资源形态</span><select value={kind} onChange={event => setKind(event.target.value)} className="glass-control rounded-lg px-2 py-1.5 type-caption-2"><option value="">混合值（不修改）</option>{resourceFormOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1"><span className="type-caption-2 text-zinc-500">生命周期状态</span><select value={status} onChange={event => setStatus(event.target.value)} className="glass-control rounded-lg px-2 py-1.5 type-caption-2"><option value="">混合值（不修改）</option><option value="ready">可用</option><option value="hidden">隐藏</option><option value="archived">已归档</option></select></label></div>
    <label className="mt-3 grid gap-1"><span className="type-caption-2 text-zinc-500">维度覆盖</span><select value={dimensionOverride} onChange={event => setDimensionOverride(event.target.value as ResourceElement['dimensionOverride'] | '')} className="glass-control rounded-lg px-2 py-1.5 type-caption-2"><option value="">混合值（不修改）</option><option value="agnostic">继承 Pack</option><option value="2D">2D</option><option value="3D">3D</option></select></label>
    <div className="mt-3 grid gap-1"><span className="type-caption-2 text-zinc-500">风格覆盖</span><select value={styleMode} onChange={event => setStyleMode(event.target.value as typeof styleMode)} className="glass-control rounded-lg px-2 py-1.5 type-caption-2"><option value="keep">保持现有值</option><option value="inherit">全部继承 Pack 风格</option><option value="replace">覆盖为下列风格</option></select>{styleMode === 'replace' ? <StyleOverrideMultiSelect values={styleOverride} options={styles} onChange={setStyleOverride} /> : null}</div>
    <div className="mt-3 grid min-w-0 gap-1"><span className="type-caption-2 text-zinc-500">游戏用途（共同项）</span><UsageTagMultiSelect values={usageTags} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /></div>
    <button type="button" disabled={saving || !changed} onClick={() => void apply()} className="primary-pill type-button mt-4 w-full px-3 py-2 disabled:opacity-50">{saving ? '应用中…' : '应用到所选元素'}</button>
  </aside>
}

function StyleOverrideMultiSelect({ values, options, onChange }: { values: string[]; options: readonly string[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{options.map(option => <button key={option} type="button" aria-pressed={values.includes(option)} onClick={() => toggle(option)} className={`rounded-full border px-2.5 py-1 type-caption-2 transition-colors ${values.includes(option) ? 'border-orange-200/50 bg-orange-300/15 text-orange-100' : 'border-white/12 text-zinc-400 hover:border-white/25 hover:text-zinc-200'}`}>{option}</button>)}</div>;
}

function UsageTagMultiSelect({ values, open, onOpenChange, onChange }: { values: string[]; open: boolean; onOpenChange: (open: boolean) => void; onChange: (values: string[]) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabels = values.map(value => useDomainOptions.find(([option]) => option === value)?.[1] || value);
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
  return <div ref={rootRef} className="relative min-w-0 max-w-full"><button type="button" aria-label="游戏用途" aria-expanded={open} aria-haspopup="listbox" title={selectedLabels.join(' · ')} onClick={() => onOpenChange(!open)} className="glass-control flex min-h-8 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1 text-left type-caption-2"><span className={`min-w-0 flex-1 truncate ${selectedLabels.length ? 'text-zinc-200' : 'text-zinc-500'}`}>{selectedLabels.length ? selectedLabels.join(' · ') : '请选择用途'}</span><span className="shrink-0 text-zinc-500">⌄</span></button>{open ? <div role="listbox" aria-multiselectable="true" className="absolute inset-x-0 z-30 mt-1 max-h-56 min-w-0 overflow-y-auto rounded-lg border border-white/15 bg-zinc-950 p-1.5 shadow-xl">{useDomainOptions.map(([value, label]) => <button key={value} type="button" role="option" aria-selected={values.includes(value)} onClick={() => toggle(value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption-2 text-zinc-300 hover:bg-white/10"><span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${values.includes(value) ? 'border-sky-200/60 bg-sky-300/20 text-sky-100' : 'border-white/20'}`}>{values.includes(value) ? '✓' : null}</span>{label}</button>)}</div> : null}</div>;
}

function Preview({ element, pack, url, elements, materialTextureBindings, textureUrls, externalResourceUrls, inspectorOpen, onOpenInspector, onCloseInspector, onMetrics, onSave }: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  url: string;
  elements: ResourceElement[];
  materialTextureBindings: MaterialTextureBindings;
  textureUrls: Readonly<Record<string, string>>;
  externalResourceUrls: Readonly<Record<string, string>>;
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onCloseInspector: () => void;
  onMetrics: (metrics: ModelMetrics) => void;
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
}) {
  return (
    <div className="relative h-full w-full min-h-0 bg-[radial-gradient(circle_at_50%_45%,rgba(161,161,170,.65),rgba(24,24,27,.95)_65%)]">
      <FileInfoOverlay element={element} />
      {!inspectorOpen ? <button type="button" aria-label="显示元素信息" title="元素信息" onClick={onOpenInspector} className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/35 text-zinc-200 backdrop-blur-xl transition-colors hover:bg-black/55"><Info className="h-4 w-4" /></button> : null}
      <div className="h-full min-h-0 w-full"><ResourcePreview element={element} url={url} onMetrics={onMetrics} materialTextureBindings={materialTextureBindings} textureUrls={textureUrls} externalResourceUrls={externalResourceUrls} externalReferences={parseExternalReferences(element.specs.externalReferences)} onPreviewError={(error) => { console.error('Resource preview failed', { elementId: element.id, name: element.name, error }); if (element.specs.previewStatus !== 'failed') void onSave(element.id, { specs: { ...element.specs, previewStatus: 'failed', previewError: error.message || 'Preview loading failed' } }); }} /></div>
      {inspectorOpen ? <ResourceInspectorOverlay element={element} pack={pack} elements={elements} onSave={onSave} onClose={onCloseInspector} /> : null}
    </div>
  );
}

function FileInfoOverlay({ element }: { element: ResourceElement }) {
  const extension = typeof element.specs.extension === 'string' ? element.specs.extension : element.name.includes('.') ? element.name.split('.').pop() : '—';
  const size = typeof element.specs.size === 'number' ? formatFileSize(element.specs.size) : '—';
  const triangles = typeof element.specs.triangles === 'number' ? String(element.specs.triangles) : '—';
  const materials = typeof element.specs.materialCount === 'number' ? String(element.specs.materialCount) : '—';
  return <div className="absolute left-4 top-4 z-10 min-w-44 rounded-xl border border-white/10 bg-black/45 px-3 py-2.5 text-[11px] leading-5 text-zinc-300 shadow-lg backdrop-blur-xl"><div className="truncate font-medium text-zinc-100">{element.name}</div><div>扩展名：{extension}</div><div>大小：{size}</div>{isModelElement(element) ? <><div>三角形：{triangles}</div><div>材质：{materials}</div></> : null}</div>;
}

function EmptyPreviewState() {
  return <div className="flex max-w-sm flex-col items-center text-center"><div className="mb-[13px] grid h-[46px] w-[46px] place-items-center rounded-xl border border-[#4a4b51] bg-[#1a1b20] text-[#999ba5]"><File className="h-5 w-5" /></div><div className="text-[13px] font-semibold text-[#eeeeef]">尚未选择文件</div><p className="mt-[5px] text-[11px] text-[#8b8d97]">从左侧资源浏览器选择一个文件以查看预览和属性。</p></div>;
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
  onSave,
  onClose,
}: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  elements: ResourceElement[];
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  onClose: () => void;
}) {
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
  const styleOptions = packStyleOptions(pack.style, styleOverride);
  return (
    <aside
      role="complementary"
      aria-label="元素属性"
      className="absolute bottom-3 right-3 max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-white/15 bg-zinc-950/90 p-3 shadow-2xl backdrop-blur-2xl"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <button
            type="button"
            aria-label={element.name}
            className="type-footnote text-left text-zinc-100"
          >
            {element.name}
          </button>
          <div className="type-caption-2 mt-1 text-zinc-500">
            {categoryLabels[element.category] || element.category} / {element.kind}
          </div>
        </div>
        <button type="button" aria-label="关闭元素信息" onClick={onClose} className="glass-icon-button h-7 w-7"><X className="h-4 w-4 text-zinc-600" /></button>
      </div>
      <div className="mb-3 flex rounded-lg border border-white/10 bg-black/20 p-0.5" role="tablist" aria-label="元素面板">
        <button type="button" role="tab" aria-selected={activeTab === 'info'} onClick={() => setActiveTab('info')} className={`type-caption-2 flex-1 rounded-md px-2 py-1.5 transition-colors ${activeTab === 'info' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>元素信息</button>
        <button type="button" role="tab" aria-selected={activeTab === 'config'} onClick={() => setActiveTab('config')} className={`type-caption-2 flex-1 rounded-md px-2 py-1.5 transition-colors ${activeTab === 'config' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>元素配置</button>
      </div>
      {activeTab === 'info' ? <InspectorInfoTab element={element} pack={pack} elements={elements} /> : <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">游戏用途</span><select aria-label="用途继承方式" value={usageTagsMode} onChange={(event) => setUsageTagsMode(event.target.value as ResourceElement['usageTagsMode'])} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="inherit">继承 Pack / 文件夹规则</option><option value="override">单独覆盖</option><option value="manual-only">不参与自动匹配</option></select>{usageTagsMode === 'override' ? <UsageTagMultiSelect values={usageTags} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /> : null}<span className="type-caption-2 text-zinc-600">当前来源：{element.usageTagsSource === 'folder' ? '文件夹规则' : element.usageTagsSource === 'pack' ? 'Pack 规则' : element.usageTagsSource === 'element' ? '元素覆盖' : '未设置'}</span></div>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">资源形态</span><select aria-label="资源形态" value={kind} onChange={(event) => setKind(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2">{!resourceFormOptions.some(([value]) => value === kind) ? <option value={kind}>{kind}</option> : null}{resourceFormOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">交付类型</span><select aria-label="资产类型" value={assetKind} onChange={(event) => setAssetKind(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="">未分类</option>{assetKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="type-caption-2 text-zinc-600">描述这个逻辑资产如何交付；角色、武器等用途在“游戏用途”中设置。</span></label>
        <ElementCapabilityEditor values={capabilities} onChange={setCapabilities} />
        <EmbeddedComponentRoleEditor profile={contentProfile} onChange={setContentProfile} />
        <SemanticRelationsEditor element={element} elements={elements} relations={relations} onChange={setRelations} />
        <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">风格覆盖</span><div className="relative"><button type="button" aria-expanded={styleMenuOpen} aria-haspopup="menu" onClick={() => setStyleMenuOpen(open => !open)} className="glass-control flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left type-caption-2"><span className="truncate">{styleOverride.length ? styleOverride.join(' · ') : `继承 Pack：${pack.style}`}</span><span className="text-zinc-500">⌄</span></button>{styleMenuOpen ? <div role="menu" className="absolute z-20 mt-1 w-full rounded-lg border border-white/15 bg-zinc-950 p-1.5 shadow-xl">{styleOptions.map(option => <button key={option} type="button" role="menuitemcheckbox" aria-checked={styleOverride.includes(option)} onClick={() => setStyleOverride(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option])} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption-2 text-zinc-300 hover:bg-white/10"><span className={`grid h-3.5 w-3.5 place-items-center rounded border ${styleOverride.includes(option) ? 'border-orange-200/60 bg-orange-300/20 text-orange-100' : 'border-white/20'}`}>{styleOverride.includes(option) ? '✓' : null}</span>{option}</button>)}</div> : null}</div><div className="flex gap-1.5"><input aria-label="添加自定义覆盖风格" value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control min-w-0 flex-1 rounded-lg px-2 py-1 type-caption-2" placeholder="添加自定义风格" /><button type="button" onClick={() => { const value = customStyle.trim(); if (value) setStyleOverride(current => current.includes(value) ? current : [...current, value]); setCustomStyle(''); }} className="secondary-pill px-2 type-caption-2">添加</button></div><span className="type-caption-2 text-zinc-600">未选择时继承 Pack 风格。</span></div>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">维度覆盖</span><select value={dimensionOverride} onChange={(event) => setDimensionOverride(event.target.value as '2D' | '3D' | 'agnostic')} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="agnostic">继承 Pack</option><option value="2D">2D</option><option value="3D">3D</option></select><span className="type-caption-2 text-zinc-600">当前：<span>{dimensionOverride === 'agnostic' ? pack.dimension : dimensionOverride}</span></span></label>
        {isModelElement(element) ? <ModelMaterialBindings specs={element.specs} elements={elements} bindings={materialBindings} onBindingChange={setMaterialBindings} /> : null}
        <ExternalDependencyBindings specs={element.specs} elements={elements} bindings={dependencyBindings} onChange={setDependencyBindings} />
        <button type="button" disabled={saving} onClick={() => void save()} className="primary-pill type-button w-full px-3 py-2 disabled:opacity-50">{saving ? '保存中…' : '保存配置'}</button>
      </div>}
    </aside>
  );
}

function EmbeddedComponentRoleEditor({ profile, onChange }: { profile: ResourceElement['contentProfile']; onChange: (profile: ResourceElement['contentProfile']) => void }) {
  if (!profile?.components.length) return null;
  const editable = profile.components.filter(component => ['animation-clip', 'scene-node', 'collider', 'morph-target'].includes(component.kind));
  if (!editable.length) return null;
  return <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5"><div className="type-caption-2 font-medium text-zinc-300">内部内容角色</div><p className="type-caption-2 text-zinc-600">检查结果保持只读；这里只补充项目可查询的语义角色，不根据名称自动判断。</p>{editable.map(component => <label key={component.id} className="grid gap-1"><span className="type-caption-2 truncate text-zinc-500">{component.kind} · {component.name || component.id}</span><input value={(component.roles ?? []).join(', ')} onChange={(event) => { const roles = event.target.value.split(',').map(value => value.trim()).filter(Boolean); onChange({ ...profile, components: profile.components.map(item => item.id === component.id ? { ...item, roles } : item) }); }} className="glass-control rounded-lg px-2 py-1 type-caption-2" placeholder="例如 locomotion, combat" /></label>)}</div>;
}

function ExternalDependencyBindings({ specs, elements, bindings, onChange }: { specs: ResourceElement['specs']; elements: ResourceElement[]; bindings: readonly NonNullable<ResourceElement['dependencyBindings']>[number][]; onChange: (bindings: Array<NonNullable<ResourceElement['dependencyBindings']>[number]>) => void }) {
  const references = parseExternalReferences(specs.externalReferences);
  if (!references.length) return null;
  return <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5"><div className="type-caption-2 font-medium text-zinc-300">外部文件依赖</div><p className="type-caption-2 text-zinc-600">按模型记录的相对路径映射 Pack 文件；项目接入时会保留该目录关系。</p>{references.map(reference => { const binding = bindings.find(item => item.referencePath === reference); return <label key={reference} className="grid gap-1"><span className="type-caption-2 truncate text-zinc-500" title={reference}>{reference}</span><select value={binding?.dependencyElementId || ''} onChange={(event) => onChange(event.target.value ? [...bindings.filter(item => item.referencePath !== reference), { referencePath: reference, dependencyElementId: event.target.value }] : bindings.filter(item => item.referencePath !== reference))} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="">未关联（发布会阻止）</option>{elements.filter(candidate => candidate.status === 'ready').map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>})}</div>
}

function ElementCapabilityEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  return <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">能力标签（可多选）</span><div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-1.5">{capabilityOptions.map(([value, label]) => { const selected = values.includes(value); return <button key={value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? values.filter(item => item !== value) : [...values, value])} className={`rounded-md border px-1.5 py-1 type-caption-2 ${selected ? 'border-orange-200/40 bg-orange-300/10 text-orange-100' : 'border-white/10 text-zinc-500 hover:text-zinc-300'}`}>{label}</button>})}</div></div>;
}

function SemanticRelationsEditor({ element, elements, relations, onChange }: { element: ResourceElement; elements: ResourceElement[]; relations: Array<NonNullable<ResourceElement['relations']>[number]>; onChange: (relations: Array<NonNullable<ResourceElement['relations']>[number]>) => void }) {
  const targets = elements.filter(candidate => candidate.id !== element.id && candidate.status === 'ready');
  const addRelation = () => {
    const target = targets[0];
    if (!target) return;
    onChange([...relations, { kind: relationKindOptions[0][0], targetElementId: target.id, required: true }]);
  };
  return <details className="rounded-lg border border-white/10 bg-white/[0.025] p-2.5"><summary className="type-caption-2 cursor-pointer font-medium text-zinc-300">外部资产关系</summary><p className="type-caption-2 mt-1.5 text-zinc-600">仅用于独立动画库、独立碰撞体、LOD 或其他可复用元素。文件内部骨骼、动画和材质无需在这里关联。</p><div className="mt-2 flex justify-end"><button type="button" onClick={addRelation} disabled={!targets.length} className="secondary-pill px-2 py-1 type-caption-2 disabled:opacity-40">添加关系</button></div>{relations.map((relation, index) => <div key={`${relation.kind}-${relation.targetElementId}-${index}`} className="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1"><select aria-label={`关联类型 ${index + 1}`} value={relation.kind} onChange={(event) => onChange(relations.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value } : item))} className="glass-control min-w-0 rounded-md px-1.5 py-1 type-caption-2">{relationKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label={`关联目标 ${index + 1}`} value={relation.targetElementId} onChange={(event) => onChange(relations.map((item, itemIndex) => itemIndex === index ? { ...item, targetElementId: event.target.value } : item))} className="glass-control min-w-0 rounded-md px-1.5 py-1 type-caption-2">{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select><button type="button" aria-label={`删除关联 ${index + 1}`} onClick={() => onChange(relations.filter((_, itemIndex) => itemIndex !== index))} className="glass-icon-button h-7 w-7"><X className="h-3.5 w-3.5" /></button></div>)}</details>;
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

function InspectorInfoTab({ element, pack, elements }: { element: ResourceElement; pack: ResourcePackSummary; elements: ResourceElement[] }) {
  const bindings = decodeMaterialTextureBindings(element.specs.materialTextureBindings);
  const bindingValues = Object.entries(bindings).map(([slot, binding]) => `${slot} → ${elements.find(candidate => candidate.id === binding.baseColor)?.name || binding.baseColor}`);
  const usageLabels = normaliseUsageTags(element.usageTags).map(tag => useDomainOptions.find(([value]) => value === tag)?.[1] || tag);
  const assetKindLabel = assetKindOptions.find(([value]) => value === element.assetKind)?.[1] || element.assetKind || '未分类';
  const capabilityLabels = (element.capabilities ?? []).map(value => capabilityOptions.find(([candidate]) => candidate === value)?.[1] || value);
  const relationLabels = (element.relations ?? []).map(relation => `${relationKindOptions.find(([value]) => value === relation.kind)?.[1] || relation.kind} → ${elements.find(candidate => candidate.id === relation.targetElementId)?.name || relation.targetElementId}`);
  const componentLabels = (element.contentProfile?.components ?? []).map(component => `${component.kind}${component.name ? ` · ${component.name}` : ''}${component.roles?.length ? ` · ${component.roles.join(' / ')}` : ''}`);
  return <div role="tabpanel" className="space-y-2 border-t border-white/10 pt-3"><Property label="继承 Pack" value={pack.name} /><Property label="路径" value={element.path} /><Property label="状态" value={element.status} /><Property label="资源组" value={categoryLabels[element.category] || element.category} /><Property label="交付类型" value={assetKindLabel} /><MetadataList label="游戏用途" values={usageLabels} empty="未设置用途" /><MetadataList label="整体能力" values={capabilityLabels} empty="未设置能力" /><Property label="封装方式" value={element.contentProfile?.packaging || '尚未检查'} /><MetadataList label="内部内容" values={componentLabels} empty="尚未检查内部内容" /><MetadataList label="外部资产关系" values={relationLabels} empty="无外部关系" />{isModelElement(element) ? <ModelAssetMetadata specs={element.specs} bindings={bindingValues} /> : null}<MetadataList label="规格" values={Object.entries(element.specs).filter(([key]) => key !== 'materialTextureBindings' && key !== 'materialTextureCandidates' && key !== 'usageTags').map(([key, value]) => `${key}: ${value}`)} empty="未记录规格" /></div>
}

function ModelAssetMetadata({ specs, bindings }: { specs: ResourceElement['specs']; bindings: string[] }) {
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? [...new Set(specs.materialSlots.split(' · '))] : [];
  const textureReferences = typeof specs.textureReferences === 'string' && specs.textureReferences ? specs.textureReferences.split(' · ') : [];
  const unresolved = typeof specs.unresolvedTextureReferences === 'string' && specs.unresolvedTextureReferences ? specs.unresolvedTextureReferences.split(' · ') : [];
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5">
      <div className="type-caption-2 font-medium text-zinc-300">模型资源</div>
      <Property label="顶点" value={typeof specs.vertices === 'number' ? String(specs.vertices) : '—'} />
      <Property label="三角形" value={typeof specs.triangles === 'number' ? String(specs.triangles) : '—'} />
      <MetadataList label="材质槽" values={materialSlots} empty="未检测到材质" />
      <MetadataList label="已加载贴图" values={textureReferences} empty="未检测到嵌入贴图" />
      {unresolved.length ? <MetadataList label="待关联贴图" values={unresolved} empty="" warning /> : null}
      <MetadataList label="已绑定贴图" values={bindings} empty="尚未绑定外部贴图" />
    </div>
  );
}

function ModelMaterialBindings({ specs, elements, bindings, onBindingChange }: { specs: ResourceElement['specs']; elements: ResourceElement[]; bindings: MaterialTextureBindings; onBindingChange: (bindings: MaterialTextureBindings) => void }) {
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? [...new Set(specs.materialSlots.split(' · '))] : [];
  return <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5"><div className="type-caption-2 font-medium text-zinc-300">贴图绑定</div><p className="type-caption-2 text-zinc-600">绑定保存在资源元素 ID 中，不依赖导出时的文件路径。</p>{materialSlots.map(slot => <label key={slot} className="grid gap-1"><span className="type-caption-2 text-zinc-500">{slot} · 基础色</span><select value={bindings[slot]?.baseColor || ''} onChange={(event) => onBindingChange({ ...bindings, [slot]: event.target.value ? { baseColor: event.target.value } : {} })} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="">未关联</option>{elements.filter(candidate => candidate.kind === 'image' || candidate.category === 'textures').map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>)}</div>
}

function MetadataList({ label, values, empty, warning = false }: { label: string; values: string[]; empty: string; warning?: boolean }) {
  return <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">{label}</span>{values.length ? <div className="grid gap-1">{values.map((value, index) => <span key={`${index}:${value}`} title={value} className={`type-caption-2 truncate ${warning ? 'text-amber-200' : 'text-zinc-300'}`}>{value}</span>)}</div> : <span className="type-caption-2 text-zinc-600">{empty}</span>}</div>;
}

function Property({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="type-caption-2 text-zinc-500">{label}</span>
      <span className="type-caption-2 max-w-[170px] truncate text-right text-zinc-300">
        {value}
      </span>
    </div>
  );
}
