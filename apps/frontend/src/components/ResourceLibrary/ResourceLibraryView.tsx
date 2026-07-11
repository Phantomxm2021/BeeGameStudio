import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, File, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  ResourceLibraryApiError,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackPrimaryCategory,
  type ResourcePackSummary,
  type ResourcePublishReadiness,
} from '../../services/resourceLibraryApi';
import { CreateResourcePackDialog } from './CreateResourcePackDialog';
import { EditResourcePackDialog } from './EditResourcePackDialog';
import { DeleteResourcePackDialog } from './DeleteResourcePackDialog';
import { RenameResourceDialog } from './RenameResourceDialog';
import { isSupportedModelPreview, ResourcePreview } from './ResourcePreview';
import { ResourcePackExplorer } from './ResourcePackExplorer';
import { buildExplorerTree } from './resourcePackExplorerTree';
import type { ModelMetrics } from './ModelPreview';
import { automaticallyBindBaseColorTextures, decodeMaterialTextureBindings, encodeMaterialTextureBindings, suggestMaterialTextureCandidates, type MaterialTextureBindings } from './materialTextureBindings';
import { decodeStyleOverride, encodeStyleOverride, packStyleOptions } from './styleOverride';
import { closeResourcePackRoute, getResourcePackRoute, openResourcePackRoute } from './resourceLibraryRoute';

type ResourceLibraryApi = Pick<
  typeof resourceLibraryApi,
  'listPacks' | 'getPack' | 'listElements' | 'getElement' | 'updatePack' | 'deletePack' | 'uploadPackCover' | 'addElement'
  | 'createPack' | 'listFolders' | 'createFolder' | 'updateFolder' | 'deleteFolder'
  | 'updateElement' | 'getElementResourceUrl'
  | 'deleteElement' | 'publishPack' | 'getPublishReadiness'
>;

type ResourceLibraryViewProps = {
  apiClient?: ResourceLibraryApi;
  initialPackId?: string;
};

type UploadDestination = { category: string; folderPath: string };
type FailedElementUpload = { file: File; destination: UploadDestination; message: string };
type ElementUploadStatus = { done: number; total: number; failed: FailedElementUpload[]; phase: 'uploading' | 'failed' | 'complete' | 'cancelled' };

const uploadRetryDelaysMs = [500, 1_250] as const;

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

function legacyCategoryToUseDomain(category: string): string {
  const legacyDefaults: Record<string, string> = {
    characters: 'character', environment: 'environment', scenes: 'scene',
    tilemaps: 'level-map', tiles: 'tile', sprites: 'character', models: 'environment',
    materials: 'environment', textures: 'environment', ui: 'ui', vfx: 'effect',
    audio: 'sound-effect', fonts: 'ui', animation: 'character',
  };
  return legacyDefaults[category] || 'environment';
}

function normaliseUsageTags(value: unknown, category: string): string[] {
  const aliases: Record<string, string> = {
    characters: 'character', scenes: 'scene', vfx: 'effect', audio: 'sound-effect',
    textures: 'environment', fonts: 'ui', animation: 'character',
  };
  const stored = decodeUsageTags(value).map(tag => aliases[tag] || tag);
  return stored.length ? [...new Set(stored)] : [legacyCategoryToUseDomain(category)];
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
  } : {
    all: 'All resource packs', search: 'Search resource packs', empty: 'No resource packs', emptyHint: 'Create a Pack to manage its resources by style, type, and dimension.', previous: 'Previous', next: 'Next',
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
  const [page, setPage] = useState(1);
  const [elementUpload, setElementUpload] = useState<ElementUploadStatus | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [publishReadiness, setPublishReadiness] = useState<ResourcePublishReadiness | null>(null);

  const packSessionRef = useRef(0);
  const categoryRequestRef = useRef(0);
  const consumedInitialPackIdRef = useRef<string | undefined>(undefined);
  const cancelUploadRef = useRef(false);

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
    if (!initialPackId || initialPackId === consumedInitialPackIdRef.current || selectedPack || loading) return;
    const pack = packs.find((item) => item.id === initialPackId);
    if (pack) {
      consumedInitialPackIdRef.current = initialPackId;
      void openPack(pack);
    }
  }, [initialPackId, loading, packs, selectedPack]);

  const visiblePacks = useMemo(() => packs.filter((pack) => {
    const matchesQuery = !query.trim() || [pack.name, pack.style, ...(pack.gameTypes || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (dimension === 'all' || pack.dimension === dimension);
  }), [dimension, packs, query]);
  const pageCount = Math.max(1, Math.ceil(visiblePacks.length / 64));
  const pagedPacks = visiblePacks.slice((page - 1) * 64, page * 64);

  const uploadQueuedElements = async (uploads: Array<{ file: File; destination: UploadDestination }>) => {
    if (!selectedPack || uploads.length === 0) return;
    const session = packSessionRef.current;
    cancelUploadRef.current = false;
    setError('');
    setElementUpload({ done: 0, total: uploads.length, failed: [], phase: 'uploading' });
    const failed: FailedElementUpload[] = [];
    for (const { file, destination } of uploads) {
      if (cancelUploadRef.current) {
        failed.push({ file, destination, message: '上传已取消' });
        setElementUpload((current) => current ? { ...current, done: current.done + 1 } : current);
        continue;
      }
      try {
        let next: ResourceElement | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt <= uploadRetryDelaysMs.length; attempt += 1) {
          try {
            next = await apiClient.addElement(selectedPack.id, file, destination.category, destination.folderPath);
            break;
          } catch (err) {
            lastError = err;
            if (!isRetryableUploadError(err) || attempt === uploadRetryDelaysMs.length) break;
            await waitForUploadRetry(uploadRetryDelaysMs[attempt]);
          }
        }
        if (!next) throw lastError instanceof Error ? lastError : new Error('元素上传失败');
        if (session !== packSessionRef.current) continue;
        setElements((current) => [...current, next]);
        setLoadedElementCategories((current) => [...new Set([...current, next.category])]);
        setSelectedPack((current) => current ? { ...current, elementCount: current.elementCount + 1 } : current);
        setPacks((current) => current.map((pack) => pack.id === selectedPack.id ? { ...pack, elementCount: pack.elementCount + 1 } : pack));
        // Uploading must not steal the current inspector/preview focus. The
        // user can select any uploaded item deliberately from the tree.
      } catch (err) {
        const message = err instanceof Error ? err.message : '元素上传失败';
        failed.push({ file, destination, message });
      } finally {
        setElementUpload((current) => current ? { ...current, done: current.done + 1 } : current);
      }
    }
    if (session !== packSessionRef.current) return;
    if (failed.length) {
      setElementUpload({ done: uploads.length, total: uploads.length, failed, phase: cancelUploadRef.current ? 'cancelled' : 'failed' });
      setError(`${failed.length} 个文件上传失败；请重试或检查文件与权限。`);
      return;
    }
    setElementUpload({ done: uploads.length, total: uploads.length, failed: [], phase: 'complete' });
    window.setTimeout(() => setElementUpload((current) => current?.phase === 'complete' ? null : current), 1_200);
  };

  const uploadElements = async (files: File[], destination?: UploadDestination) => {
    const uploadCategory = destination?.category || activeCategory || 'environment';
    const uploadFolderPath = destination?.folderPath || activeFolderPath || uploadCategory;
    await uploadQueuedElements(files.map((file) => ({ file, destination: { category: uploadCategory, folderPath: uploadFolderPath } })));
  };

  const retryFailedUploads = async () => {
    if (!elementUpload?.failed.length) return;
    await uploadQueuedElements(elementUpload.failed.map(({ file, destination }) => ({ file, destination })));
  };

  if (selectedPack) {
    return (
      <>
      {editDialogOpen ? <EditResourcePackDialog open pack={selectedPack} onClose={() => setEditDialogOpen(false)} onUploadCover={async (file) => { const uploaded = await apiClient.uploadPackCover(selectedPack.id, file); setSelectedPack(uploaded); setPacks((current) => current.map((item) => item.id === uploaded.id ? uploaded : item)); return uploaded; }} onSave={async (input) => { const saved = await apiClient.updatePack(selectedPack.id, input); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); return saved; }} /> : null}
      {deleteDialogOpen ? <DeleteResourcePackDialog open pack={selectedPack} onClose={() => setDeleteDialogOpen(false)} onDelete={async () => { await apiClient.deletePack(selectedPack.id); closeResourcePackRoute(); packSessionRef.current += 1; categoryRequestRef.current += 1; setPacks((current) => current.filter((item) => item.id !== selectedPack.id)); setSelectedPack(null); setSelectedElement(null); setLoadedElementCategories([]); setFolders([]); setDeleteDialogOpen(false); setLoading(false); }} /> : null}
      {publishReadiness ? <PublishReadinessDialog report={publishReadiness} onClose={() => setPublishReadiness(null)} onSelectElement={(elementId) => { const element = elements.find((item) => item.id === elementId); if (element) setSelectedElement(element); setPublishReadiness(null); }} /> : null}
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
        onEditPack={() => setEditDialogOpen(true)}
        onDeletePack={() => setDeleteDialogOpen(true)}
        onAddFiles={(files, destination) => void uploadElements(files, destination)}
        onDropFiles={(files, destination) => void uploadElements(files, destination)}
        uploadStatus={elementUpload}
        onRetryFailedUploads={() => void retryFailedUploads()}
        onCancelUploads={() => { cancelUploadRef.current = true; }}
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
      <div className="mb-5 flex items-center gap-2 border-b border-white/10 pb-4">
        <div className="type-headline flex items-center gap-3">{copy.all} <button type="button" aria-label="创建 Pack" onClick={() => setCreateDialogOpen(true)} className="glass-icon-button h-8 w-8 text-lg">+</button></div>
        <div className="flex-1" />
        <label className="glass-control flex h-9 w-64 items-center gap-2 rounded-xl px-3 text-zinc-500">
          <Search className="h-4 w-4" />
          <input aria-label={copy.search} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={copy.search} className="type-input min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <button
          type="button"
          onClick={() => setDimension('all')}
          className="type-caption-1 rounded-full border border-orange-300/30 bg-orange-400/10 px-3 py-2 text-orange-200"
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => setDimension('2D')}
          className="type-caption-1 rounded-full border border-white/10 px-3 py-2 text-zinc-400"
        >
          2D
        </button>
        <button
          type="button"
          onClick={() => setDimension('3D')}
          className="type-caption-1 rounded-full border border-white/10 px-3 py-2 text-zinc-400"
        >
          3D
        </button>
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
  return (
    <div className="fixed inset-0 z-[200] overflow-auto bg-zinc-950">
      <ResourceLibraryView initialPackId={getResourcePackRoute()} />
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

function PublishReadinessDialog({ report, onClose, onSelectElement }: { report: ResourcePublishReadiness; onClose: () => void; onSelectElement: (elementId: string) => void }) {
  const IssueList = ({ issues, tone }: { issues: readonly { code: string; message: string; elementId?: string }[]; tone: 'blocking' | 'warning' }) => <ul className="space-y-2">{issues.map((issue, index) => <li key={`${issue.code}-${issue.elementId || index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 type-caption-2 ${tone === 'blocking' ? 'border-red-300/20 bg-red-400/10 text-red-100' : 'border-amber-200/15 bg-amber-300/10 text-amber-100'}`}><span className="mt-0.5">{tone === 'blocking' ? '×' : '!'}</span><span className="min-w-0 flex-1">{issue.message}</span>{issue.elementId ? <button type="button" onClick={() => onSelectElement(issue.elementId!)} className="shrink-0 text-zinc-50 underline underline-offset-2">定位</button> : null}</li>)}</ul>
  return <div role="dialog" aria-modal="true" aria-label="发布检查" className="fixed inset-0 z-[220] grid place-items-center bg-black/60 p-5 backdrop-blur-sm"><section className="w-full max-w-md rounded-2xl border border-white/12 bg-[#17181d] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4"><div><p className="type-caption-1 text-[#c6a367]">资源库</p><h2 className="type-headline mt-1 text-zinc-50">发布检查</h2><p className="type-caption-2 mt-1 text-zinc-500">发布前需先处理所有阻塞项。</p></div><button type="button" aria-label="关闭发布检查" onClick={onClose} className="glass-icon-button h-8 w-8">×</button></div><div className="max-h-[52vh] space-y-4 overflow-y-auto py-4">{report.blocking.length ? <section><h3 className="type-caption-1 mb-2 text-red-200">阻塞项 · {report.blocking.length}</h3><IssueList issues={report.blocking} tone="blocking" /></section> : null}{report.warnings.length ? <section><h3 className="type-caption-1 mb-2 text-amber-100">警告 · {report.warnings.length}</h3><IssueList issues={report.warnings} tone="warning" /></section> : null}</div><button type="button" onClick={onClose} className="secondary-pill type-button w-full px-4 py-2">返回继续修复</button></section></div>
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
        <span className="type-caption-2 rounded-full border border-emerald-200/20 bg-emerald-300/15 px-2.5 py-1 text-emerald-100 backdrop-blur-sm">● {pack.status === 'published' ? '已发布' : '草稿'}</span>
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
  onEditPack,
  onDeletePack,
  onAddFiles,
  onDropFiles,
  folders,
  onCreateFolder,
  uploadStatus,
  onRetryFailedUploads,
  onCancelUploads,
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
  onEditPack: () => void;
  onDeletePack: () => void;
  onAddFiles: (files: File[], destination: UploadDestination) => void;
  onDropFiles: (files: File[], destination: UploadDestination) => void;
  folders: ResourceFolder[];
  onCreateFolder: (name: string) => Promise<void>;
  onUpdateElement: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  onRefreshWorkspace: () => Promise<void>;
  uploadStatus: ElementUploadStatus | null;
  onRetryFailedUploads: () => void;
  onCancelUploads: () => void;
  onPublish: () => Promise<void>;
}) {
  const categories = useMemo(() => [...new Set([...loadedElementCategories, ...elements.map((element) => element.category)].filter((category) => category.trim().length > 0))], [elements, loadedElementCategories]);
  const explorerTree = useMemo(() => buildExplorerTree(pack, folders, elements, (category) => categoryLabels[category] || category), [elements, folders, pack]);
  const explorerHostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [explorerHeight, setExplorerHeight] = useState(0);
  const [uploadDestination, setUploadDestination] = useState<UploadDestination>({ category: categories[0] || 'environment', folderPath: categories[0] || 'environment' });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resourceUrl, setResourceUrl] = useState<string>();
  const [resourceError, setResourceError] = useState('');
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [boundTextureUrls, setBoundTextureUrls] = useState<Record<string, string>>({});
  const [renameTarget, setRenameTarget] = useState<{ type: 'folder' | 'file'; mode: 'create' | 'rename'; name: string; folder?: ResourceFolder; element?: ResourceElement } | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const selectedElements = useMemo(() => elements.filter(element => selectedElementIds.includes(element.id)), [elements, selectedElementIds]);
  const [moveError, setMoveError] = useState('');
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
    };
    const suggestedBindings = suggestMaterialTextureCandidates(selectedElement.name, metrics.materialSlots, elements);
    const existingBindings = decodeMaterialTextureBindings(selectedElement.specs.materialTextureBindings);
    const nextBindings = automaticallyBindBaseColorTextures(selectedElement.name, metrics.materialSlots, elements, existingBindings);
    const encodedBindings = encodeMaterialTextureBindings(nextBindings);
    const changed = Object.entries(nextMetrics).some(([key, value]) => selectedElement.specs[key] !== value)
      || selectedElement.specs.materialTextureCandidates !== JSON.stringify(suggestedBindings)
      || selectedElement.specs.materialTextureBindings !== encodedBindings;
    if (changed) await onUpdateElement(selectedElement.id, { specs: { ...selectedElement.specs, ...nextMetrics, materialTextureCandidates: JSON.stringify(suggestedBindings), materialTextureBindings: encodedBindings } });
  }, [elements, onUpdateElement, selectedElement]);
  const startFolderUpload = (node: { id: string; name: string; folder?: ResourceFolder }) => {
    const category = node.folder ? (elements.find((element) => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'environment') : node.id.replace(/^category:/, '');
    setUploadDestination({ category, folderPath: node.folder?.path || category });
    fileInputRef.current?.click();
  };
  const renameFolder = (folder: ResourceFolder) => setRenameTarget({ type: 'folder', mode: 'rename', name: folder.name, folder });
  const deleteFolder = async (folder: ResourceFolder) => { if (window.confirm(`删除文件夹“${folder.name}”？文件夹必须为空。`)) { await apiClient.deleteFolder(pack.id, folder.id); await onRefreshWorkspace(); } };
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
  const contextLabels = isZh ? { upload: '上传文件', rename: '重命名', delete: '删除', newFolder: '新建文件夹' } : { upload: 'Upload files', rename: 'Rename', delete: 'Delete', newFolder: 'New folder' };
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
          <button type="button" disabled={pack.status === 'published'} className="h-[33px] border-l border-[#474850] px-[13px] text-[11px] font-medium text-[#e1e1e5] transition-colors hover:bg-white/[0.05] disabled:text-zinc-600" onClick={() => void onPublish()}>发布</button>
          </div>
          <button type="button" onClick={onDeletePack} className="h-[33px] rounded-full border border-red-300/35 px-[13px] text-[11px] font-medium text-red-200 transition-colors hover:bg-red-400/10">删除 Pack</button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-[#2c2d33] bg-[#15161b]">
          <div ref={explorerHostRef} className="min-h-0 flex-1 overflow-hidden"><ResourcePackExplorer tree={explorerTree} height={explorerHeight} selectedElementId={selectedElement?.id} selectedElementIds={selectedElementIds} onElement={onElement} onSelectionChange={(items) => setSelectedElementIds(items.map(item => item.id))} labels={contextLabels} onCreateFolder={() => setRenameTarget({ type: 'folder', mode: 'create', name: '' })} onUploadToFolder={startFolderUpload} onDropFilesToFolder={(files, node) => { if (!node.folder) return; const category = elements.find(element => element.path.startsWith(`${node.folder!.path}/`))?.category || categories[0] || 'environment'; onAddFiles(files, { category, folderPath: node.folder.path }); }} onRenameFolder={(node) => node.folder && renameFolder(node.folder)} onDeleteFolder={(node) => node.folder && void deleteFolder(node.folder)} onRenameElement={renameElement} onDeleteElement={(element) => void deleteElement(element)} onMoveElements={(items, node) => node.folder && void moveElements(items, node.folder)} /></div>
          <input ref={fileInputRef} aria-label="选择要添加的文件" type="file" multiple className="hidden" onChange={(event) => { onAddFiles(Array.from(event.target.files || []), uploadDestination); event.target.value = ''; }} />
        </aside>
        <main className="relative min-h-0 min-w-0 overflow-hidden bg-[#090a0c]" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropFiles(Array.from(event.dataTransfer.files), uploadDestination); }}>
          {error || moveError ? (
            <div role="alert" className="type-callout absolute left-4 right-4 top-4 z-30 rounded-xl bg-red-400/10 p-3 text-red-200 shadow-xl">
              {error || moveError}
            </div>
          ) : null}
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-[radial-gradient(circle_at_48%_44%,#444852,#1b1d23_37%,#101115_70%)]">
            {selectedElements.length > 1 ? <BatchElementInspector elements={selectedElements} onApply={async (input) => {
              const results = await Promise.allSettled(selectedElements.map(element => onUpdateElement(element.id, {
                ...(input.kind ? { kind: input.kind } : {}),
                ...((input.addUsageTags?.length || input.removeUsageTags?.length) ? { specs: { ...element.specs, usageTags: JSON.stringify([...new Set(normaliseUsageTags(element.specs.usageTags, element.category).filter(tag => !input.removeUsageTags?.includes(tag)).concat(input.addUsageTags || []))]) } } : {}),
              })));
              const failed = results.filter(result => result.status === 'rejected').length;
              if (failed) setMoveError(`有 ${failed} 个元素未能保存批量设置。`);
              else await onRefreshWorkspace();
            }} /> : null}
            {selectedElement ? (
              resourceUrl ? <Preview element={selectedElement} pack={pack} url={resourceUrl} elements={elements} materialTextureBindings={materialTextureBindings} textureUrls={boundTextureUrls} inspectorOpen={inspectorOpen} onOpenInspector={() => setInspectorOpen(true)} onCloseInspector={() => setInspectorOpen(false)} onMetrics={saveMetrics} onSave={onUpdateElement} /> : resourceError ? <div role="alert" className="grid place-items-center gap-3 text-center type-footnote text-red-200"><span>{resourceError}</span><button type="button" aria-label="重试加载预览" onClick={() => setResourceAttempt(current => current + 1)} className="secondary-pill type-button px-3 py-1.5">重试</button></div> : <div className="type-footnote text-zinc-600">正在加载预览…</div>
            ) : (
              loading ? <div className="type-footnote text-zinc-600">正在加载…</div> : <EmptyPreviewState />
            )}
          </div>
        </main>
      </div>
      {uploadStatus ? <UploadProgressCover status={uploadStatus} onRetryFailed={onRetryFailedUploads} onCancel={onCancelUploads} /> : null}
      {renameTarget ? <RenameResourceDialog open resourceType={renameTarget.type} mode={renameTarget.mode} initialName={renameTarget.name} onClose={() => setRenameTarget(null)} onRename={async (name) => { if (renameTarget.mode === 'create') { await onCreateFolder(name); return; } if (renameTarget.folder) { if (name !== renameTarget.folder.name) { await apiClient.updateFolder(pack.id, renameTarget.folder.id, { name }); await onRefreshWorkspace(); } return; } if (renameTarget.element) { if (name === renameTarget.element.name) return; const separator = renameTarget.element.path.lastIndexOf('/'); await onUpdateElement(renameTarget.element.id, { name, path: `${separator >= 0 ? renameTarget.element.path.slice(0, separator + 1) : ''}${name}` }); } }} /> : null}
    </section>
  );
}

function UploadProgressCover({ status, onRetryFailed, onCancel }: { status: ElementUploadStatus; onRetryFailed: () => void; onCancel: () => void }) {
  const percent = status.total ? Math.min(100, Math.round(status.done / status.total * 100)) : 0;
  return <div role="status" aria-live="polite" aria-label="正在上传资源" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 backdrop-blur-sm">
    <div className="flex flex-col items-center text-center">
      <span aria-hidden="true" className={`h-12 w-12 animate-spin rounded-full border-2 border-white/15 border-t-orange-200 ${status.phase === 'failed' ? 'border-t-red-300' : status.phase === 'complete' ? 'border-t-emerald-300' : ''}`} />
      <p className="type-headline mt-4 text-zinc-50">{percent}%</p>
      {status.phase === 'failed' ? <button type="button" onClick={onRetryFailed} className="secondary-pill type-button mt-5 px-4 py-2 text-red-100">重试失败文件</button> : null}
      {status.phase === 'uploading' ? <button type="button" onClick={onCancel} className="type-caption-2 mt-5 text-zinc-400 hover:text-white">取消剩余上传</button> : null}
    </div>
  </div>;
}

function BatchElementInspector({ elements, onApply }: { elements: ResourceElement[]; onApply: (input: { kind?: string; addUsageTags?: string[]; removeUsageTags?: string[] }) => Promise<void> }) {
  const commonKind = elements.every(element => element.kind === elements[0]?.kind) ? elements[0]?.kind || '' : '';
  const commonUsageTags = useMemo(() => {
    const first = normaliseUsageTags(elements[0]?.specs.usageTags, elements[0]?.category || '');
    return first.filter(tag => elements.every(element => normaliseUsageTags(element.specs.usageTags, element.category).includes(tag)));
  }, [elements]);
  const [kind, setKind] = useState(commonKind);
  const [usageTags, setUsageTags] = useState<string[]>(commonUsageTags);
  const [initialUsageTags, setInitialUsageTags] = useState<string[]>(commonUsageTags);
  const [usageMenuOpen, setUsageMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setKind(commonKind); setUsageTags(commonUsageTags); setInitialUsageTags(commonUsageTags); setUsageMenuOpen(false); }, [commonKind, commonUsageTags]);
  const addedUsageTags = usageTags.filter(tag => !initialUsageTags.includes(tag));
  const removedUsageTags = initialUsageTags.filter(tag => !usageTags.includes(tag));
  const apply = async () => { if (!kind && !addedUsageTags.length && !removedUsageTags.length) return; setSaving(true); try { await onApply({ ...(kind ? { kind } : {}), ...(addedUsageTags.length ? { addUsageTags: addedUsageTags } : {}), ...(removedUsageTags.length ? { removeUsageTags: removedUsageTags } : {}) }); } finally { setSaving(false); } };
  return <aside className="absolute right-3 top-3 z-20 w-72 rounded-xl border border-sky-300/20 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl">
    <div className="type-footnote text-zinc-100">已选择 {elements.length} 个元素</div>
    <p className="type-caption-2 mt-1 text-zinc-500">显示所有元素的共同值；混合值不会被静默覆盖。</p>
    <label className="mt-3 grid gap-1"><span className="type-caption-2 text-zinc-500">资源形态</span><select value={kind} onChange={event => setKind(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="">混合值（不修改）</option>{resourceFormOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="mt-3 grid gap-1"><span className="type-caption-2 text-zinc-500">游戏用途（共同项）</span><UsageTagMultiSelect values={usageTags} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /></div>
    <button type="button" disabled={saving || (!kind && !addedUsageTags.length && !removedUsageTags.length)} onClick={() => void apply()} className="primary-pill type-button mt-3 w-full px-3 py-2 disabled:opacity-50">{saving ? '应用中…' : '应用到所选元素'}</button>
  </aside>
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
  return <div ref={rootRef} className="relative"><button type="button" aria-label="游戏用途" aria-expanded={open} aria-haspopup="listbox" onClick={() => onOpenChange(!open)} className="glass-control flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left type-caption-2"><span className={`truncate ${selectedLabels.length ? 'text-zinc-200' : 'text-zinc-500'}`}>{selectedLabels.length ? selectedLabels.join(' · ') : '请选择用途'}</span><span className="text-zinc-500">⌄</span></button>{open ? <div role="listbox" aria-multiselectable="true" className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-white/15 bg-zinc-950 p-1.5 shadow-xl">{useDomainOptions.map(([value, label]) => <button key={value} type="button" role="option" aria-selected={values.includes(value)} onClick={() => toggle(value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption-2 text-zinc-300 hover:bg-white/10"><span className={`grid h-3.5 w-3.5 place-items-center rounded border ${values.includes(value) ? 'border-sky-200/60 bg-sky-300/20 text-sky-100' : 'border-white/20'}`}>{values.includes(value) ? '✓' : null}</span>{label}</button>)}</div> : null}</div>;
}

function decodeUsageTags(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []; } catch { return []; }
}

function Preview({ element, pack, url, elements, materialTextureBindings, textureUrls, inspectorOpen, onOpenInspector, onCloseInspector, onMetrics, onSave }: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  url: string;
  elements: ResourceElement[];
  materialTextureBindings: MaterialTextureBindings;
  textureUrls: Readonly<Record<string, string>>;
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onCloseInspector: () => void;
  onMetrics: (metrics: ModelMetrics) => void;
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
}) {
  return (
    <div className="relative h-full w-full min-h-0 bg-[radial-gradient(circle_at_50%_45%,rgba(161,161,170,.65),rgba(24,24,27,.95)_65%)]">
      <FileInfoOverlay element={element} />
      {!inspectorOpen ? <button type="button" aria-label="显示元素信息" onClick={onOpenInspector} className="absolute right-4 top-4 z-10 h-8 rounded-full border border-white/15 bg-black/35 px-3 text-[11px] font-medium text-zinc-200 backdrop-blur-xl transition-colors hover:bg-black/55">Info</button> : null}
      <div className="h-full min-h-0 w-full"><ResourcePreview element={element} url={url} onMetrics={onMetrics} materialTextureBindings={materialTextureBindings} textureUrls={textureUrls} /></div>
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
  const [usageTags, setUsageTags] = useState<string[]>(() => normaliseUsageTags(element.specs.usageTags, element.category));
  const [usageMenuOpen, setUsageMenuOpen] = useState(false);
  const [styleOverride, setStyleOverride] = useState<string[]>(() => decodeStyleOverride(element.styleOverride));
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [customStyle, setCustomStyle] = useState('');
  const [dimensionOverride, setDimensionOverride] = useState(element.dimensionOverride || 'agnostic');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'config'>('info');
  const [materialBindings, setMaterialBindings] = useState<MaterialTextureBindings>(() => decodeMaterialTextureBindings(element.specs.materialTextureBindings));
  useEffect(() => { setKind(element.kind); setUsageTags(normaliseUsageTags(element.specs.usageTags, element.category)); setUsageMenuOpen(false); setStyleOverride(decodeStyleOverride(element.styleOverride)); setStyleMenuOpen(false); setCustomStyle(''); setDimensionOverride(element.dimensionOverride || 'agnostic'); setMaterialBindings(decodeMaterialTextureBindings(element.specs.materialTextureBindings)); }, [element]);
  const save = async () => { setSaving(true); try { const dependencies = [...new Set([...element.dependencies, ...Object.values(materialBindings).flatMap(binding => binding.baseColor ? [binding.baseColor] : [])])]; await onSave(element.id, { kind, styleOverride: encodeStyleOverride(styleOverride), dimensionOverride: dimensionOverride as ResourceElement['dimensionOverride'], specs: { ...element.specs, usageTags: JSON.stringify(usageTags), materialTextureBindings: encodeMaterialTextureBindings(materialBindings) }, dependencies }); } finally { setSaving(false); } };
  const styleOptions = packStyleOptions(pack.style, styleOverride);
  return (
    <aside
      role="complementary"
      aria-label="元素属性"
      className="absolute bottom-3 right-3 max-h-[calc(100%-1.5rem)] w-64 overflow-y-auto rounded-xl border border-white/15 bg-zinc-950/90 p-3 shadow-2xl backdrop-blur-2xl"
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
        <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">游戏用途（可多选）</span><UsageTagMultiSelect values={usageTags} open={usageMenuOpen} onOpenChange={setUsageMenuOpen} onChange={setUsageTags} /><span className="type-caption-2 text-zinc-600">例如：同一 3D 模型可以同时用于“建筑”和“场景”。</span></div>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">资源形态</span><select aria-label="资源形态" value={kind} onChange={(event) => setKind(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2">{!resourceFormOptions.some(([value]) => value === kind) ? <option value={kind}>{kind}</option> : null}{resourceFormOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">风格覆盖</span><div className="relative"><button type="button" aria-expanded={styleMenuOpen} aria-haspopup="menu" onClick={() => setStyleMenuOpen(open => !open)} className="glass-control flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left type-caption-2"><span className="truncate">{styleOverride.length ? styleOverride.join(' · ') : `继承 Pack：${pack.style}`}</span><span className="text-zinc-500">⌄</span></button>{styleMenuOpen ? <div role="menu" className="absolute z-20 mt-1 w-full rounded-lg border border-white/15 bg-zinc-950 p-1.5 shadow-xl">{styleOptions.map(option => <button key={option} type="button" role="menuitemcheckbox" aria-checked={styleOverride.includes(option)} onClick={() => setStyleOverride(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option])} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left type-caption-2 text-zinc-300 hover:bg-white/10"><span className={`grid h-3.5 w-3.5 place-items-center rounded border ${styleOverride.includes(option) ? 'border-orange-200/60 bg-orange-300/20 text-orange-100' : 'border-white/20'}`}>{styleOverride.includes(option) ? '✓' : null}</span>{option}</button>)}</div> : null}</div><div className="flex gap-1.5"><input aria-label="添加自定义覆盖风格" value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} className="glass-control min-w-0 flex-1 rounded-lg px-2 py-1 type-caption-2" placeholder="添加自定义风格" /><button type="button" onClick={() => { const value = customStyle.trim(); if (value) setStyleOverride(current => current.includes(value) ? current : [...current, value]); setCustomStyle(''); }} className="secondary-pill px-2 type-caption-2">添加</button></div><span className="type-caption-2 text-zinc-600">未选择时继承 Pack 风格。</span></div>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">维度覆盖</span><select value={dimensionOverride} onChange={(event) => setDimensionOverride(event.target.value as '2D' | '3D' | 'agnostic')} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="agnostic">继承 Pack</option><option value="2D">2D</option><option value="3D">3D</option></select><span className="type-caption-2 text-zinc-600">当前：<span>{dimensionOverride === 'agnostic' ? pack.dimension : dimensionOverride}</span></span></label>
        {isModelElement(element) ? <ModelMaterialBindings specs={element.specs} elements={elements} bindings={materialBindings} onBindingChange={setMaterialBindings} /> : null}
        <button type="button" disabled={saving} onClick={() => void save()} className="primary-pill type-button w-full px-3 py-2 disabled:opacity-50">{saving ? '保存中…' : '保存配置'}</button>
      </div>}
    </aside>
  );
}

function InspectorInfoTab({ element, pack, elements }: { element: ResourceElement; pack: ResourcePackSummary; elements: ResourceElement[] }) {
  const bindings = decodeMaterialTextureBindings(element.specs.materialTextureBindings);
  const bindingValues = Object.entries(bindings).map(([slot, binding]) => `${slot} → ${elements.find(candidate => candidate.id === binding.baseColor)?.name || binding.baseColor}`);
  const usageLabels = normaliseUsageTags(element.specs.usageTags, element.category).map(tag => useDomainOptions.find(([value]) => value === tag)?.[1] || tag);
  return <div role="tabpanel" className="space-y-2 border-t border-white/10 pt-3"><Property label="继承 Pack" value={pack.name} /><Property label="路径" value={element.path} /><Property label="状态" value={element.status} /><Property label="资源组" value={categoryLabels[element.category] || element.category} /><MetadataList label="游戏用途" values={usageLabels} empty="未设置用途" />{isModelElement(element) ? <ModelAssetMetadata specs={element.specs} bindings={bindingValues} /> : null}<MetadataList label="规格" values={Object.entries(element.specs).filter(([key]) => key !== 'materialTextureBindings' && key !== 'materialTextureCandidates' && key !== 'usageTags').map(([key, value]) => `${key}: ${value}`)} empty="未记录规格" /></div>
}

function ModelAssetMetadata({ specs, bindings }: { specs: ResourceElement['specs']; bindings: string[] }) {
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? specs.materialSlots.split(' · ') : [];
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
  const materialSlots = typeof specs.materialSlots === 'string' && specs.materialSlots ? specs.materialSlots.split(' · ') : [];
  return <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.025] p-2.5"><div className="type-caption-2 font-medium text-zinc-300">贴图绑定</div><p className="type-caption-2 text-zinc-600">绑定保存在资源元素 ID 中，不依赖导出时的文件路径。</p>{materialSlots.map(slot => <label key={slot} className="grid gap-1"><span className="type-caption-2 text-zinc-500">{slot} · 基础色</span><select value={bindings[slot]?.baseColor || ''} onChange={(event) => onBindingChange({ ...bindings, [slot]: event.target.value ? { baseColor: event.target.value } : {} })} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="">未关联</option>{elements.filter(candidate => candidate.kind === 'image' || candidate.category === 'textures').map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>)}</div>
}

function MetadataList({ label, values, empty, warning = false }: { label: string; values: string[]; empty: string; warning?: boolean }) {
  return <div className="grid gap-1"><span className="type-caption-2 text-zinc-500">{label}</span>{values.length ? <div className="grid gap-1">{values.map((value) => <span key={value} title={value} className={`type-caption-2 truncate ${warning ? 'text-amber-200' : 'text-zinc-300'}`}>{value}</span>)}</div> : <span className="type-caption-2 text-zinc-600">{empty}</span>}</div>;
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
