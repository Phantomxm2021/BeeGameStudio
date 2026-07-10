import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight, File, Folder, Plus, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackPrimaryCategory,
  type ResourcePackSummary,
} from '../../services/resourceLibraryApi';
import { CreateResourcePackDialog } from './CreateResourcePackDialog';
import { EditResourcePackDialog } from './EditResourcePackDialog';
import { isSupportedModelPreview, ResourcePreview } from './ResourcePreview';
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

type UploadDestination = { category: string; folderPath: string };


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
  const [elementUpload, setElementUpload] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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
        setSelectedPack((current) => current ? { ...current, elementCount: current.elementCount + 1 } : current);
        setPacks((current) => current.map((pack) => pack.id === selectedPack.id ? { ...pack, elementCount: pack.elementCount + 1 } : pack));
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
      {editDialogOpen ? <EditResourcePackDialog open pack={selectedPack} onClose={() => setEditDialogOpen(false)} onUploadCover={async (file) => { const uploaded = await apiClient.uploadPackCover(selectedPack.id, file); setSelectedPack(uploaded); setPacks((current) => current.map((item) => item.id === uploaded.id ? uploaded : item)); return uploaded; }} onSave={async (input) => { const saved = await apiClient.updatePack(selectedPack.id, input); setSelectedPack(saved); setPacks((current) => current.map((item) => item.id === saved.id ? saved : item)); return saved; }} onDelete={async () => { await apiClient.deletePack(selectedPack.id); closeResourcePackRoute(); packSessionRef.current += 1; categoryRequestRef.current += 1; setPacks((current) => current.filter((item) => item.id !== selectedPack.id)); setSelectedPack(null); setSelectedElement(null); setLoadedElementCategories([]); setFolders([]); setEditDialogOpen(false); setLoading(false); }} /> : null}
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
  const categoryFiles = (category: string) => elements.filter(element => element.category === category && !folders.some(folder => element.path.startsWith(`${folder.path}/`)));
  const uploadCategories = categories.length > 0 ? categories : ['environment'];
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadTarget, setUploadTarget] = useState('');
  useEffect(() => {
    if (!uploadCategories.includes(uploadCategory)) setUploadCategory(uploadCategories[0]);
    const validTargets = new Set([...uploadCategories.map(category => `category:${category}`), ...folders.map(folder => `folder:${folder.id}`)]);
    if (!validTargets.has(uploadTarget)) setUploadTarget(`category:${uploadCategories[0]}`);
  }, [folders, uploadCategories, uploadCategory, uploadTarget]);
  const selectedFolder = uploadTarget.startsWith('folder:') ? folders.find(folder => folder.id === uploadTarget.slice('folder:'.length)) : undefined;
  const selectedDestination: UploadDestination = { category: uploadCategory || uploadCategories[0], folderPath: selectedFolder?.path || (uploadTarget.startsWith('category:') ? uploadTarget.slice('category:'.length) : uploadCategories[0]) };
  const folderPaths = new Set(folders.map(folder => folder.path));
  const categoryOnly = categories.filter(category => !folderPaths.has(category));
  return (
    <section className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-[#090a0c] text-zinc-100">
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
          <label className="flex h-[33px] cursor-pointer items-center rounded-full bg-[#f4f4f5] px-[13px] text-[11px] font-semibold text-[#121217] transition-colors hover:bg-white">
            ＋ 添加文件
            <input aria-label="选择要添加的文件" type="file" multiple className="hidden" onChange={(event) => { onAddFiles(Array.from(event.target.files || []), selectedDestination); event.target.value = ''; }} />
          </label>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-[#2c2d33] bg-[#15161b] py-3">
          <div className="mb-2 flex items-center justify-between px-[14px]"><div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#90929b]">Pack 文件</div><button type="button" aria-label="新建文件夹" className="grid h-5 w-5 place-items-center rounded text-[#90929b] transition-colors hover:bg-white/[0.06] hover:text-zinc-100" onClick={() => { const name = window.prompt('文件夹名称')?.trim(); if (name) void onCreateFolder(name); }}><Plus className="h-3.5 w-3.5" /></button></div>
          <TreeRow
            icon={<Folder className="h-3.5 w-3.5 text-[#c0c1c8]" />}
            label={pack.name}
            count={pack.elementCount}
            expanded={expandedPaths.has('root')}
            onClick={() => toggleExpanded('root')}
          />
          {expandedPaths.has('root') ? <div className="mt-1">
            {folders.filter(folder => !folder.parentId).map((folder) => <FolderTreeNode key={folder.id} folder={folder} folders={folders} elements={elements} expandedPaths={expandedPaths} onToggle={toggleExpanded} onElement={onElement} selectedElementId={selectedElement?.id} />)}
            {categoryOnly.map((category) => (
              <div key={category}>
                <TreeRow icon={<Folder className="h-3.5 w-3.5 text-[#c0c1c8]" />} label={categoryLabels[category] || category} count={categoryFiles(category).length} expanded={expandedPaths.has(`category:${category}`)} onClick={() => toggleExpanded(`category:${category}`)} />
                {expandedPaths.has(`category:${category}`) ? categoryFiles(category).map((element) => <TreeRow key={element.id} icon={<File className="h-3.5 w-3.5 text-[#70727b]" />} label={element.name} ariaLabel={`文件 ${element.name}`} active={selectedElement?.id === element.id} onClick={() => onElement(element)} />) : null}
              </div>
            ))}
          </div> : null}
        </aside>
        <main className="relative min-h-0 min-w-0 overflow-hidden bg-[#090a0c] p-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDropFiles(Array.from(event.dataTransfer.files), selectedDestination); }}>
          {uploadStatus ? <div role="status" className="absolute left-4 right-4 top-4 z-20 rounded-xl border border-orange-300/20 bg-orange-400/10 p-3"><div className="flex items-center justify-between type-caption-2 text-orange-100"><span>上传资源</span><span>{uploadStatus.done}/{uploadStatus.total}</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-orange-300 transition-all" style={{ width: `${Math.round(uploadStatus.done / uploadStatus.total * 100)}%` }} /></div>{uploadStatus.failed.length ? <p className="mt-2 type-caption-2 text-red-200">失败：{uploadStatus.failed.join('、')}</p> : null}</div> : null}
          {error ? (
            <div role="alert" className="type-callout absolute left-4 right-4 top-4 z-30 rounded-xl bg-red-400/10 p-3 text-red-200 shadow-xl">
              {error}
            </div>
          ) : null}
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden rounded-[14px] bg-[radial-gradient(circle_at_48%_44%,#444852,#1b1d23_37%,#101115_70%)] p-4">
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

function FolderTreeNode({ folder, folders, elements, expandedPaths, onToggle, onElement, selectedElementId }: {
  folder: ResourceFolder;
  folders: ResourceFolder[];
  elements: ResourceElement[];
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onElement: (element: ResourceElement) => void;
  selectedElementId?: string;
}) {
  const key = `folder:${folder.id}`;
  const isExpanded = expandedPaths.has(key);
  const directFiles = elements.filter(element => parentPath(element.path) === folder.path);
  const children = folders.filter(candidate => candidate.parentId === folder.id);
  return <div>
    <TreeRow icon={<Folder className="h-3.5 w-3.5 text-[#c0c1c8]" />} label={folder.name} expanded={isExpanded} onClick={() => onToggle(key)} />
    {isExpanded ? <div className="ml-3">
      {directFiles.map((element) => <TreeRow key={element.id} icon={<File className="h-3.5 w-3.5 text-[#70727b]" />} label={element.name} ariaLabel={`文件 ${element.name}`} active={selectedElementId === element.id} onClick={() => onElement(element)} />)}
      {children.map(child => <FolderTreeNode key={child.id} folder={child} folders={folders} elements={elements} expandedPaths={expandedPaths} onToggle={onToggle} onElement={onElement} selectedElementId={selectedElementId} />)}
    </div> : null}
  </div>;
}

function parentPath(path: string) {
  const separator = path.lastIndexOf('/');
  return separator >= 0 ? path.slice(0, separator) : '';
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
  const isFolder = expanded !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      className={`flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[11px] transition-colors ${active ? 'bg-[#513917] text-white' : isFolder ? 'text-[#c0c1c8] hover:bg-[#212229]' : 'text-[#9ea0aa] hover:bg-[#202127] hover:text-zinc-100'}`}
    >
      {isFolder ? expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-[#aeb0b8]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[#aeb0b8]" /> : <span className="w-3 shrink-0" />}
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {count === undefined ? null : <span className="ml-auto text-[10px] text-[#70727b]">{count}</span>}
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
    <div className="relative h-full w-full min-h-0 bg-[radial-gradient(circle_at_50%_45%,rgba(161,161,170,.65),rgba(24,24,27,.95)_65%)]">
      <FileInfoOverlay element={element} />
      {!inspectorOpen ? <button type="button" aria-label="显示元素信息" onClick={onOpenInspector} className="absolute right-4 top-4 z-10 h-8 rounded-full border border-white/15 bg-black/35 px-3 text-[11px] font-medium text-zinc-200 backdrop-blur-xl transition-colors hover:bg-black/55">Info</button> : null}
      <div className="grid h-full min-h-0 place-items-center p-4"><ResourcePreview element={element} url={url} onMetrics={onMetrics} /></div>
      {inspectorOpen ? <ResourceInspectorOverlay element={element} pack={pack} onSave={onSave} onClose={onCloseInspector} /> : null}
    </div>
  );
}

function FileInfoOverlay({ element }: { element: ResourceElement }) {
  const extension = typeof element.specs.extension === 'string' ? element.specs.extension : element.name.includes('.') ? element.name.split('.').pop() : '—';
  const size = typeof element.specs.size === 'number' ? formatFileSize(element.specs.size) : '—';
  const triangles = typeof element.specs.triangles === 'number' ? String(element.specs.triangles) : '—';
  return <div className="absolute left-4 top-4 z-10 min-w-44 rounded-xl border border-white/10 bg-black/45 px-3 py-2.5 text-[11px] leading-5 text-zinc-300 shadow-lg backdrop-blur-xl"><div className="truncate font-medium text-zinc-100">{element.name}</div><div>扩展名：{extension}</div><div>大小：{size}</div>{isModelElement(element) ? <div>三角形：{triangles}</div> : null}</div>;
}

function EmptyPreviewState() {
  return <div className="flex max-w-sm flex-col items-center text-center"><div className="mb-[13px] grid h-[46px] w-[46px] place-items-center rounded-xl border border-[#4a4b51] bg-[#1a1b20] text-[#999ba5]"><File className="h-5 w-5" /></div><div className="text-[13px] font-semibold text-[#eeeeef]">尚未选择文件</div><p className="mt-[5px] text-[11px] text-[#8b8d97]">从左侧目录选择一个文件以查看预览与属性。</p></div>;
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
  const save = async () => { setSaving(true); try { await onSave(element.id, { kind, category, styleOverride: styleOverride || null, dimensionOverride: dimensionOverride as ResourceElement['dimensionOverride'] }); } finally { setSaving(false); } };
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
