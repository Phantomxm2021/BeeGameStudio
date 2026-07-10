import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [packs, setPacks] = useState<ResourcePackSummary[]>([]);
  const [selectedPack, setSelectedPack] = useState<ResourcePackSummary | null>(null);
  const [elements, setElements] = useState<ResourceElement[]>([]);
  const [selectedElement, setSelectedElement] = useState<ResourceElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [dimension, setDimension] = useState<'all' | '2D' | '3D'>('all');
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
    setError('');
    setLoading(true);
    try {
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

  const importPack = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ResourcePackSummary;
      if (!parsed.id || !parsed.name || !parsed.dimension) throw new Error('Pack JSON 缺少 id、name 或 dimension');
      setPacks((current) => [parsed, ...current.filter((pack) => pack.id !== parsed.id)]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源包导入失败');
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
        }}
        onAddFile={() => {
          const name = window.prompt('文件名', 'new-asset.png')?.trim();
          if (!name || !activeCategory) return;
          const next: ResourceElement = { id: `local-${Date.now()}`, packId: selectedPack.id, name, path: `${activeCategory}/${name}`, category: activeCategory, kind: 'file', specs: {}, dependencies: [], status: 'ready' };
          setElements((current) => [...current, next]);
          setSelectedElement(next);
        }}
      />
    );
  }

  return (
    <section className="min-h-full bg-zinc-950 px-8 py-8 text-zinc-100">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="type-caption-1 mb-2 text-orange-300">资源库管理</p>
          <h1 className="type-title-2">资源包</h1>
          <p className="type-footnote mt-2 text-zinc-500">按风格、游戏类型与表现维度选择 Pack</p>
        </div>
        <button type="button" className="primary-pill type-button px-4 py-2" onClick={() => importInputRef.current?.click()}>
          ＋ 导入资源包
        </button>
        <input ref={importInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importPack(file);
          event.target.value = '';
        }} />
      </div>
      <div className="mb-7 flex gap-3">
        <Summary label="已导入" value={String(packs.length)} suffix="个 Pack" />
        <Summary
          label="全部元素"
          value={String(packs.reduce((total, pack) => total + pack.elementCount, 0))}
          suffix="可用"
        />
      </div>
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
        <div className="type-headline">所有资源包</div>
        <div className="flex-1" />
        <label className="glass-control flex h-9 w-64 items-center gap-2 rounded-xl px-3 text-zinc-500">
          <Search className="h-4 w-4" />
          <input aria-label="搜索资源包" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资源包" className="min-w-0 flex-1 bg-transparent outline-none" />
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
        {visiblePacks.map((pack) => (
          <PackCard key={pack.id} pack={pack} onOpen={() => void openPack(pack)} />
        ))}
      </div>
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
        <div className="relative min-w-0 p-5">
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
