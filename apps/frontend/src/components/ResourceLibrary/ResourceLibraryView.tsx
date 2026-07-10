import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, File, Folder, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackPrimaryCategory,
  type ResourcePackSummary,
} from '../../services/resourceLibraryApi';
import { CreateResourcePackDialog } from './CreateResourcePackDialog';
import { EditResourcePackDialog } from './EditResourcePackDialog';
import { ResourcePreview } from './ResourcePreview';
import type { ModelMetrics } from './ModelPreview';
import { closeResourcePackRoute, getResourcePackRoute, openResourcePackRoute } from './resourceLibraryRoute';

type ResourceLibraryApi = Pick<
  typeof resourceLibraryApi,
  'listPacks' | 'getPack' | 'listElements' | 'getElement' | 'importPack' | 'updatePack' | 'deletePack' | 'uploadPackCover' | 'addElement'
  | 'createPack' | 'listFolders' | 'createFolder'
  | 'updateElement' | 'getElementResourceUrl'
  | 'publishPack'
>;

type ResourceLibraryViewProps = {
  apiClient?: ResourceLibraryApi;
  initialPackId?: string;
};

type UploadDestination = { category: string; folderPath: string; label: string };


const categoryLabels: Record<string, string> = {
  sprites: '2D 图像',
  tilemaps: 'Tilemap',
  scenes: '场景与地图',
  characters: '角色',
  environment: '环境',
  tiles: 'Tile',
  models: '模型',
  materials: '材质',
  animation: '动画',
  ui: 'UI',
  vfx: '特效',
  fonts: '字体',
  audio: '音频',
  textures: '贴图',
};

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
    all: '所有资源包', search: '搜索资源包', import: '导入资源包', empty: '暂无资源包', emptyHint: '导入一个 Pack 后，它会出现在这里并按风格、类型和维度进行管理。', previous: '上一页', next: '下一页',
  } : {
    all: 'All resource packs', search: 'Search resource packs', import: 'Import resource pack', empty: 'No resource packs', emptyHint: 'Import a Pack to manage it by style, type, and dimension.', previous: 'Previous', next: 'Next',
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
  const [isRootDragActive, setIsRootDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'processing'>('uploading');
  const [elementUpload, setElementUpload] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const packSessionRef = useRef(0);
  const categoryRequestRef = useRef(0);
  const consumedInitialPackIdRef = useRef<string | undefined>(undefined);

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
      // The Pack category list may contain legacy folder names from ZIP imports.
      // Initial workspace loading must not treat those values as a validated category filter.
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

  const importPack = async (file: File) => {
    try {
      setUploadProgress(4);
      const parsed = await apiClient.importPack(file, (progress, phase) => { setUploadProgress(progress); setUploadPhase(phase); });
      setPacks((current) => [parsed, ...current.filter((pack) => pack.id !== parsed.id)]);
      setError('');
      setUploadProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源包导入失败');
      setUploadProgress(null);
    }
  };

  const importDroppedPacks = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) await importPack(file);
    }
  };

  const uploadElements = async (files: File[], destination?: UploadDestination) => {
    if (!selectedPack || files.length === 0) return;
    const session = packSessionRef.current;
    const uploadCategory = destination?.category || activeCategory || 'environment';
    const uploadFolderPath = destination?.folderPath || activeFolderPath || uploadCategory;
    setElementUpload({ done: 0, total: files.length, failed: [] });
    for (const file of files) {
      try {
        const next = await apiClient.addElement(selectedPack.id, file, uploadCategory, uploadFolderPath);
        if (session !== packSessionRef.current) continue;
        setElements((current) => [...current, next]);
        setLoadedElementCategories((current) => [...new Set([...current, next.category])]);
        setSelectedElement(next);
      } catch (err) {
        setElementUpload((current) => current ? { ...current, failed: [...current.failed, file.name] } : current);
        setError(err instanceof Error ? err.message : '元素上传失败');
      } finally {
        setElementUpload((current) => current ? { ...current, done: current.done + 1 } : current);
      }
    }
    setTimeout(() => setElementUpload(null), 1800);
  };

  if (selectedPack) {
    return (
      <>
      {editDialogOpen ? <EditResourcePackDialog open pack={selectedPack} onClose={() => setEditDialogOpen(false)} onUploadCover={async (file) => apiClient.uploadPackCover(selectedPack.id, file)} onSave={async (input) => { const saved = await apiClient.updatePack(selectedPack.id, input); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); return saved; }} onDelete={async () => { await apiClient.deletePack(selectedPack.id); closeResourcePackRoute(); packSessionRef.current += 1; categoryRequestRef.current += 1; setPacks((current) => current.filter((item) => item.id !== selectedPack.id)); setSelectedPack(null); setSelectedElement(null); setLoadedElementCategories([]); setFolders([]); setEditDialogOpen(false); setLoading(false); }} /> : null}
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
        onAddFiles={(files, destination) => void uploadElements(files, destination)}
        onDropFiles={(files, destination) => void uploadElements(files, destination)}
        uploadStatus={elementUpload}
        folders={folders}
        onCreateFolder={async (name) => { const folder = await apiClient.createFolder(selectedPack.id, { name }); setFolders((current) => [...current, folder]); }}
        onUpdateElement={async (elementId, body) => { const updated = await apiClient.updateElement(selectedPack.id, elementId, body); setElements((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelectedElement(updated); }}
        onPublish={async () => { const published = await apiClient.publishPack(selectedPack.id); setSelectedPack(published); setPacks((current) => current.map((item) => item.id === published.id ? published : item)); }}
      /></>
    );
  }

  return (
    <section className={`relative min-h-full bg-zinc-950 px-8 py-8 text-zinc-100 ${isRootDragActive ? 'ring-2 ring-inset ring-orange-300/70' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsRootDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsRootDragActive(false); }} onDrop={(event) => { event.preventDefault(); setIsRootDragActive(false); void importDroppedPacks(event.dataTransfer.files); }}>
      <CreateResourcePackDialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} onCreate={async (input) => { const created = await apiClient.createPack(input); setPacks((current) => [created, ...current]); return created; }} />
      {isRootDragActive ? <div className="pointer-events-none absolute inset-4 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-orange-300/70 bg-orange-400/10 text-orange-100"><div className="rounded-2xl bg-zinc-950/80 px-6 py-4 text-center shadow-2xl"><div className="type-headline">松开以导入资源包</div><div className="type-footnote mt-1 text-zinc-400">支持 ZIP 资源压缩包</div></div></div> : null}
      {uploadProgress !== null ? <div role="status" className="fixed bottom-6 left-1/2 z-30 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-white/15 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl"><div className="flex items-center justify-between"><span className="type-button text-zinc-200">{uploadPhase === 'uploading' ? '正在上传资源包…' : '正在解析并入库…'}</span><span className="type-caption-2 text-orange-200">{uploadProgress}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-orange-300 transition-all duration-500" style={{ width: `${uploadProgress}%` }} /></div><p className="type-caption-2 mt-2 text-zinc-500">请保持当前页面打开</p></div> : null}
      <input ref={importInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importPack(file);
        event.target.value = '';
      }} />
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
  return (
    <div className="fixed inset-0 z-[200] overflow-auto bg-zinc-950">
      <div className="sticky top-0 z-10 flex h-14 items-center border-b border-white/10 bg-zinc-950/90 px-6 backdrop-blur-xl">
        <button type="button" onClick={onBack} className="secondary-pill type-button px-4 py-2">
          ← 返回
        </button>
        <span className="type-headline ml-4">资源库</span>
      </div>
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

function PackCard({ pack, isZh, onOpen }: { pack: ResourcePackSummary; isZh: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={pack.name}
      onClick={onOpen}
      className="group rounded-[1.4rem] border border-white/10 bg-white/[0.025] p-3 text-left transition hover:border-white/25 hover:bg-white/[0.05]"
    >
      <div className="grid h-44 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-orange-200/30 via-zinc-800 to-zinc-950 text-6xl shadow-inner">
        {pack.coverPath ? (/(mp4|webm)/i.test(pack.coverPath) ? <video src={pack.coverPath} muted autoPlay loop playsInline className="h-full w-full object-cover" /> : <img src={pack.coverPath} alt="" className="h-full w-full object-cover" />) : <span aria-hidden="true">✦</span>}
      </div>
      <h2 className="type-headline mt-4 truncate text-zinc-100">{pack.name}</h2>
      <p className="type-footnote mt-1 text-zinc-500">
        v{pack.version || '—'} · {pack.license || '未标注授权'} · <span>{primaryCategoryLabel(pack.primaryCategory, isZh)}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {pack.style ? (
          <span className="type-caption-2 rounded-full bg-zinc-800 px-2 py-1 text-zinc-300">
            {pack.style}
          </span>
        ) : null}
        {pack.gameTypes?.slice(0, 2).map((type) => (
          <span
            key={type}
            className="type-caption-2 rounded-full bg-zinc-800 px-2 py-1 text-zinc-400"
          >
            {type}
          </span>
        ))}
        <span className="type-caption-2 rounded-full bg-zinc-700 px-2 py-1 text-zinc-200">
          {pack.dimension}
        </span>
      </div>
      <div className="mt-4 flex justify-between border-t border-white/10 pt-3">
        <span className="type-caption-2 text-zinc-400">{pack.elementCount} 个元素</span>
        <span className="type-caption-2 text-emerald-300">
          ● {pack.status === 'published' ? '已发布' : '草稿'}
        </span>
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
  onAddFiles,
  onDropFiles,
  folders,
  onCreateFolder,
  uploadStatus,
  onPublish,
  onUpdateElement,
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
  onAddFiles: (files: File[], destination: UploadDestination) => void;
  onDropFiles: (files: File[], destination: UploadDestination) => void;
  folders: ResourceFolder[];
  onCreateFolder: (name: string) => Promise<void>;
  onUpdateElement: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  uploadStatus: { done: number; total: number; failed: string[] } | null;
  onPublish: () => Promise<void>;
}) {
  const categories = useMemo(
    () => [...new Set([...loadedElementCategories, ...elements.map((element) => element.category)].filter((category) => category.trim().length > 0))],
    [elements, loadedElementCategories],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['root']));
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resourceUrl, setResourceUrl] = useState<string>();
  const [resourceError, setResourceError] = useState('');
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const toggleExpanded = (path: string) => setExpandedPaths(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  useEffect(() => { setInspectorOpen(false); }, [selectedElement?.id]);
  useEffect(() => {
    let active = true;
    setResourceUrl(undefined); setResourceError('');
    if (!selectedElement) return () => { active = false; };
    void apiClient.getElementResourceUrl(pack.id, selectedElement.id).then(url => { if (active) setResourceUrl(url); }).catch(() => { if (active) setResourceError('预览资源加载失败'); });
    return () => { active = false; };
  }, [apiClient, pack.id, resourceAttempt, selectedElement]);
  const saveMetrics = useCallback(async (metrics: ModelMetrics) => {
    if (!selectedElement) return;
    const nextMetrics: Record<string, string | number | boolean | null> = {
      triangles: metrics.triangles,
      vertices: metrics.vertices,
      materialCount: metrics.materialCount,
      boundsWidth: metrics.bounds.width,
      boundsHeight: metrics.bounds.height,
      boundsDepth: metrics.bounds.depth,
    };
    const changed = Object.entries(nextMetrics).some(([key, value]) => selectedElement.specs[key] !== value);
    if (changed) await onUpdateElement(selectedElement.id, { specs: { ...selectedElement.specs, ...nextMetrics } });
  }, [onUpdateElement, selectedElement]);
  const filesFor = (folder: string) => elements.filter(element => element.category === folder || element.path.startsWith(`${folder}/`));
  const destinations = useMemo<UploadDestination[]>(() => {
    const categoryDestinations = categories.map(category => ({ category, folderPath: category, label: categoryLabels[category] || category }));
    const fallbackCategory = categoryDestinations[0]?.category || 'environment';
    const folderDestinations = folders.map(folder => ({
      category: elements.find(element => element.path.startsWith(`${folder.path}/`))?.category || fallbackCategory,
      folderPath: folder.path,
      label: `文件夹：${folder.path}`,
    }));
    return [...categoryDestinations, ...folderDestinations];
  }, [categories, elements, folders]);
  const [destinationKey, setDestinationKey] = useState('');
  const selectedDestination = destinations.find((_, index) => String(index) === destinationKey) || destinations[0] || { category: 'environment', folderPath: 'environment', label: '环境' };
  useEffect(() => { if (!destinations.some((_, index) => String(index) === destinationKey)) setDestinationKey('0'); }, [destinationKey, destinations]);
  const folderPaths = new Set(folders.map(folder => folder.path));
  const categoryOnly = categories.filter(category => !folderPaths.has(category));
  return (
    <section className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="glass-icon-button h-9 w-9"
            aria-label="返回资源包"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="type-headline">{pack.name}</h1>
            <p className="type-caption-2 mt-0.5 text-zinc-500">
              {pack.style} · {pack.dimension} · <span>{primaryCategoryLabel(pack.primaryCategory, isZh)}</span> · {pack.elementCount} 个元素{pack.gameTypes?.length ? ` · ${pack.gameTypes.slice(0, 2).join(' / ')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-white/10">
          <button type="button" className="secondary-pill type-button rounded-none border-0 px-3 py-1.5" onClick={onEditPack}>编辑 Pack</button>
          <button type="button" disabled={pack.status === 'published'} className="secondary-pill type-button rounded-none border-0 border-l border-white/10 px-3 py-1.5 disabled:opacity-50" onClick={() => void onPublish()}>发布</button>
          </div>
          <label className="type-caption-2 flex items-center gap-2 text-zinc-400">上传目标
            <select aria-label="上传目标" value={destinationKey} onChange={(event) => setDestinationKey(event.target.value)} className="glass-control rounded-lg px-2 py-1 text-zinc-200">
              {destinations.map((destination, index) => <option key={`${destination.category}:${destination.folderPath}`} value={index}>{destination.label}</option>)}
            </select>
          </label>
          <label className="primary-pill type-button cursor-pointer px-3 py-1.5">
            ＋ 添加文件
            <input aria-label="选择要添加的文件" type="file" multiple className="hidden" onChange={(event) => { onAddFiles(Array.from(event.target.files || []), selectedDestination); event.target.value = ''; }} />
          </label>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-white/10 py-3 pr-3">
          <div className="mb-2 flex items-center justify-between px-2"><div className="type-caption-1 text-zinc-500">Pack 文件</div><button type="button" aria-label="新建文件夹" className="type-caption-2 text-zinc-500 hover:text-zinc-100" onClick={() => { const name = window.prompt('文件夹名称')?.trim(); if (name) void onCreateFolder(name); }}>＋</button></div>
          <TreeRow
            icon={<Folder className="h-4 w-4 text-orange-300" />}
            label={pack.name}
            count={pack.elementCount}
            expanded={expandedPaths.has('root')}
            onClick={() => toggleExpanded('root')}
          />
          {expandedPaths.has('root') ? <div className="mt-1">
            {folders.map((folder) => (
              <div key={folder.id}>
                <TreeRow
                  icon={<Folder className="h-4 w-4 text-orange-300" />}
                  label={folder.path}
                  expanded={expandedPaths.has(`folder:${folder.path}`)}
                  onClick={() => toggleExpanded(`folder:${folder.path}`)}
                />
                {expandedPaths.has(`folder:${folder.path}`)
                  ? filesFor(folder.path).map((element) => (
                      <TreeRow
                        key={element.id}
                        icon={<File className="h-4 w-4 text-zinc-600" />}
                        label={element.name}
                        ariaLabel={`文件 ${element.name}`}
                        active={selectedElement?.id === element.id}
                        onClick={() => onElement(element)}
                      />
                    ))
                  : null}
              </div>
            ))}
            {categoryOnly.map((category) => (
              <div key={category}>
                <TreeRow icon={<Folder className="h-4 w-4 text-orange-300" />} label={categoryLabels[category] || category} count={filesFor(category).length} expanded={expandedPaths.has(`category:${category}`)} onClick={() => toggleExpanded(`category:${category}`)} />
                {expandedPaths.has(`category:${category}`) ? filesFor(category).map((element) => <TreeRow key={element.id} icon={<File className="h-4 w-4 text-zinc-600" />} label={element.name} ariaLabel={`文件 ${element.name}`} active={selectedElement?.id === element.id} onClick={() => onElement(element)} />) : null}
              </div>
            ))}
          </div> : null}
        </aside>
        <main className="relative min-h-0 min-w-0 overflow-hidden p-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropFiles(Array.from(event.dataTransfer.files), selectedDestination); }}>
          {uploadStatus ? <div role="status" className="absolute left-4 right-4 top-4 z-20 rounded-xl border border-orange-300/20 bg-orange-400/10 p-3"><div className="flex items-center justify-between type-caption-2 text-orange-100"><span>上传资源</span><span>{uploadStatus.done}/{uploadStatus.total}</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-orange-300 transition-all" style={{ width: `${Math.round(uploadStatus.done / uploadStatus.total * 100)}%` }} /></div>{uploadStatus.failed.length ? <p className="mt-2 type-caption-2 text-red-200">失败：{uploadStatus.failed.join('、')}</p> : null}</div> : null}
          {error ? (
            <div role="alert" className="type-callout mb-4 rounded-xl bg-red-400/10 p-3 text-red-200">
              {error}
            </div>
          ) : null}
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-black p-4">
            {selectedElement ? (
              resourceUrl ? <Preview element={selectedElement} pack={pack} url={resourceUrl} inspectorOpen={inspectorOpen} onOpenInspector={() => setInspectorOpen(true)} onCloseInspector={() => setInspectorOpen(false)} onMetrics={saveMetrics} onSave={onUpdateElement} /> : resourceError ? <div role="alert" className="grid place-items-center gap-3 text-center type-footnote text-red-200"><span>{resourceError}</span><button type="button" aria-label="重试加载预览" onClick={() => setResourceAttempt(current => current + 1)} className="secondary-pill type-button px-3 py-1.5">重试</button></div> : <div className="type-footnote text-zinc-600">正在加载预览…</div>
            ) : (
              loading ? <div className="type-footnote text-zinc-600">正在加载…</div> : <EmptyPreviewState />
            )}
          </div>
        </main>
      </div>
    </section>
  );
}

function TreeRow({
  icon,
  label,
  count,
  active,
  expanded,
  onClick,
  ariaLabel,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      className={`type-caption-2 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left ${active ? 'bg-orange-400/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {count === undefined ? null : <span className="ml-auto text-zinc-600">{count}</span>}
    </button>
  );
}

function Preview({ element, pack, url, inspectorOpen, onOpenInspector, onCloseInspector, onMetrics, onSave }: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  url: string;
  inspectorOpen: boolean;
  onOpenInspector: () => void;
  onCloseInspector: () => void;
  onMetrics: (metrics: ModelMetrics) => void;
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
}) {
  return (
    <div className="relative h-full w-full min-h-0 rounded-2xl bg-[radial-gradient(circle_at_50%_45%,rgba(161,161,170,.65),rgba(24,24,27,.95)_65%)]">
      <FileInfoOverlay element={element} />
      {!inspectorOpen ? <button type="button" aria-label="显示元素信息" onClick={onOpenInspector} className="glass-icon-button absolute right-4 top-4 z-10 px-3 py-1.5 type-caption-2">Info</button> : null}
      <div className="grid h-full min-h-0 place-items-center p-4"><ResourcePreview element={element} url={url} onMetrics={onMetrics} /></div>
      {inspectorOpen ? <ResourceInspectorOverlay element={element} pack={pack} onSave={onSave} onClose={onCloseInspector} /> : null}
    </div>
  );
}

function FileInfoOverlay({ element }: { element: ResourceElement }) {
  const extension = typeof element.specs.extension === 'string' ? element.specs.extension : element.name.includes('.') ? element.name.split('.').pop() : '—';
  const size = typeof element.specs.size === 'number' ? formatFileSize(element.specs.size) : '—';
  const triangles = typeof element.specs.triangles === 'number' ? String(element.specs.triangles) : '—';
  return <div className="absolute left-4 top-4 z-10 rounded-lg border border-white/10 bg-black/40 px-3 py-2 type-caption-2 text-zinc-300"><div>{element.name}</div><div>扩展名：{extension}</div><div>大小：{size}</div>{isModelElement(element) ? <div>三角形：{triangles}</div> : null}</div>;
}

function EmptyPreviewState() {
  return <div className="flex max-w-sm flex-col items-center text-center"><div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-400"><File className="h-5 w-5" /></div><div className="type-headline text-zinc-200">尚未选择文件</div><p className="type-footnote mt-2 text-zinc-500">从左侧资源浏览器选择一个文件以查看预览和属性。</p></div>;
}

function isModelElement(element: ResourceElement) {
  if (element.kind.toLowerCase() === 'model') return true;
  const extension = typeof element.specs.extension === 'string' ? element.specs.extension : element.name.split('.').pop();
  return ['glb', 'gltf', 'obj', 'fbx'].includes(extension?.toLowerCase() || '');
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ResourceInspectorOverlay({
  element,
  pack,
  onSave,
  onClose,
}: {
  element: ResourceElement;
  pack: ResourcePackSummary;
  onSave: (elementId: string, body: Partial<ResourceElement>) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(element.kind);
  const [category, setCategory] = useState(element.category);
  const [styleOverride, setStyleOverride] = useState(element.styleOverride || '');
  const [dimensionOverride, setDimensionOverride] = useState(element.dimensionOverride || 'agnostic');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setKind(element.kind); setCategory(element.category); setStyleOverride(element.styleOverride || ''); setDimensionOverride(element.dimensionOverride || 'agnostic'); }, [element]);
  const save = async () => { setSaving(true); try { await onSave(element.id, { kind, category, styleOverride: styleOverride || undefined, dimensionOverride: dimensionOverride as ResourceElement['dimensionOverride'] }); } finally { setSaving(false); } };
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
      <div className="space-y-2 border-t border-white/10 pt-3">
        <Property label="继承 Pack" value={pack.name} />
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">分类</span><select value={category} onChange={(event) => setCategory(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="characters">角色</option><option value="environment">环境</option><option value="models">模型</option><option value="ui">UI</option><option value="vfx">特效</option><option value="audio">音频</option><option value="fonts">字体</option><option value="textures">贴图</option></select></label>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">类型</span><input value={kind} onChange={(event) => setKind(event.target.value)} className="glass-control rounded-lg px-2 py-1 type-caption-2" /></label>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">风格覆盖</span><input value={styleOverride} onChange={(event) => setStyleOverride(event.target.value)} placeholder={pack.style} className="glass-control rounded-lg px-2 py-1 type-caption-2" /><span className="type-caption-2 text-zinc-600">当前：<span>{styleOverride || pack.style}</span></span></label>
        <label className="grid gap-1"><span className="type-caption-2 text-zinc-500">维度覆盖</span><select value={dimensionOverride} onChange={(event) => setDimensionOverride(event.target.value as '2D' | '3D' | 'agnostic')} className="glass-control rounded-lg px-2 py-1 type-caption-2"><option value="agnostic">继承 Pack</option><option value="2D">2D</option><option value="3D">3D</option></select><span className="type-caption-2 text-zinc-600">当前：<span>{dimensionOverride === 'agnostic' ? pack.dimension : dimensionOverride}</span></span></label>
        <Property label="路径" value={element.path} />
        <Property label="状态" value={element.status} />
        <Property
          label="规格"
          value={Object.entries(element.specs)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        />
      </div>
      <button type="button" disabled={saving} onClick={() => void save()} className="primary-pill type-button mt-3 w-full px-3 py-2 disabled:opacity-50">{saving ? '保存中…' : '保存更改'}</button>
    </aside>
  );
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
