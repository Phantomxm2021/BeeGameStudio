import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { strFromU8, unzipSync } from 'fflate';
import { ChevronLeft, ChevronRight, File, Folder, Grid2X2, List, Search, X } from 'lucide-react';
import {
  resourceLibraryApi,
  type ResourceElement,
  type ResourcePackSummary,
} from '../../services/resourceLibraryApi';

type ResourceLibraryApi = Pick<
  typeof resourceLibraryApi,
  'listPacks' | 'getPack' | 'listElements' | 'getElement'
>;

type ResourceLibraryViewProps = {
  apiClient?: ResourceLibraryApi;
};

const LOCAL_LIBRARY_KEY = 'beegame.resource-library.local.v1';

type LocalLibrarySnapshot = {
  packs: ResourcePackSummary[];
  elementsByPack: Record<string, ResourceElement[]>;
};

function readLocalLibrary(): LocalLibrarySnapshot {
  if (typeof window === 'undefined') return { packs: [], elementsByPack: {} };
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_LIBRARY_KEY) || '{}') as Partial<LocalLibrarySnapshot>;
    return { packs: Array.isArray(value.packs) ? value.packs : [], elementsByPack: value.elementsByPack || {} };
  } catch {
    return { packs: [], elementsByPack: {} };
  }
}

const categoryLabels: Record<string, string> = {
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

export function ResourceLibraryView({ apiClient = resourceLibraryApi }: ResourceLibraryViewProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const copy = isZh ? {
    all: '所有资源包', search: '搜索资源包', import: '导入资源包', empty: '暂无资源包', emptyHint: '导入一个 Pack 后，它会出现在这里并按风格、类型和维度进行管理。', previous: '上一页', next: '下一页',
  } : {
    all: 'All resource packs', search: 'Search resource packs', import: 'Import resource pack', empty: 'No resource packs', emptyHint: 'Import a Pack to manage it by style, type, and dimension.', previous: 'Previous', next: 'Next',
  };
  const [localLibrary, setLocalLibrary] = useState<LocalLibrarySnapshot>(readLocalLibrary);
  const [packs, setPacks] = useState<ResourcePackSummary[]>(localLibrary.packs);
  const [selectedPack, setSelectedPack] = useState<ResourcePackSummary | null>(null);
  const [elements, setElements] = useState<ResourceElement[]>([]);
  const [selectedElement, setSelectedElement] = useState<ResourceElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dimension, setDimension] = useState<'all' | '2D' | '3D'>('all');
  const [page, setPage] = useState(1);
  const [isRootDragActive, setIsRootDragActive] = useState(false);
  const [localElementsByPack, setLocalElementsByPack] = useState<Record<string, ResourceElement[]>>(localLibrary.elementsByPack);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify({ packs: localLibrary.packs, elementsByPack: localLibrary.elementsByPack }));
  }, [localLibrary]);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .listPacks()
      .then((result) => {
        if (!cancelled) setPacks([...localLibrary.packs, ...result.filter((pack) => !localLibrary.packs.some((local) => local.id === pack.id))]);
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
  }, [apiClient, localLibrary.packs]);

  const openPack = async (pack: ResourcePackSummary) => {
    setError('');
    setLoading(true);
    try {
      const localElements = localElementsByPack[pack.id];
      if (localElements) {
        const category = pack.categories?.[0];
        const nextElements = category ? localElements.filter((element) => element.category === category) : localElements;
        setSelectedPack(pack);
        setActiveCategory(category);
        setElements(nextElements);
        setSelectedElement(nextElements[0] || null);
        return;
      }
      const detail = await apiClient.getPack(pack.id);
      const category = detail.categories?.[0];
      const nextElements = await apiClient.listElements(pack.id, category);
      setSelectedPack(detail);
      setActiveCategory(category);
      setElements(nextElements);
      setSelectedElement(nextElements[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源包加载失败');
    } finally {
      setLoading(false);
    }
  };

  const selectCategory = async (category: string) => {
    if (!selectedPack) return;
    setActiveCategory(category);
    const localElements = localElementsByPack[selectedPack.id];
    if (localElements) {
      const nextElements = localElements.filter((element) => element.category === category);
      setElements(nextElements);
      setSelectedElement(nextElements[0] || null);
      return;
    }
    setLoading(true);
    try {
      const nextElements = await apiClient.listElements(selectedPack.id, category);
      setElements(nextElements);
      setSelectedElement(nextElements[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '元素加载失败');
    } finally {
      setLoading(false);
    }
  };

  const visiblePacks = useMemo(() => packs.filter((pack) => {
    const matchesQuery = !query.trim() || [pack.name, pack.style, ...pack.gameTypes].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (dimension === 'all' || pack.dimension === dimension);
  }), [dimension, packs, query]);
  const pageCount = Math.max(1, Math.ceil(visiblePacks.length / 64));
  const pagedPacks = visiblePacks.slice((page - 1) * 64, page * 64);

  const importPack = async (file: File) => {
    try {
      if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('请导入资源压缩包（.zip）');
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const manifestEntry = archive['pack.json'] || archive['manifest.json'];
      const assetPaths = Object.keys(archive).filter((path) => !path.endsWith('/') && !path.split('/').some((part) => part.startsWith('.')) && !path.endsWith('pack.json') && !path.endsWith('manifest.json') && !/^preview\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(path));
      const inferredCategories = [...new Set(assetPaths.map((path) => path.split('/')[0]).filter(Boolean))];
      const extensions = assetPaths.map((path) => path.split('.').pop()?.toLowerCase());
      const has3d = extensions.some((extension) => ['fbx', 'glb', 'gltf', 'obj', 'blend'].includes(extension || ''));
      const has2d = extensions.some((extension) => ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(extension || ''));
      const inferredDimension = has3d && !has2d ? '3D' : has2d && !has3d ? '2D' : 'agnostic';
      const fallbackId = file.name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `pack-${Date.now()}`;
      const generated: ResourcePackSummary = {
        id: fallbackId,
        name: file.name.replace(/\.zip$/i, ''),
        style: '未标注',
        gameTypes: [],
        dimension: inferredDimension,
        categories: inferredCategories,
        license: '待补充',
        version: '0.1.0',
        status: 'draft',
        coverPath: Object.keys(archive).find((path) => /^preview\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(path)),
        elementCount: assetPaths.length,
      };
      const parsed = manifestEntry ? { ...generated, ...(JSON.parse(strFromU8(manifestEntry)) as Partial<ResourcePackSummary>) } : generated;
      const localElements: ResourceElement[] = assetPaths.map((path, index) => {
        const extension = path.split('.').pop()?.toLowerCase() || '';
        const category = path.split('/')[0] || 'assets';
        const kind = ['fbx', 'glb', 'gltf', 'obj', 'blend'].includes(extension) ? 'model' : ['mp3', 'wav', 'ogg'].includes(extension) ? 'audio' : ['ttf', 'otf', 'woff', 'woff2'].includes(extension) ? 'font' : 'image';
        return { id: `${parsed.id}-${index}`, packId: parsed.id, name: path.split('/').pop() || path, path, category, kind, specs: {}, dependencies: [], status: 'ready' };
      });
      setPacks((current) => [parsed, ...current.filter((pack) => pack.id !== parsed.id)]);
      setLocalElementsByPack((current) => ({ ...current, [parsed.id]: localElements }));
      setLocalLibrary((current) => ({ packs: [parsed, ...current.packs.filter((pack) => pack.id !== parsed.id)], elementsByPack: { ...current.elementsByPack, [parsed.id]: localElements } }));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源包导入失败');
    }
  };

  const importDroppedPacks = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) await importPack(file);
    }
  };

  if (selectedPack) {
    return (
      <PackBrowser
        pack={selectedPack}
        elements={elements}
        selectedElement={selectedElement}
        activeCategory={activeCategory}
        loading={loading}
        error={error}
        onBack={() => {
          setSelectedPack(null);
          setSelectedElement(null);
        }}
        onCategory={selectCategory}
        onElement={setSelectedElement}
        onEditPack={(name) => {
          const updated = { ...selectedPack, name };
          setSelectedPack(updated);
          setPacks((current) => current.map((item) => item.id === updated.id ? { ...item, name } : item));
          setLocalLibrary((current) => ({ ...current, packs: current.packs.map((item) => item.id === updated.id ? { ...item, name } : item) }));
        }}
        onAddFile={() => {
          const name = window.prompt('文件名', 'new-asset.png')?.trim();
          if (!name || !activeCategory) return;
          const next: ResourceElement = { id: `local-${Date.now()}`, packId: selectedPack.id, name, path: `${activeCategory}/${name}`, category: activeCategory, kind: 'file', specs: {}, dependencies: [], status: 'ready' };
          setElements((current) => [...current, next]);
          setSelectedElement(next);
          setLocalElementsByPack((current) => ({ ...current, [selectedPack.id]: [...(current[selectedPack.id] || []), next] }));
          setLocalLibrary((current) => ({ ...current, elementsByPack: { ...current.elementsByPack, [selectedPack.id]: [...(current.elementsByPack[selectedPack.id] || []), next] } }));
        }}
        onDropFile={(file) => {
          if (!activeCategory) return;
          const next: ResourceElement = { id: `local-${Date.now()}`, packId: selectedPack.id, name: file.name, path: `${activeCategory}/${file.name}`, category: activeCategory, kind: 'file', specs: { size: file.size, type: file.type }, dependencies: [], status: 'ready' };
          setElements((current) => [...current, next]);
          setSelectedElement(next);
          setLocalElementsByPack((current) => ({ ...current, [selectedPack.id]: [...(current[selectedPack.id] || []), next] }));
          setLocalLibrary((current) => ({ ...current, elementsByPack: { ...current.elementsByPack, [selectedPack.id]: [...(current.elementsByPack[selectedPack.id] || []), next] } }));
        }}
      />
    );
  }

  return (
    <section className={`relative min-h-full bg-zinc-950 px-8 py-8 text-zinc-100 ${isRootDragActive ? 'ring-2 ring-inset ring-orange-300/70' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsRootDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsRootDragActive(false); }} onDrop={(event) => { event.preventDefault(); setIsRootDragActive(false); void importDroppedPacks(event.dataTransfer.files); }}>
      {isRootDragActive ? <div className="pointer-events-none absolute inset-4 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-orange-300/70 bg-orange-400/10 text-orange-100"><div className="rounded-2xl bg-zinc-950/80 px-6 py-4 text-center shadow-2xl"><div className="type-headline">松开以导入资源包</div><div className="type-footnote mt-1 text-zinc-400">支持 ZIP 资源压缩包</div></div></div> : null}
      <input ref={importInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importPack(file);
        event.target.value = '';
      }} />
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-red-300/20 bg-red-400/10 p-4 text-red-200"
        >
          {error}
        </div>
      ) : null}
      {loading && packs.length === 0 ? (
        <div className="type-footnote text-zinc-500">正在加载资源包…</div>
      ) : null}
      <div className="mb-5 flex items-center gap-2 border-b border-white/10 pb-4">
        <div className="type-headline flex items-center gap-3">{copy.all} <button type="button" aria-label={copy.import} onClick={() => importInputRef.current?.click()} className="glass-icon-button h-8 w-8 text-lg">+</button></div>
        <div className="flex-1" />
        <label className="glass-control flex h-9 w-64 items-center gap-2 rounded-xl px-3 text-zinc-500">
          <Search className="h-4 w-4" />
          <input aria-label={copy.search} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={copy.search} className="min-w-0 flex-1 bg-transparent outline-none" />
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
          <PackCard key={pack.id} pack={pack} onOpen={() => void openPack(pack)} />
        ))}
      </div>
      {!loading && visiblePacks.length === 0 ? <EmptyState onImport={() => importInputRef.current?.click()} title={copy.empty} hint={copy.emptyHint} importLabel={copy.import} /> : null}
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
      <ResourceLibraryView />
    </div>
  );
}

function Summary({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="type-caption-2 text-zinc-500">{label}</div>
      <div className="type-title-3 mt-2">
        {value}
        <span className="type-caption-2 ml-2 text-zinc-500">{suffix}</span>
      </div>
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

function PackCard({ pack, onOpen }: { pack: ResourcePackSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={pack.name}
      onClick={onOpen}
      className="group rounded-[1.4rem] border border-white/10 bg-white/[0.025] p-3 text-left transition hover:border-white/25 hover:bg-white/[0.05]"
    >
      <div className="grid h-44 place-items-center rounded-2xl bg-gradient-to-br from-orange-200/30 via-zinc-800 to-zinc-950 text-6xl shadow-inner">
        ✦
      </div>
      <h2 className="type-headline mt-4 truncate text-zinc-100">{pack.name}</h2>
      <p className="type-footnote mt-1 text-zinc-500">
        v{pack.version || '—'} · {pack.license || '未标注授权'}
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
  pack,
  elements,
  selectedElement,
  activeCategory,
  loading,
  error,
  onBack,
  onCategory,
  onElement,
  onEditPack,
  onAddFile,
  onDropFile,
}: {
  pack: ResourcePackSummary;
  elements: ResourceElement[];
  selectedElement: ResourceElement | null;
  activeCategory?: string;
  loading: boolean;
  error: string;
  onBack: () => void;
  onCategory: (category: string) => void;
  onElement: (element: ResourceElement) => void;
  onEditPack: (name: string) => void;
  onAddFile: () => void;
  onDropFile: (file: File) => void;
}) {
  const categories = useMemo(() => pack.categories || [], [pack.categories]);
  return (
    <section className="flex min-h-full flex-col bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-4 flex items-center justify-between">
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
            <h1 className="type-title-3">{pack.name}</h1>
            <p className="type-footnote mt-1 text-zinc-500">
              {pack.style} · {pack.dimension} · {pack.elementCount} 个元素
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="secondary-pill type-button px-4 py-2" onClick={() => {
            const name = window.prompt('Pack 名称', pack.name)?.trim();
            if (name) onEditPack(name);
          }}>
            编辑 Pack 信息
          </button>
          <button type="button" className="primary-pill type-button px-4 py-2" onClick={onAddFile}>
            ＋ 添加文件
          </button>
        </div>
      </div>
      <div className="mb-5 flex gap-2">
        {pack.gameTypes?.map((type) => (
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
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] border-y border-white/10">
        <aside className="border-r border-white/10 py-4 pr-3">
          <div className="type-caption-1 mb-3 px-3 text-zinc-500">Pack 文件</div>
          <TreeRow
            icon={<Folder className="h-4 w-4 text-orange-300" />}
            label={pack.name}
            count={pack.elementCount}
            active
          />
          <div className="mt-1">
            {categories.map((category) => (
              <div key={category}>
                <TreeRow
                  icon={<Folder className="h-4 w-4 text-orange-300" />}
                  label={categoryLabels[category] || category}
                  count={category === activeCategory ? elements.length : undefined}
                  active={category === activeCategory}
                  onClick={() => onCategory(category)}
                />
                {category === activeCategory
                  ? elements.map((element) => (
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
          </div>
        </aside>
        <div className="relative min-w-0 p-5" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) onDropFile(file); }}>
          <div className="mb-4 flex items-center justify-between">
            <div className="type-footnote text-zinc-500">
              {pack.name} <ChevronRight className="mx-1 inline h-3 w-3" />{' '}
              <span className="text-zinc-200">
                {categoryLabels[activeCategory || ''] || activeCategory}
              </span>
            </div>
            <div className="flex gap-1">
              <button type="button" className="glass-icon-button h-8 w-8">
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button type="button" className="glass-icon-button h-8 w-8">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
          {error ? (
            <div role="alert" className="mb-4 rounded-xl bg-red-400/10 p-3 text-red-200">
              {error}
            </div>
          ) : null}
          <div className="grid min-h-[520px] place-items-center rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black p-5">
            {selectedElement ? (
              <Preview element={selectedElement} pack={pack} />
            ) : (
              <div className="type-footnote text-zinc-600">
                {loading ? '正在加载…' : '请选择一个元素'}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TreeRow({
  icon,
  label,
  count,
  active,
  onClick,
  ariaLabel,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`type-caption-2 flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left ${active ? 'bg-orange-400/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {count === undefined ? null : <span className="ml-auto text-zinc-600">{count}</span>}
    </button>
  );
}

function Preview({ element, pack }: { element: ResourceElement; pack: ResourcePackSummary }) {
  return (
    <div className="relative h-full w-full rounded-2xl bg-[radial-gradient(circle_at_50%_45%,rgba(161,161,170,.65),rgba(24,24,27,.95)_65%)]">
      <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/40 px-2 py-1 type-caption-2 text-zinc-400">
        预览 · {element.kind}
      </div>
      <div className="grid h-full place-items-center text-8xl">
        {element.preview?.kind === 'image' ? '🧙' : <File className="h-20 w-20 text-zinc-500" />}
      </div>
      <ResourceInspectorOverlay element={element} pack={pack} />
    </div>
  );
}

function ResourceInspectorOverlay({
  element,
  pack,
}: {
  element: ResourceElement;
  pack: ResourcePackSummary;
}) {
  return (
    <aside
      role="complementary"
      aria-label="元素属性"
      className="absolute bottom-4 right-4 w-72 rounded-2xl border border-white/15 bg-zinc-950/85 p-4 shadow-2xl backdrop-blur-2xl"
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
        <X className="h-4 w-4 text-zinc-600" />
      </div>
      <div className="space-y-2 border-t border-white/10 pt-3">
        <Property label="继承 Pack" value={pack.name} />
        <Property label="风格" value={element.styleOverride || pack.style} />
        <Property label="表现" value={element.dimensionOverride || pack.dimension} />
        <Property label="路径" value={element.path} />
        <Property label="状态" value={element.status} />
        <Property
          label="规格"
          value={Object.entries(element.specs)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        />
      </div>
      <p className="type-caption-2 mt-3 border-t border-white/10 pt-3 text-zinc-500">
        元素继承 Pack 的风格与表现维度，AI 将基于这些约束进行匹配。
      </p>
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
