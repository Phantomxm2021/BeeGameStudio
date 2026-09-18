import { useEffect, useMemo, useRef, useState } from 'react';
import { currentKeyboardLabels } from '@beegame/scene-editor/platform';
import {
  BoxSelect,
  Circle,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ListChecks,
  Menu,
  Magnet,
  Maximize2,
  MousePointer2,
  MousePointerBan,
  Move,
  PanelTop,
  PanelsTopLeft,
  Pencil,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Scaling,
  SlidersHorizontal,
  Type,
  ToggleLeft,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  beeGameAdapter,
  type BeeGameUiContentDocument,
  type BeeGameUiContentNode,
} from '../../services/beeGameAdapter';
import { EditorLoadingView, type EditorLoadState } from './EditorLoadingView';
import { Checkbox } from '../beui/registry/components/motion/checkbox';
import { ProjectSelect } from '../beui/project-select';
import './SceneEditorOverlay.css';
import './UiEditorOverlay.css';

interface UiEditorOverlayProps {
  projectId: string;
  onClose: () => void;
}

type UiSnapshot = {
  path: string;
  revision: string;
  document: BeeGameUiContentDocument;
};

type UiAssetOption = {
  id: string;
  label: string;
  members: string[];
  font: boolean;
};

const UI_IMAGE = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)$/i;
const UI_FONT = /\.(?:woff2?|ttf|otf)$/i;
const INITIAL_UI_LOAD_STATE: EditorLoadState = {
  status: 'loading',
  progress: 8,
  label: 'Opening UI',
  detail: 'Connecting to the project…',
};
type GizmoMode = 'select' | 'move' | 'rotate' | 'scale';
type UiComponentKind = 'text' | 'image' | 'button' | 'slider' | 'dropdown' | 'tab' | 'toggle' | 'panel';
type UnityImageType = 'simple' | 'sliced' | 'tiled' | 'filled';
type UiNodeKind =
  | 'canvas' | 'flow' | 'flow-screen' | 'container'
  | 'text' | 'image' | 'nine-slice' | 'button' | 'slider' | 'toggle'
  | 'shape' | 'keycap' | 'toast' | 'world-prompt' | 'capsule-segment'
  | 'particle-system' | 'other';
const UI_COMPONENTS: Array<{ kind: UiComponentKind; label: string }> = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'button', label: 'Button' },
  { kind: 'slider', label: 'Slider' },
  { kind: 'dropdown', label: 'Dropdown' },
  { kind: 'tab', label: 'Tab' },
  { kind: 'toggle', label: 'Toggle' },
  { kind: 'panel', label: 'Panel' },
];
const ANCHOR_PRESETS = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;
type TransformDrag = {
  kind: Exclude<GizmoMode, 'select'>;
  startX: number;
  startY: number;
  position: [number, number];
  scale: [number, number];
  rotation: number;
  centerX: number;
  centerY: number;
  pointerAngle: number;
  before: UiSnapshot;
  changed: boolean;
};

export function UiEditorOverlay({ projectId, onClose }: UiEditorOverlayProps) {
  const keyboard = currentKeyboardLabels();
  const [documents, setDocuments] = useState<UiSnapshot[]>([]);
  const [current, setCurrent] = useState<UiSnapshot>();
  const [selectedId, setSelectedId] = useState('');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [assetOptions, setAssetOptions] = useState<UiAssetOption[]>([]);
  const [fontFamilies, setFontFamilies] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('Loading project UI…');
  const [loadState, setLoadState] = useState<EditorLoadState>(INITIAL_UI_LOAD_STATE);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState({ hierarchy: false, inspector: false });
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('move');
  const [showGizmos, setShowGizmos] = useState(true);
  const [snap, setSnap] = useState(false);
  const [panning, setPanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string }>();
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [unpickableIds, setUnpickableIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const transformRef = useRef<TransformDrag | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const imagePickerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<UiSnapshot[]>([]);
  const redoRef = useRef<UiSnapshot[]>([]);
  const currentRef = useRef<UiSnapshot | undefined>(undefined);
  const savedContentRef = useRef<Record<string, string>>({});
  const loadControllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadControllerRef.current = controller;
    let active = true;
    const objectUrls: string[] = [];
    const updateLoadState = (next: Omit<EditorLoadState, 'status'>) => {
      if (active && !signal.aborted) setLoadState({ status: 'loading', ...next });
    };
    setDocuments([]);
    setCurrent(undefined);
    currentRef.current = undefined;
    setSelectedId('');
    setAssetUrls({});
    setAssetOptions([]);
    setFontFamilies({});
    setHiddenIds(new Set());
    setUnpickableIds(new Set());
    setImagePickerOpen(false);
    setMessage('Loading project UI…');
    setLoadState(INITIAL_UI_LOAD_STATE);
    void beeGameAdapter.getProjectGameContent(projectId, signal).then(async snapshot => {
      if (!active) return;
      if ((snapshot.state !== 'ready' && snapshot.state !== 'draft') || !snapshot.documents) {
        setLoadState({ status: 'error', progress: 20, label: 'UI unavailable', detail: `UI content is not available yet (${snapshot.state.replaceAll('_', ' ')}).` });
        return;
      }
      const uiDocuments = snapshot.documents.flatMap(item => {
        const document = item.document as Partial<BeeGameUiContentDocument>;
        return document.kind === 'ui-screen' || document.kind === 'ui-hud' || document.kind === 'ui-flow'
          ? [{ ...item, document: item.document as BeeGameUiContentDocument }]
          : [];
      });
      if (!uiDocuments.length) {
        setLoadState({ status: 'error', progress: 28, label: 'No UI found', detail: 'The content package has no UI documents.' });
        return;
      }
      const uiLabel = uiDocuments[0].document.id;
      setDocuments(uiDocuments);
      savedContentRef.current = Object.fromEntries(uiDocuments.map(document => [document.path, JSON.stringify(document.document)]));
      const initialDocument = structuredClone(uiDocuments[0]);
      currentRef.current = initialDocument;
      setCurrent(initialDocument);
      setSelectedId(uiDocuments[0].document.data.rootId);
      setExpandedIds(new Set(uiDocuments[0].document.data.nodes.map(node => node.id)));
      undoRef.current = [];
      redoRef.current = [];
      setMessage('Loading UI assets…');
      updateLoadState({ progress: 32, label: uiLabel, detail: 'UI document loaded' });

      try {
        const manifest = await beeGameAdapter.getProjectAssets(projectId, signal);
        if (!active) return;
        const resources = manifest.resources.filter(resource => resource.status === 'verified');
        setAssetOptions(resources.map(resource => ({
          id: resource.id,
          label: resource.id,
          members: resource.file_paths.filter(path => UI_IMAGE.test(path)).map(fileStem),
          font: resource.file_paths.some(path => UI_FONT.test(path)) || /font/i.test(resource.asset_kind ?? resource.id),
        })));
        const loadTargets = resources.flatMap(resource => resource.file_paths
          .filter(path => UI_IMAGE.test(path) || UI_FONT.test(path))
          .map(path => ({ resourceId: resource.id, path })));
        const totalFiles = loadTargets.length;
        let loadedFiles = 0;
        const markFileLoaded = (resourceId: string, path: string) => {
          loadedFiles += 1;
          updateLoadState({
            progress: totalFiles ? 40 + Math.round((loadedFiles / totalFiles) * 54) : 94,
            label: uiLabel,
            detail: totalFiles
              ? `${resourceId} · ${path.split('/').at(-1) ?? path} · ${loadedFiles} of ${totalFiles}`
              : 'No external UI assets required',
          });
        };
        updateLoadState({
          progress: 40,
          label: uiLabel,
          detail: totalFiles
            ? `${loadTargets[0].resourceId} · ${loadTargets[0].path.split('/').at(-1) ?? loadTargets[0].path} · 0 of ${totalFiles}`
            : 'No external UI assets required',
        });
        const loaded = await Promise.all(manifest.resources
          .filter(resource => resource.status === 'verified')
          .flatMap(resource => resource.file_paths
            .filter(path => UI_IMAGE.test(path))
            .map(async path => {
              try {
                const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal);
                const url = URL.createObjectURL(blob);
                if (!active) {
                  URL.revokeObjectURL(url);
                  return [] as Array<readonly [string, string]>;
                }
                objectUrls.push(url);
                const member = fileStem(path);
                const entries: Array<readonly [string, string]> = [[`${resource.id}:${member}`, url]];
                if (path === resource.root_path) entries.push([resource.id, url]);
                return entries;
              } catch (error) {
                if (isUiAbortError(error)) throw error;
                return [] as Array<readonly [string, string]>;
              } finally {
                if (!signal.aborted) markFileLoaded(resource.id, path);
              }
            })));
        if (!active) return;
        const entries = loaded.flat();
        for (const resource of manifest.resources) {
          if (entries.some(([key]) => key === resource.id)) continue;
          const first = entries.find(([key]) => key.startsWith(`${resource.id}:`));
          if (first) entries.push([resource.id, first[1]]);
        }
        setAssetUrls(Object.fromEntries(entries));
        const fonts = await Promise.all(resources.flatMap(resource => {
          const path = resource.file_paths.find(item => UI_FONT.test(item));
          if (!path) return [];
          return [beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal).then(async blob => {
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            const family = `BGS-${resource.id.replace(/[^a-z0-9_-]/gi, '-')}`;
            if (typeof FontFace !== 'undefined') {
              const face = new FontFace(family, `url(${url})`);
              await face.load();
              document.fonts.add(face);
            }
            return [resource.id, family] as const;
          }).catch(error => {
            if (isUiAbortError(error)) throw error;
            return undefined;
          }).finally(() => {
            if (!signal.aborted) markFileLoaded(resource.id, path);
          })];
        }));
        if (active) setFontFamilies(Object.fromEntries(fonts.filter((item): item is readonly [string, string] => Boolean(item))));
        setMessage('');
        updateLoadState({ progress: 100, label: uiLabel, detail: 'UI ready' });
        await waitForUiTransition(signal);
        if (active && !signal.aborted) setLoadState({ status: 'ready', progress: 100, label: uiLabel, detail: 'UI ready' });
      } catch (error) {
        if (active && !isUiAbortError(error)) {
          setLoadState({ status: 'error', progress: 40, label: 'UI assets could not be loaded', detail: error instanceof Error ? error.message : String(error) });
        }
      }
    }).catch(error => {
      if (active && !isUiAbortError(error)) setLoadState({ status: 'error', progress: 0, label: 'Could not open UI', detail: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [projectId, loadAttempt]);

  const selected = current?.document.data.nodes.find(node => node.id === selectedId);
  const children = useMemo(() => childIds(current?.document.data.nodes ?? []), [current]);
  const imageAssets = assetOptions.filter(option => !option.font && option.members.length);
  const fontAssets = assetOptions.filter(option => option.font);
  const selectedFont = typeof selected?.data?.font === 'object' && selected.data.font !== null
    ? selected.data.font as { assetRef?: unknown }
    : undefined;
  const selectedImage = typeof selected?.data?.image === 'object' && selected.data.image !== null
    ? selected.data.image as Record<string, unknown>
    : {};
  const selectedImageType = typeof selectedImage.type === 'string'
    ? selectedImage.type as UnityImageType
    : selected && isNineSliceRole(selected.role) ? 'sliced' : 'simple';
  const selectedBorder = typeof selected?.data?.border === 'object' && selected.data.border !== null
    ? selected.data.border as Record<string, unknown>
    : {};
  const selectedKind = selected ? uiNodeKind(selected.role) : 'other';
  const textCapable = selected ? supportsTextNode(selectedKind) : false;
  const imageCapable = selected ? supportsImageNode(selectedKind) : false;
  const visualNode = selected ? isVisualNode(selectedKind) : false;

  useEffect(() => {
    if (current && !current.document.data.nodes.some(node => node.id === selectedId)) {
      setSelectedId(current.document.data.rootId);
    }
  }, [current, selectedId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setAddMenuOpen(false);
        setScreenMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!imagePickerOpen) return;
    const close = (event: PointerEvent) => {
      if (!imagePickerRef.current?.contains(event.target as Node)) setImagePickerOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [imagePickerOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    contextMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  const chooseDocument = (path: string) => {
    const drafts = documents.map(document => current && document.path === current.path ? current : document);
    const next = drafts.find(document => document.path === path);
    if (!next) return;
    setDocuments(drafts);
    const clone = structuredClone(next);
    currentRef.current = clone;
    setCurrent(clone);
    setSelectedId(clone.document.data.rootId);
    setExpandedIds(new Set(clone.document.data.nodes.map(node => node.id)));
    setHiddenIds(new Set());
    setUnpickableIds(new Set());
    setImagePickerOpen(false);
    setScreenMenuOpen(false);
    undoRef.current = [];
    redoRef.current = [];
    setMessage('');
  };

  const applyCurrent = (next: UiSnapshot) => {
    currentRef.current = next;
    setCurrent(next);
  };

  const pushUndo = (snapshot: UiSnapshot) => {
    undoRef.current.push(structuredClone(snapshot));
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
  };

  const commitCurrent = (update: (snapshot: UiSnapshot) => void) => {
    const value = currentRef.current;
    if (!value) return;
    const next = structuredClone(value);
    update(next);
    pushUndo(value);
    applyCurrent(next);
  };

  const undo = () => {
    const value = currentRef.current;
    const previous = undoRef.current.pop();
    if (!value || !previous) return;
    redoRef.current.push(structuredClone(value));
    applyCurrent(previous);
  };

  const redo = () => {
    const value = currentRef.current;
    const next = redoRef.current.pop();
    if (!value || !next) return;
    undoRef.current.push(structuredClone(value));
    applyCurrent(next);
  };

  const updateSelected = (update: (node: BeeGameUiContentNode) => void) => {
    commitCurrent(next => {
      const node = next.document.data.nodes.find(item => item.id === selectedId);
      if (node) update(node);
    });
  };

  const updateSelectedTransient = (update: (node: BeeGameUiContentNode) => void) => {
    const value = currentRef.current;
    if (!value) return;
    const next = structuredClone(value);
    const node = next.document.data.nodes.find(item => item.id === selectedId);
    if (!node) return;
    update(node);
    applyCurrent(next);
  };

  const updateLayout = (field: 'position' | 'size', index: number, value: number) => {
    updateSelected(node => {
      const layout = node.layout ?? {};
      const pair = [...(layout[field] ?? (field === 'size' ? [160, 48] : [0, 0]))] as [number, number];
      pair[index] = value;
      node.layout = { ...layout, [field]: pair };
    });
  };

  const updateScale = (index: number, value: number) => {
    updateSelected(node => {
      const layout = node.layout ?? {};
      const scale = [...(layout.scale ?? [1, 1])] as [number, number];
      scale[index] = value;
      node.layout = { ...layout, scale };
    });
  };

  const updateRotation = (degrees: number) => {
    updateSelected(node => {
      node.layout = { ...node.layout, rotation: degrees * Math.PI / 180 };
    });
  };

  const updateRotation3D = (index: number, degrees: number) => {
    updateSelected(node => {
      const currentRotation = Array.isArray(node.data?.rotation3D) ? node.data.rotation3D : [0, 0, Math.round((node.layout?.rotation ?? 0) * 180 / Math.PI)];
      const rotation = [Number(currentRotation[0]) || 0, Number(currentRotation[1]) || 0, Number(currentRotation[2]) || 0];
      rotation[index] = degrees;
      node.data = { ...node.data, rotation3D: rotation };
      if (index === 2) node.layout = { ...node.layout, rotation: degrees * Math.PI / 180 };
    });
  };

  const updateStyle = (key: string, value: unknown) => {
    updateSelected(node => { node.style = { ...node.style, [key]: value }; });
  };

  const updateData = (key: string, value: unknown) => {
    updateSelected(node => { node.data = { ...node.data, [key]: value }; });
  };

  const updateImage = (key: string, value: unknown) => {
    updateSelected(node => {
      const image = typeof node.data?.image === 'object' && node.data.image !== null ? node.data.image as Record<string, unknown> : {};
      node.data = { ...node.data, image: { ...image, [key]: value } };
    });
  };

  const updateBorder = (key: 'left' | 'right' | 'top' | 'bottom', value: number) => {
    updateSelected(node => {
      const border = typeof node.data?.border === 'object' && node.data.border !== null ? node.data.border as Record<string, unknown> : {};
      node.data = { ...node.data, border: { ...border, [key]: Math.max(0, value) } };
    });
  };

  const updateText = (value: string) => {
    updateSelected(node => {
      const label = typeof node.data?.label === 'object' && node.data.label !== null ? node.data.label as Record<string, unknown> : undefined;
      if (node.text !== undefined || !label) node.text = value;
      else node.data = { ...node.data, label: { ...label, content: value } };
    });
  };

  const updateRecord = (field: 'bindings' | 'actions' | 'style' | 'data', value: Record<string, unknown>) => {
    updateSelected(node => {
      if (field === 'bindings' || field === 'actions') {
        node[field] = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
      } else {
        node[field] = value;
      }
    });
  };

  const beginRename = (node: BeeGameUiContentNode) => {
    setRenamingId(node.id);
    setRenameValue(node.name ?? node.id);
  };

  const finishRename = () => {
    const nextName = renameValue.trim();
    if (nextName) updateSelected(node => { node.name = nextName; });
    setRenamingId('');
  };

  const duplicateSelected = () => {
    if (!current || !selected || selected.id === current.document.data.rootId) return;
    const nodes = current.document.data.nodes;
    const descendants = new Set<string>([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
          descendants.add(node.id);
          changed = true;
        }
      }
    }
    const used = new Set(nodes.map(node => node.id));
    const ids = new Map<string, string>();
    for (const id of descendants) ids.set(id, uniqueCopyId(id, used));
    const copies = nodes.filter(node => descendants.has(node.id)).map(node => {
      const copy = structuredClone(node);
      copy.id = ids.get(node.id)!;
      if (copy.parentId && ids.has(copy.parentId)) copy.parentId = ids.get(copy.parentId);
      if (node.id === selected.id) {
        copy.name = `${node.name ?? node.id} Copy`;
        const [x, y] = copy.layout?.position ?? [0, 0];
        copy.layout = { ...copy.layout, position: [x + 16, y + 16] };
      }
      return copy;
    });
    commitCurrent(next => { next.document.data.nodes.push(...copies); });
    setSelectedId(ids.get(selected.id)!);
    setMessage('Duplicated');
  };

  const deleteSelected = () => {
    if (!current || !selected || selected.id === current.document.data.rootId) return;
    const removed = new Set([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of current.document.data.nodes) {
        if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
          removed.add(node.id);
          changed = true;
        }
      }
    }
    const nextSelection = selected.parentId ?? current.document.data.rootId;
    commitCurrent(next => { next.document.data.nodes = next.document.data.nodes.filter(node => !removed.has(node.id)); });
    setSelectedId(nextSelection);
    setContextMenu(undefined);
    setMessage(`Deleted ${selected.name ?? selected.id}`);
  };

  const selectImageAsset = (resourceId: string, member?: string) => {
    if (!current || !selected) return;
    const option = assetOptions.find(item => item.id === resourceId);
    commitCurrent(next => {
      const node = next.document.data.nodes.find(item => item.id === selected.id);
      if (!node) return;
      node.assetRef = resourceId || undefined;
      node.data = { ...node.data };
      if (resourceId && (member ?? option?.members[0])) node.data.member = member ?? option?.members[0];
      else delete node.data.member;
      if (resourceId && !next.document.assetRefs.includes(resourceId)) next.document.assetRefs.push(resourceId);
    });
    setImagePickerOpen(false);
  };

  const toggleEditorSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter(value => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectFontAsset = (resourceId: string) => {
    if (!current || !selected) return;
    commitCurrent(next => {
      const node = next.document.data.nodes.find(item => item.id === selected.id);
      if (!node) return;
      const font = typeof node.data?.font === 'object' && node.data.font !== null ? node.data.font as Record<string, unknown> : {};
      node.data = { ...node.data, font: { ...font, assetRef: resourceId || undefined } };
      if (resourceId && !next.document.assetRefs.includes(resourceId)) next.document.assetRefs.push(resourceId);
    });
  };

  const addComponent = (kind: UiComponentKind) => {
    if (!current) return;
    const parent = selected && isContainerRole(selected.role) ? selected : current.document.data.nodes.find(node => node.id === current.document.data.rootId);
    const used = new Set(current.document.data.nodes.map(node => node.id));
    const node = createUiComponent(kind, uniqueNodeId(kind, used), parent?.id ?? current.document.data.rootId);
    commitCurrent(next => { next.document.data.nodes.push(node); });
    setExpandedIds(value => new Set(value).add(node.parentId ?? current.document.data.rootId));
    setSelectedId(node.id);
    setMenuOpen(false);
    setAddMenuOpen(false);
    setMessage(`Added ${node.name}`);
  };

  const resetView = () => {
    setZoom(0.8);
    setPan({ x: 0, y: 0 });
  };

  const closeEditor = () => {
    loadControllerRef.current?.abort();
    onClose();
  };

  const retryLoading = () => {
    setLoadState(INITIAL_UI_LOAD_STATE);
    setLoadAttempt(value => value + 1);
  };

  const beginTransform = (kind: TransformDrag['kind'], event: React.PointerEvent<HTMLElement>) => {
    const snapshot = currentRef.current;
    if (!selected || !snapshot || selected.id === snapshot.document.data.rootId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.closest('.ui-editor-selection-gizmo')?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : event.clientX;
    const centerY = rect ? rect.top + rect.height / 2 : event.clientY;
    transformRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      position: [...(selected.layout?.position ?? [0, 0])],
      scale: [...(selected.layout?.scale ?? [1, 1])],
      rotation: selected.layout?.rotation ?? 0,
      centerX,
      centerY,
      pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      before: structuredClone(snapshot),
      changed: false,
    };
  };

  useEffect(() => {
    const pointerMove = (event: PointerEvent) => {
      const drag = transformRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / zoom;
      const dy = (event.clientY - drag.startY) / zoom;
      drag.changed = true;
      updateSelectedTransient(node => {
        if (drag.kind === 'move') {
          node.layout = { ...node.layout, position: [snapValue(drag.position[0] + dx, snap ? 8 : 0), snapValue(drag.position[1] + dy, snap ? 8 : 0)] };
        } else if (drag.kind === 'scale') {
          if (event.shiftKey) {
            const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
            const factor = Math.max(.05, 1 + delta / 160);
            node.layout = { ...node.layout, scale: [Math.max(.05, snapValue(drag.scale[0] * factor, snap ? .05 : 0)), Math.max(.05, snapValue(drag.scale[1] * factor, snap ? .05 : 0))] };
          } else {
            node.layout = { ...node.layout, scale: [Math.max(.05, snapValue(drag.scale[0] + dx / 160, snap ? .05 : 0)), Math.max(.05, snapValue(drag.scale[1] + dy / 160, snap ? .05 : 0))] };
          }
        } else {
          const angle = drag.rotation + Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) - drag.pointerAngle;
          node.layout = { ...node.layout, rotation: snap ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle };
        }
      });
    };
    const pointerUp = () => {
      const drag = transformRef.current;
      if (drag?.changed) pushUndo(drag.before);
      transformRef.current = undefined;
    };
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    return () => {
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
    };
  }, [selectedId, snap, zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.key === 'Escape') {
        if (contextMenu) setContextMenu(undefined);
        else if (imagePickerOpen) setImagePickerOpen(false);
        else if (screenMenuOpen) setScreenMenuOpen(false);
        else if (addMenuOpen) setAddMenuOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else if (renamingId) setRenamingId('');
        else closeEditor();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
      if (editing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (event.key.toLowerCase() === 'q') setGizmoMode('select');
      if (event.key.toLowerCase() === 'w') setGizmoMode('move');
      if (event.key.toLowerCase() === 'e') setGizmoMode('rotate');
      if (event.key.toLowerCase() === 'r') setGizmoMode('scale');
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && selected.id !== current?.document.data.rootId) { event.preventDefault(); deleteSelected(); }
      if ((keyboard.apple ? event.key === 'Enter' : event.key === 'F2') && selected) beginRename(selected);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
      if ((event.metaKey || event.ctrlKey) && (event.key === '=' || event.key === '+')) { event.preventDefault(); setZoom(value => clampZoom(value + .1)); }
      if ((event.metaKey || event.ctrlKey) && event.key === '-') { event.preventDefault(); setZoom(value => clampZoom(value - .1)); }
      if ((event.metaKey || event.ctrlKey) && event.key === '0') { event.preventDefault(); resetView(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function save() {
    if (!current || saving) return;
    setSaving(true);
    setMessage('Saving…');
    try {
      const saved = await beeGameAdapter.saveProjectGameContentDocument(projectId, {
        path: current.path,
        expectedRevision: current.revision,
        document: current.document,
      });
      const next = { path: saved.path, revision: saved.revision, document: saved.document };
      currentRef.current = next;
      setCurrent(next);
      setDocuments(value => value.map(item => item.path === next.path ? next : item));
      savedContentRef.current[next.path] = JSON.stringify(next.document);
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const renderHierarchyNode = (id: string): React.ReactNode => {
    if (!current) return null;
    const node = current.document.data.nodes.find(item => item.id === id);
    if (!node) return null;
    const childList = children.get(id) ?? [];
    const open = expandedIds.has(id);
    const hidden = hiddenIds.has(node.id);
    const pickable = !unpickableIds.has(node.id);
    return <div className="ui-editor-tree-node" role="treeitem" aria-label={node.name ?? node.id} aria-expanded={childList.length ? open : undefined} aria-selected={node.id === selectedId} key={node.id}>
      <div tabIndex={0} className={`ui-editor-tree-row${node.id === selectedId ? ' selected' : ''}${hidden ? ' is-hidden' : ''}${node.enabled === false ? ' is-inactive' : ''}`} onClick={() => setSelectedId(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id); }} onDoubleClick={() => { setSelectedId(node.id); beginRename(node); }} onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedId(node.id);
        setMenuOpen(false);
        setAddMenuOpen(false);
        setImagePickerOpen(false);
        setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
      }}>
        <button type="button" className={`ui-editor-tree-chevron${open ? ' expanded' : ''}`} aria-label={open ? 'Collapse' : 'Expand'} disabled={!childList.length} onClick={event => { event.stopPropagation(); setExpandedIds(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }}>{childList.length ? <ChevronRight size={12} /> : null}</button>
        <span className="ui-editor-node-icon">{roleIcon(node.role)}</span>
        {renamingId === node.id ? <input autoFocus aria-label="Rename UI element" value={renameValue} onChange={event => setRenameValue(event.target.value)} onBlur={finishRename} onKeyDown={event => { if (event.key === 'Enter') finishRename(); if (event.key === 'Escape') setRenamingId(''); }} onClick={event => event.stopPropagation()} /> : <span className="ui-editor-node-name">{node.name ?? node.id}</span>}
        <small>{node.role}</small>
        <span className="ui-editor-row-actions">
          <button type="button" aria-label={hidden ? `Show ${node.name ?? node.id}` : `Hide ${node.name ?? node.id}`} title={hidden ? 'Show in canvas' : 'Hide in canvas'} onClick={event => { event.stopPropagation(); toggleEditorSet(setHiddenIds, node.id); }}>{hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
          <button type="button" aria-label={pickable ? `Make ${node.name ?? node.id} unselectable` : `Make ${node.name ?? node.id} selectable`} title={pickable ? 'Disable canvas selection' : 'Enable canvas selection'} onClick={event => { event.stopPropagation(); toggleEditorSet(setUnpickableIds, node.id); }}>{pickable ? <MousePointer2 size={12} /> : <MousePointerBan size={12} />}</button>
        </span>
      </div>
      {open && childList.length ? <div className="ui-editor-tree-children" role="group">{childList.map(renderHierarchyNode)}</div> : null}
    </div>;
  };

  const isSaved = current
    ? savedContentRef.current[current.path] === JSON.stringify(current.document)
    : true;

  if (loadState.status !== 'ready') {
    return (
      <div className="ui-editor-overlay" role="dialog" aria-modal="true" aria-label="UI Editor">
        <EditorLoadingView
          state={loadState}
          progressLabel="UI loading progress"
          onStop={closeEditor}
          onRetry={retryLoading}
          onExit={closeEditor}
        />
      </div>
    );
  }

  return (
    <div className="ui-editor-overlay" role="dialog" aria-modal="true" aria-label="UI Editor" onContextMenu={event => event.preventDefault()}>
      <main className="ui-editor-main">
        <aside className={`ui-editor-panel ui-editor-tree${collapsedPanels.hierarchy ? ' is-collapsed' : ''}`} aria-label="UI hierarchy" inert={collapsedPanels.hierarchy}>
          <div className="ui-editor-panel-title"><strong>HIERARCHY</strong><span>{current?.document.data.nodes.length ?? 0} objects</span></div>
          <div className="ui-editor-panel-content ui-editor-tree-content" role="tree" aria-label="UI hierarchy tree">
            {current ? [current.document.data.rootId, ...current.document.data.nodes.filter(node => !node.parentId && node.id !== current.document.data.rootId).map(node => node.id)].map(renderHierarchyNode) : null}
          </div>
        </aside>
        <section
          className={`ui-editor-stage-wrap${panning ? ' is-panning' : ''}${snap ? ' show-grid' : ''}`}
          onPointerDown={event => {
            if (event.button !== 1) return;
            event.preventDefault();
            panRef.current = { x: pan.x, y: pan.y, clientX: event.clientX, clientY: event.clientY };
            setPanning(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const start = panRef.current;
            if (start) setPan({ x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY });
          }}
          onPointerUp={event => { if (panRef.current) { panRef.current = undefined; setPanning(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
          onPointerCancel={() => { panRef.current = undefined; setPanning(false); }}
          onWheel={event => {
            event.preventDefault();
            if (event.ctrlKey) {
              // macOS trackpad pinch gestures are exposed by Chromium as
              // ctrl+wheel. Keep their small deltas for smooth native zoom.
              setZoom(value => clampZoom(value * Math.exp(-event.deltaY * .01)));
              return;
            }
            // Two-finger scrolling pans the canvas on both axes. Shift+wheel
            // remains useful for horizontal panning with a conventional mouse.
            const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
            const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
            setPan(value => ({ x: value.x - dx, y: value.y - dy }));
          }}
        >
          <div ref={stageRef} className="ui-editor-stage" aria-label="UI preview" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {current ? renderUiNode(current.document.data.rootId, current.document.data.nodes, children, assetUrls, fontFamilies, selectedId, setSelectedId, hiddenIds, unpickableIds, true) : null}
            {current && showGizmos ? current.document.data.nodes
              .filter(node => node.id !== current.document.data.rootId && isTransformNode(uiNodeKind(node.role)) && node.enabled !== false && !hiddenIds.has(node.id) && !unpickableIds.has(node.id))
              .map(node => <button
                key={`gizmo-${node.id}`}
                type="button"
                className={`ui-editor-component-gizmo${node.id === selectedId ? ' selected' : ''}`}
                style={componentGizmoStyle(node, current.document.data.nodes)}
                aria-label={`Select ${node.name ?? node.id}`}
                title={`${node.name ?? node.id} · ${node.role}`}
                onPointerDown={event => { event.stopPropagation(); setSelectedId(node.id); }}
              >{roleIcon(node.role)}</button>) : null}
            {current && selected && isTransformNode(selectedKind) && selected.enabled !== false && selected.id !== current.document.data.rootId && showGizmos && !hiddenIds.has(selected.id) && !unpickableIds.has(selected.id) ? <SelectionGizmo node={selected} nodes={current.document.data.nodes} mode={gizmoMode} onBegin={beginTransform} /> : null}
          </div>
        </section>
        <div className="ui-editor-floating-toolbar" role="toolbar" aria-label="UI editor tools">
          <div className="ui-editor-main-menu" ref={menuRef} onBlur={event => {
            const next = event.relatedTarget;
            if (!next || !event.currentTarget.contains(next)) {
              setMenuOpen(false);
              setAddMenuOpen(false);
              setScreenMenuOpen(false);
            }
            }}>
            <button type="button" aria-label="Editor menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => {
              setImagePickerOpen(false);
              setContextMenu(undefined);
              setMenuOpen(value => {
                if (value) {
                  setAddMenuOpen(false);
                  setScreenMenuOpen(false);
                }
                return !value;
              });
            }}><Menu size={18} /></button>
            {menuOpen ? <div className="ui-editor-menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void save(); }} disabled={!current || saving}><Save size={14} /><span>{saving ? 'Saving…' : 'Save'}</span><kbd>{keyboard.modifier}S</kbd></button>
              <button type="button" role="menuitem" aria-label="Undo" onClick={() => { undo(); setMenuOpen(false); }} disabled={!undoRef.current.length}><Undo2 size={14} /><span>Undo</span><kbd>{keyboard.modifier}Z</kbd></button>
              <button type="button" role="menuitem" aria-label="Redo" onClick={() => { redo(); setMenuOpen(false); }} disabled={!redoRef.current.length}><Redo2 size={14} /><span>Redo</span><kbd>{keyboard.apple ? `${keyboard.shift}${keyboard.modifier}Z` : `${keyboard.modifier}Y`}</kbd></button>
              <button type="button" role="menuitem" aria-label="Delete" onClick={() => { deleteSelected(); setMenuOpen(false); }} disabled={!selected || selected.id === current?.document.data.rootId}><Trash2 size={14} /><span>Delete</span><kbd>{keyboard.delete}</kbd></button>
              {documents.length > 1 ? <div className="ui-editor-menu-submenu-wrap">
                <button type="button" role="menuitem" aria-label="Screens" aria-haspopup="menu" aria-expanded={screenMenuOpen} onClick={() => {
                  setAddMenuOpen(false);
                  setScreenMenuOpen(value => !value);
                }}><PanelsTopLeft size={14} /><span>Screens</span><ChevronRight size={13} /></button>
                {screenMenuOpen ? <div className="ui-editor-menu-popover ui-editor-menu-submenu" role="menu" aria-label="UI screens">
                  {documents.map(document => <button type="button" role="menuitem" aria-current={document.path === current?.path ? 'page' : undefined} key={document.path} onClick={() => {
                    chooseDocument(document.path);
                    setScreenMenuOpen(false);
                    setMenuOpen(false);
                  }}>{document.path === current?.path ? <CircleCheck size={14} /> : <Circle size={12} />}<span>{document.document.id}</span></button>)}
                </div> : null}
              </div> : null}
              <div className="ui-editor-menu-submenu-wrap">
                <button type="button" role="menuitem" aria-label="Add UI" aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => {
                  setScreenMenuOpen(false);
                  setAddMenuOpen(value => !value);
                }}><Plus size={14} /><span>Add UI</span><ChevronRight size={13} /></button>
                {addMenuOpen ? <div className="ui-editor-menu-popover ui-editor-menu-submenu" role="menu" aria-label="Add UI objects">
                  {UI_COMPONENTS.map(item => <button type="button" role="menuitem" key={item.kind} onClick={() => addComponent(item.kind)}>{componentMenuIcon(item.kind)}<span>{item.label}</span></button>)}
                </div> : null}
              </div>
              <div className="ui-editor-menu-divider" />
              <button type="button" role="menuitem" aria-label="Close UI Editor" onClick={closeEditor}><X size={14} /><span>Close editor</span><kbd>Esc</kbd></button>
            </div> : null}
          </div>
          <span className="ui-editor-toolbar-divider" />
          <button type="button" className={gizmoMode === 'select' ? 'active' : ''} aria-label="Select tool" title="Select (Q)" onClick={() => setGizmoMode('select')}><MousePointer2 size={16} /></button>
          <button type="button" className={gizmoMode === 'move' ? 'active' : ''} aria-label="Move tool" title="Move (W)" onClick={() => setGizmoMode('move')}><Move size={16} /></button>
          <button type="button" className={gizmoMode === 'rotate' ? 'active' : ''} aria-label="Rotate tool" title="Rotate (E)" onClick={() => setGizmoMode('rotate')}><RotateCw size={16} /></button>
          <button type="button" className={gizmoMode === 'scale' ? 'active' : ''} aria-label="Scale tool" title="Scale (R)" onClick={() => setGizmoMode('scale')}><Scaling size={16} /></button>
          <span className="ui-editor-toolbar-divider" />
          <button type="button" className={showGizmos ? 'active' : ''} aria-pressed={showGizmos} aria-label="Toggle gizmos" title="Show component gizmos" onClick={() => setShowGizmos(value => !value)}><BoxSelect size={16} /></button>
          <button type="button" className={snap ? 'active' : ''} aria-pressed={snap} aria-label="Snap" title="Snap to 8px / 15°" onClick={() => setSnap(value => !value)}><Magnet size={16} /><span>Snap</span></button>
          <span className="ui-editor-toolbar-divider" />
          <button type="button" aria-label="Zoom out" title={`Zoom out (${keyboard.modifier}-)`} onClick={() => setZoom(value => clampZoom(value - .1))}><ZoomOut size={15} /></button>
          <button type="button" className="ui-editor-zoom-value" aria-label="Reset view" title="Reset view (Ctrl/Cmd+0)" onClick={resetView}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" title={`Zoom in (${keyboard.modifier}+)`} onClick={() => setZoom(value => clampZoom(value + .1))}><ZoomIn size={15} /></button>
          <button type="button" aria-label="Frame canvas" title="Frame canvas" onClick={resetView}><Maximize2 size={15} /></button>
        </div>
        <aside className={`ui-editor-panel ui-editor-inspector${collapsedPanels.inspector ? ' is-collapsed' : ''}`} aria-label="UI inspector" inert={collapsedPanels.inspector}>
          <div className="ui-editor-panel-title"><strong>INSPECTOR</strong></div>
          <div className="ui-editor-panel-content ui-editor-inspector-content">
            {selected ? <>
              <div className="ui-editor-object-header">
                <div className="ui-editor-object-heading">
                  <span className="ui-editor-object-avatar">{roleIcon(selected.role)}</span>
                  <Checkbox aria-label="Set active" checked={selected.enabled !== false} onCheckedChange={checked => updateSelected(node => { node.enabled = checked; })} />
                  <input className="ui-editor-name-input" aria-label="Object name" value={selected.name ?? selected.id} onChange={event => updateSelected(node => { node.name = event.target.value; })} />
                </div>
                <div className="ui-editor-object-subtitle"><span>{uiNodeTypeLabel(selectedKind)}</span><span title={`${selected.role} · ${selected.id}`}>{selected.role} · {selected.id}</span></div>
              </div>
              {textCapable || imageCapable ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" />{imageCapable ? <ImageIcon size={14} /> : <Type size={14} />}<span>{imageCapable ? 'Image' : 'Text'}</span></summary><div className="ui-editor-section">
                {textCapable ? <label>Text<input value={uiNodeText(selected)} onChange={event => updateText(event.target.value)} /></label> : null}
                {imageCapable ? <>
                  <div ref={imagePickerRef} className="ui-editor-image-picker-control" onBlur={event => {
                    const next = event.relatedTarget;
                    if (!next || !event.currentTarget.contains(next)) setImagePickerOpen(false);
                  }}>
                    <div className="ui-editor-source-image-field"><span>Source Image</span><button type="button" aria-label="Choose source image" className="ui-editor-source-image" aria-haspopup="dialog" aria-expanded={imagePickerOpen} onClick={() => {
                      setMenuOpen(false);
                      setAddMenuOpen(false);
                      setContextMenu(undefined);
                      setImagePickerOpen(value => !value);
                    }}>
                      {resolveNodeImage(selected, assetUrls) ? <img src={resolveNodeImage(selected, assetUrls)} alt="" /> : <ImageIcon size={15} />}
                      <span>{typeof selected.data?.member === 'string' ? selected.data.member : selected.assetRef ?? 'None'}</span><ChevronRight size={12} />
                    </button></div>
                    {imagePickerOpen ? <div className="ui-editor-asset-picker" role="dialog" aria-label="Project image assets">
                      <div className="ui-editor-asset-picker-head"><strong>Project Assets</strong><span>{imageAssets.reduce((count, asset) => count + asset.members.length, 0)} images</span></div>
                      <button type="button" className="ui-editor-asset-card none" aria-label="No source image" onClick={() => selectImageAsset('')}><span>×</span><small>None</small></button>
                      {imageAssets.flatMap(asset => asset.members.map(member => {
                        const url = assetUrls[`${asset.id}:${member}`] ?? assetUrls[asset.id];
                        return <button type="button" className={`ui-editor-asset-card${selected.assetRef === asset.id && selected.data?.member === member ? ' selected' : ''}`} aria-label={`Use image ${member}`} key={`${asset.id}:${member}`} onClick={() => selectImageAsset(asset.id, member)}>{url ? <img src={url} alt="" /> : <ImageIcon size={18} />}<small title={`${asset.label} / ${member}`}>{member}</small></button>;
                      }))}
                      {!imageAssets.length ? <p>No verified image assets are available in this project.</p> : null}
                    </div> : null}
                  </div>
                  <EditorSelect label="Image Type" ariaLabel="Image type" value={selectedImageType} onValueChange={value => updateImage('type', value as UnityImageType)} options={[['simple', 'Simple'], ['sliced', 'Sliced'], ['tiled', 'Tiled'], ['filled', 'Filled']]} />
                  {selectedImageType === 'simple' || selectedImageType === 'filled' ? <div className="ui-editor-check-field"><span>Preserve Aspect</span><Checkbox aria-label="Preserve aspect" checked={selectedImage.preserveAspect === true || (!('preserveAspect' in selectedImage) && selected.data?.fit === 'contain')} onCheckedChange={checked => updateImage('preserveAspect', checked)} /></div> : null}
                  {selectedImageType === 'sliced' ? <div className="ui-editor-slice-border"><span>Slice Border</span>{(['left', 'right', 'top', 'bottom'] as const).map(side => <label key={side}>{side[0].toUpperCase()}<input aria-label={`Slice ${side}`} type="number" min="0" value={typeof selectedBorder[side] === 'number' ? selectedBorder[side] : 0} onChange={event => updateBorder(side, Number(event.target.value))} /></label>)}</div> : null}
                  {selectedImageType === 'filled' ? <>
                    <EditorSelect label="Fill Method" ariaLabel="Fill method" value={typeof selectedImage.fillMethod === 'string' ? selectedImage.fillMethod : 'horizontal'} onValueChange={value => updateImage('fillMethod', value)} options={[['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['radial90', 'Radial 90'], ['radial180', 'Radial 180'], ['radial360', 'Radial 360']]} />
                    <EditorSelect label="Fill Origin" ariaLabel="Fill origin" value={typeof selectedImage.fillOrigin === 'string' ? selectedImage.fillOrigin : 'start'} onValueChange={value => updateImage('fillOrigin', value)} options={[['start', 'Start'], ['end', 'End']]} />
                    <label>Fill Amount<input aria-label="Fill amount" type="range" min="0" max="1" step="0.01" value={typeof selectedImage.fillAmount === 'number' ? selectedImage.fillAmount : 1} onChange={event => updateImage('fillAmount', Number(event.target.value))} /></label>
                  </> : null}
                </> : null}
              </div></details> : null}
              {selectedKind === 'slider' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><SlidersHorizontal size={14} /><span>Slider</span></summary><div className="ui-editor-section">
                <label>Min<input aria-label="Slider minimum" type="number" value={typeof selected.data?.min === 'number' ? selected.data.min : 0} onChange={event => updateData('min', Number(event.target.value))} /></label>
                <label>Max<input aria-label="Slider maximum" type="number" value={typeof selected.data?.max === 'number' ? selected.data.max : 1} onChange={event => updateData('max', Number(event.target.value))} /></label>
                <label>Step<input aria-label="Slider step" type="number" min="0" step="0.01" value={typeof selected.data?.step === 'number' ? selected.data.step : .1} onChange={event => updateData('step', Math.max(0, Number(event.target.value)))} /></label>
                <label>Value<input aria-label="Slider value" type="number" value={typeof selected.data?.value === 'number' ? selected.data.value : typeof selected.data?.default === 'number' ? selected.data.default : 0} onChange={event => updateData('default' in (selected.data ?? {}) ? 'default' : 'value', Number(event.target.value))} /></label>
                <label>Storage Key<input aria-label="Slider storage key" value={typeof selected.data?.storageKey === 'string' ? selected.data.storageKey : ''} onChange={event => updateData('storageKey', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'toggle' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><ToggleLeft size={14} /><span>Toggle</span></summary><div className="ui-editor-section">
                <label>Label<input aria-label="Toggle label" value={uiNodeText(selected)} onChange={event => updateText(event.target.value)} /></label>
                <EditorSelect label="Initial Value" ariaLabel="Toggle initial value" value={String(selected.data?.value ?? selected.data?.default ?? false)} onValueChange={next => {
                  const value = next === 'true' ? true : next === 'false' ? false : next;
                  updateData('default' in (selected.data ?? {}) ? 'default' : 'value', value);
                }} options={[["false", 'Off'], ["true", 'On'], ['follow-prefers-reduced-motion', 'Follow System']]} />
                <label>Storage Key<input aria-label="Toggle storage key" value={typeof selected.data?.storageKey === 'string' ? selected.data.storageKey : ''} onChange={event => updateData('storageKey', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'particle-system' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><Circle size={14} /><span>Particle System</span></summary><div className="ui-editor-section">
                <label>Count<input aria-label="Particle count" type="number" min="0" value={typeof selected.data?.count === 'number' ? selected.data.count : 8} onChange={event => updateData('count', Math.max(0, Number(event.target.value)))} /></label>
                {typeof selected.data?.particleSize === 'object' && selected.data.particleSize !== null ? <div className="ui-editor-pair"><span>Particle Size</span>{(['min', 'max'] as const).map(key => <input key={key} aria-label={`Particle size ${key}`} title={key} type="number" min="0" value={typeof (selected.data?.particleSize as Record<string, unknown>)[key] === 'number' ? Number((selected.data?.particleSize as Record<string, unknown>)[key]) : 0} onChange={event => updateSelected(node => {
                  const range = typeof node.data?.particleSize === 'object' && node.data.particleSize !== null ? node.data.particleSize as Record<string, unknown> : {};
                  node.data = { ...node.data, particleSize: { ...range, [key]: Math.max(0, Number(event.target.value)) } };
                })} />)}</div> : <label>Particle Size<input aria-label="Particle size" type="number" min="0" value={typeof selected.data?.particleSize === 'number' ? selected.data.particleSize : 8} onChange={event => updateData('particleSize', Math.max(0, Number(event.target.value)))} /></label>}
                <EditorSelect label="Blend" ariaLabel="Particle blend mode" value={typeof selected.data?.blend === 'string' ? selected.data.blend : 'alpha'} onValueChange={value => updateData('blend', value)} options={[['alpha', 'Alpha'], ['additive', 'Additive'], ['multiply', 'Multiply']]} />
              </div></details> : null}
              {selectedKind === 'toast' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>Toast Behavior</span></summary><div className="ui-editor-section">
                <label>Trigger<input aria-label="Toast trigger" value={typeof selected.data?.trigger === 'string' ? selected.data.trigger : ''} onChange={event => updateData('trigger', event.target.value)} /></label>
                <label>Lifetime<input aria-label="Toast lifetime" type="number" min="0" step="0.1" value={typeof selected.data?.lifetimeSecs === 'number' ? selected.data.lifetimeSecs : 1.5} onChange={event => updateData('lifetimeSecs', Math.max(0, Number(event.target.value)))} /></label>
              </div></details> : null}
              {selectedKind === 'world-prompt' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>World Anchor Behavior</span></summary><div className="ui-editor-section">
                <label>World Anchor<input aria-label="World prompt anchor" value={typeof selected.data?.worldAnchor === 'string' ? selected.data.worldAnchor : ''} onChange={event => updateData('worldAnchor', event.target.value)} /></label>
                <label>Visible When<input aria-label="World prompt condition" value={typeof selected.data?.visibleWhen === 'string' ? selected.data.visibleWhen : ''} onChange={event => updateData('visibleWhen', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'capsule-segment' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>State Segment Behavior</span></summary><div className="ui-editor-section">
                <label>Active When<input aria-label="Segment active condition" value={typeof selected.data?.activeWhen === 'string' ? selected.data.activeWhen : ''} onChange={event => updateData('activeWhen', event.target.value)} /></label>
                <label>Inactive Alpha<input aria-label="Segment inactive alpha" type="number" min="0" max="1" step="0.05" value={typeof selected.data?.inactiveAlpha === 'number' ? selected.data.inactiveAlpha : .3} onChange={event => updateData('inactiveAlpha', Math.max(0, Math.min(1, Number(event.target.value))))} /></label>
              </div></details> : null}
              {selectedKind !== 'flow' && selectedKind !== 'flow-screen' ? <details className="ui-editor-inspector-component ui-editor-component-transform" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><Move size={14} /><span>Rect Transform</span></summary><div className="ui-editor-section">
                <EditorSelect label="Space" ariaLabel="UI render space" value={typeof selected.data?.space === 'string' ? selected.data.space : 'screen'} onValueChange={value => updateData('space', value)} options={[['screen', 'Screen Space'], ['world', 'World Space (XR)']]} />
                <div className="ui-editor-anchor-field"><span>Anchors</span><div className="ui-editor-anchor-presets" role="radiogroup" aria-label="Anchor preset">{ANCHOR_PRESETS.map(anchor => <button key={anchor} type="button" role="radio" aria-label={anchor} aria-checked={(selected.layout?.anchor ?? 'top-left') === anchor} className={(selected.layout?.anchor ?? 'top-left') === anchor ? 'active' : ''} onClick={() => updateSelected(node => { node.layout = { ...node.layout, anchor }; })}><i /></button>)}</div></div>
                <div className="ui-editor-pair"><span>Position</span>{[0, 1].map(index => <input key={index} aria-label={`Position ${index === 0 ? 'X' : 'Y'}`} type="number" value={selected.layout?.position?.[index] ?? 0} onChange={event => updateLayout('position', index, Number(event.target.value))} />)}</div>
                {selected.data?.space === 'world' ? <label>Position Z<input aria-label="Position Z" type="number" value={typeof selected.data?.positionZ === 'number' ? selected.data.positionZ : 0} onChange={event => updateData('positionZ', Number(event.target.value))} /></label> : null}
                <div className="ui-editor-pair"><span>Size</span>{[0, 1].map(index => <input key={index} aria-label={`Size ${index === 0 ? 'X' : 'Y'}`} type="number" min="0" value={selected.layout?.size?.[index] ?? (index === 0 ? 160 : 48)} onChange={event => updateLayout('size', index, Math.max(0, Number(event.target.value)))} />)}</div>
                {selected.data?.space === 'world' ? <div className="ui-editor-triplet"><span>Rotation</span>{['X', 'Y', 'Z'].map((axis, index) => {
                  const rotation = Array.isArray(selected.data?.rotation3D) ? selected.data.rotation3D : [0, 0, Math.round((selected.layout?.rotation ?? 0) * 180 / Math.PI * 100) / 100];
                  return <input key={axis} aria-label={`Rotation ${axis}`} title={axis} type="number" step={snap ? 15 : 1} value={Number(rotation[index]) || 0} onChange={event => updateRotation3D(index, Number(event.target.value))} />;
                })}</div> : <label>Rotation<input aria-label="Rotation" type="number" step={snap ? 15 : 1} value={Math.round((selected.layout?.rotation ?? 0) * 180 / Math.PI * 100) / 100} onChange={event => updateRotation(Number(event.target.value))} /></label>}
                <div className="ui-editor-pair ui-editor-scale-pair"><span>Scale</span>{[0, 1].map(index => <input key={index} aria-label={`Scale ${index === 0 ? 'X' : 'Y'}`} type="number" step="0.1" value={selected.layout?.scale?.[index] ?? 1} onChange={event => updateScale(index, Number(event.target.value))} />)}</div>
                {selected.data?.space === 'world' ? <label>Scale Z<input aria-label="Scale Z" type="number" step="0.1" value={typeof selected.data?.scaleZ === 'number' ? selected.data.scaleZ : 1} onChange={event => updateData('scaleZ', Number(event.target.value))} /></label> : null}
              </div></details> : null}
              {visualNode ? <details className="ui-editor-inspector-component ui-editor-component-appearance" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><ImageIcon size={14} /><span>Appearance</span></summary><div className="ui-editor-section">
                <ColorField label="Color" value={typeof selected.style?.color === 'string' ? selected.style.color : typeof selected.data?.color === 'string' ? selected.data.color : '#ffffff'} onChange={value => updateStyle('color', value)} />
                <ColorField label="Background" value={typeof selected.style?.background === 'string' ? selected.style.background : '#000000'} onChange={value => updateStyle('background', value)} />
                <label>Radius<input type="number" min="0" value={typeof selected.style?.cornerRadius === 'number' ? selected.style.cornerRadius : 0} onChange={event => updateStyle('cornerRadius', Math.max(0, Number(event.target.value)))} /></label>
                <label>Opacity<input type="number" min="0" max="1" step="0.05" value={typeof selected.data?.alpha === 'number' ? selected.data.alpha : 1} onChange={event => updateData('alpha', Math.max(0, Math.min(1, Number(event.target.value))))} /></label>
                {textCapable ? <>
                  <EditorSelect label="Font" ariaLabel="Font asset" value={typeof selectedFont?.assetRef === 'string' ? selectedFont.assetRef : ''} onValueChange={selectFontAsset} options={[["", 'Default'], ...fontAssets.map(asset => [asset.id, asset.label] as const)]} />
                  <label>Font size<input type="number" min="1" value={typeof selected.data?.fontSize === 'number' ? selected.data.fontSize : 18} onChange={event => updateData('fontSize', Math.max(1, Number(event.target.value)))} /></label>
                  <EditorSelect label="Align" ariaLabel="Text alignment" value={typeof selected.data?.align === 'string' ? selected.data.align : 'center'} onValueChange={value => updateData('align', value)} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
                </> : null}
              </div></details> : null}
              <details className="ui-editor-inspector-component ui-editor-component-advanced"><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>Advanced</span></summary><div className="ui-editor-section ui-editor-json-section">
                <JsonRecordEditor label="Bindings" value={selected.bindings ?? {}} onChange={value => updateRecord('bindings', value)} />
                <JsonRecordEditor label="Actions" value={selected.actions ?? {}} onChange={value => updateRecord('actions', value)} />
                <JsonRecordEditor label="Style" value={selected.style ?? {}} onChange={value => updateRecord('style', value)} />
                <JsonRecordEditor label="Data" value={selected.data ?? {}} onChange={value => updateRecord('data', value)} />
              </div></details>
            </> : <div className="ui-editor-empty"><strong>No selection</strong><span>Select an object in the hierarchy or canvas to edit its properties.</span></div>}
          </div>
        </aside>
        <button className="ui-editor-panel-toggle ui-editor-toggle-hierarchy" type="button" aria-label={`${collapsedPanels.hierarchy ? 'Expand' : 'Collapse'} hierarchy`} aria-expanded={!collapsedPanels.hierarchy} onClick={() => setCollapsedPanels(value => ({ ...value, hierarchy: !value.hierarchy }))}>{collapsedPanels.hierarchy ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
        <button className="ui-editor-panel-toggle ui-editor-toggle-inspector" type="button" aria-label={`${collapsedPanels.inspector ? 'Expand' : 'Collapse'} inspector`} aria-expanded={!collapsedPanels.inspector} onClick={() => setCollapsedPanels(value => ({ ...value, inspector: !value.inspector }))}>{collapsedPanels.inspector ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
        <footer className="ui-editor-statusbar">
          <div className="ui-editor-document-status" role="status">
            <span className="ui-editor-document-name" title={current?.document.id}>{current?.document.id ?? 'UI document'}</span>
            <span className={`ui-editor-save-status ${isSaved ? 'saved' : 'unsaved'}`} data-testid="ui-save-status">
              {isSaved && !saving ? <CircleCheck size={12} /> : <Circle size={9} />}
              {saving ? 'saving' : isSaved ? 'saved' : 'unsaved'}
            </span>
          </div>
          <div className="ui-editor-viewport-hints" aria-label="UI navigation hints">
            <span title="Press Q to select"><MousePointer2 size={13} /><kbd>Q</kbd><span>Select</span></span>
            <span title="Press W to move"><Move size={13} /><kbd>W</kbd><span>Move</span></span>
            {keyboard.apple ? <>
              <span title="Use two fingers on the trackpad to pan"><MousePointer2 size={13} /><span>Two-finger · Pan</span></span>
              <span title="Pinch on the trackpad to zoom"><ZoomIn size={13} /><span>Pinch · Zoom</span></span>
            </> : <>
              <span title="Drag with the middle mouse button to pan"><MousePointer2 size={13} /><span>Middle · Pan</span></span>
              <span title="Hold Control and scroll to zoom"><ZoomIn size={13} /><kbd>{keyboard.modifier}</kbd><span>Scroll · Zoom</span></span>
            </>}
            <span title="Hold Shift while dragging a scale handle to preserve proportions"><Scaling size={13} /><kbd>{keyboard.shift}</kbd><span>Drag · Proportional</span></span>
          </div>
        </footer>
        <div className="ui-editor-notice" role="alert">{/failed|error|unable|invalid/i.test(message) ? message : ''}</div>
        {contextMenu ? <div ref={contextMenuRef} className="ui-editor-context-menu" role="menu" aria-label="Hierarchy context menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={event => event.stopPropagation()} onBlur={event => {
          const next = event.relatedTarget;
          if (!next || !event.currentTarget.contains(next)) setContextMenu(undefined);
        }}>
          <button type="button" role="menuitem" aria-label="Rename" onClick={() => { const node = current?.document.data.nodes.find(item => item.id === contextMenu.nodeId); if (node) beginRename(node); setContextMenu(undefined); }}><Pencil size={13} /><span>Rename</span><kbd>{keyboard.apple ? 'Return' : 'F2'}</kbd></button>
          <button type="button" role="menuitem" aria-label="Duplicate" onClick={() => { duplicateSelected(); setContextMenu(undefined); }} disabled={contextMenu.nodeId === current?.document.data.rootId}><Copy size={13} /><span>Duplicate</span><kbd>{keyboard.modifier}D</kbd></button>
          <div className="ui-editor-context-divider" />
          <button type="button" role="menuitem" aria-label="Delete" className="danger" onClick={deleteSelected} disabled={contextMenu.nodeId === current?.document.data.rootId}><Trash2 size={13} /><span>Delete</span><kbd>{keyboard.delete}</kbd></button>
        </div> : null}
      </main>
    </div>
  );
}

function SelectionGizmo({ node, nodes, mode, onBegin }: {
  node: BeeGameUiContentNode;
  nodes: BeeGameUiContentNode[];
  mode: GizmoMode;
  onBegin: (kind: TransformDrag['kind'], event: React.PointerEvent<HTMLElement>) => void;
}) {
  return <div className={`ui-editor-selection-gizmo mode-${mode}`} style={selectionGizmoStyle(node, nodes)}>
    {mode === 'move' ? <button className="ui-editor-move-handle" type="button" aria-label="Move selected UI element" onPointerDown={event => onBegin('move', event)}><Move size={16} /></button> : null}
    {mode === 'scale' ? <button className="ui-editor-scale-handle" type="button" aria-label="Scale selected UI element" title="Drag freely; hold Shift to preserve proportions" onPointerDown={event => onBegin('scale', event)}><span /></button> : null}
    {mode === 'rotate' ? <><span className="ui-editor-rotate-line" /><button className="ui-editor-rotate-handle" type="button" aria-label="Rotate selected UI element" onPointerDown={event => onBegin('rotate', event)}><RotateCw size={13} /></button></> : null}
  </div>;
}

function JsonRecordEditor({ label, value, onChange }: { label: string; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(serialized); setInvalid(false); }, [serialized]);
  return <label className="ui-editor-json-field"><span>{label}</span><textarea className={invalid ? 'invalid' : ''} value={text} onChange={event => setText(event.target.value)} onBlur={() => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
      onChange(parsed as Record<string, unknown>);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }} /></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return <label className="ui-editor-color-field"><span>{label}</span><span className="ui-editor-color-control"><input type="color" aria-label={`${label} picker`} value={color} onChange={event => onChange(event.target.value)} /><input aria-label={`${label} value`} value={value} onChange={event => onChange(event.target.value)} /></span></label>;
}

function roleIcon(role: string) {
  const kind = uiNodeKind(role);
  if (kind === 'text' || kind === 'keycap' || kind === 'toast' || kind === 'world-prompt' || kind === 'capsule-segment') return <Type size={13} />;
  if (kind === 'image' || kind === 'nine-slice') return <ImageIcon size={13} />;
  if (kind === 'shape') return <Circle size={13} />;
  if (kind === 'slider') return <SlidersHorizontal size={13} />;
  if (kind === 'toggle') return <ToggleLeft size={13} />;
  return <BoxSelect size={13} />;
}

function componentMenuIcon(kind: UiComponentKind) {
  if (kind === 'text') return <Type size={14} />;
  if (kind === 'image') return <ImageIcon size={14} />;
  if (kind === 'button') return <MousePointer2 size={14} />;
  if (kind === 'slider') return <SlidersHorizontal size={14} />;
  if (kind === 'dropdown') return <ListChecks size={14} />;
  if (kind === 'tab') return <PanelsTopLeft size={14} />;
  if (kind === 'toggle') return <ToggleLeft size={14} />;
  return <PanelTop size={14} />;
}

function isContainerRole(role: string): boolean {
  const kind = uiNodeKind(role);
  return kind === 'canvas' || kind === 'container' || role.replace(/[\s_-]/g, '').toLowerCase() === 'panel';
}

function uiNodeKind(role: string): UiNodeKind {
  const value = role.replace(/[\s_-]/g, '').toLowerCase();
  if (value === 'screenroot' || value === 'hudroot' || value === 'canvas') return 'canvas';
  if (value === 'flowroot') return 'flow';
  if (value === 'flowscreen') return 'flow-screen';
  if (value === 'container' || value === 'group') return 'container';
  if (value === 'text' || value === 'label' || value === 'input') return 'text';
  if (value === 'image' || value === 'sprite' || value === 'icon' || value === 'background') return 'image';
  if (value === 'nineslicepanel' || value === 'nineslice') return 'nine-slice';
  if (value === 'button' || value === 'dropdown' || value === 'tab') return 'button';
  if (value === 'slider') return 'slider';
  if (value === 'toggle') return 'toggle';
  if (value === 'shape' || value === 'panel') return 'shape';
  if (value === 'keycap') return 'keycap';
  if (value === 'toast') return 'toast';
  if (value === 'worldprompt') return 'world-prompt';
  if (value === 'capsulesegment') return 'capsule-segment';
  if (value === 'emitter' || value === 'particlesystem') return 'particle-system';
  return 'other';
}

function supportsTextNode(kind: UiNodeKind): boolean {
  return kind === 'text' || kind === 'button' || kind === 'keycap' || kind === 'toast' || kind === 'world-prompt' || kind === 'capsule-segment';
}

function supportsImageNode(kind: UiNodeKind): boolean {
  return kind === 'image' || kind === 'nine-slice';
}

function isVisualNode(kind: UiNodeKind): boolean {
  return kind !== 'flow' && kind !== 'flow-screen' && kind !== 'container';
}

function isTransformNode(kind: UiNodeKind): boolean {
  return kind !== 'flow' && kind !== 'flow-screen';
}

function isNineSliceRole(role: string): boolean {
  return uiNodeKind(role) === 'nine-slice';
}

function uiNodeTypeLabel(kind: UiNodeKind): string {
  const labels: Record<UiNodeKind, string> = {
    canvas: 'Canvas Object',
    flow: 'UI Flow',
    'flow-screen': 'Screen Route',
    container: 'Layout Object',
    text: 'Text Object',
    image: 'Image Object',
    'nine-slice': 'Image Object',
    button: 'Selectable Object',
    slider: 'Slider Object',
    toggle: 'Toggle Object',
    shape: 'Graphic Object',
    keycap: 'Composite Object',
    toast: 'Toast Object',
    'world-prompt': 'World Prompt Object',
    'capsule-segment': 'State Segment Object',
    'particle-system': 'Particle Object',
    other: 'UI Object',
  };
  return labels[kind];
}

function uiNodeText(node: BeeGameUiContentNode): string {
  if (node.text !== undefined) return node.text;
  const label = typeof node.data?.label === 'object' && node.data.label !== null ? node.data.label as { content?: unknown } : undefined;
  return typeof label?.content === 'string' ? label.content : '';
}

function uniqueNodeId(kind: UiComponentKind, used: Set<string>): string {
  let index = 1;
  let candidate = `${kind}_${index}`;
  while (used.has(candidate)) candidate = `${kind}_${++index}`;
  return candidate;
}

function createUiComponent(kind: UiComponentKind, id: string, parentId: string): BeeGameUiContentNode {
  const base = {
    id,
    parentId,
    name: UI_COMPONENTS.find(item => item.kind === kind)?.label ?? kind,
    role: kind,
    layout: { position: [640, 360] as [number, number], size: [160, 40] as [number, number], anchor: 'center' },
    data: {} as Record<string, unknown>,
    style: {} as Record<string, unknown>,
  };
  if (kind === 'text') return { ...base, text: 'New Text', layout: { ...base.layout, size: [180, 34] }, data: { fontSize: 20, align: 'center' }, style: { color: '#ffffff' } };
  if (kind === 'image') return { ...base, layout: { ...base.layout, size: [160, 90] }, data: { image: { type: 'simple', preserveAspect: true } } };
  if (kind === 'button') return { ...base, text: 'Button', layout: { ...base.layout, size: [120, 38] }, style: { background: '#3b82f6', color: '#ffffff', cornerRadius: 6 } };
  if (kind === 'slider') return { ...base, layout: { ...base.layout, size: [180, 18] }, data: { min: 0, max: 1, step: .1, value: .5 }, style: {} };
  if (kind === 'dropdown') return { ...base, text: 'Option ▾', layout: { ...base.layout, size: [180, 36] }, data: { options: ['Option A', 'Option B'], selected: 0 }, style: { background: '#27272a', color: '#ffffff', cornerRadius: 4 } };
  if (kind === 'tab') return { ...base, text: 'Tab', layout: { ...base.layout, size: [120, 34] }, data: { active: true }, style: { background: '#3f3f46', color: '#ffffff', cornerRadius: 4 } };
  if (kind === 'toggle') return { ...base, layout: { ...base.layout, size: [110, 48] }, data: { label: { content: 'Toggle' }, value: true }, style: { boxColor: '#343947', checkColor: '#ffffff', color: '#ffffff' } };
  return { ...base, role: 'shape', name: 'Panel', layout: { ...base.layout, size: [320, 180] }, data: { shape: 'rectangle' }, style: { background: '#18181bcc', cornerRadius: 8 } };
}

function uniqueCopyId(id: string, used: Set<string>): string {
  let suffix = 1;
  let candidate = `${id}_copy`;
  while (used.has(candidate)) candidate = `${id}_copy${++suffix}`;
  used.add(candidate);
  return candidate;
}

function snapValue(value: number, increment: number): number {
  return increment ? Math.round(value / increment) * increment : value;
}

function clampZoom(value: number): number {
  return Math.max(.2, Math.min(3, Math.round(value * 100) / 100));
}

function selectionGizmoStyle(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): React.CSSProperties {
  let [x, y] = node.layout?.position ?? [0, 0];
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodes.find(item => item.id === parentId);
    if (!parent) break;
    const [parentX, parentY] = parent.layout?.position ?? [0, 0];
    x += parentX;
    y += parentY;
    parentId = parent.parentId;
  }
  const [width, height] = node.layout?.size ?? [160, 48];
  const [scaleX, scaleY] = node.layout?.scale ?? [1, 1];
  const anchor = node.layout?.anchor ?? 'top-left';
  const [vertical, horizontal] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
  const dataAnchor = typeof node.data?.anchor === 'object' && node.data.anchor !== null ? node.data.anchor as { x?: unknown; y?: unknown } : undefined;
  const anchorX = typeof dataAnchor?.x === 'number' ? dataAnchor.x : horizontal === 'center' ? .5 : horizontal === 'right' ? 1 : 0;
  const anchorY = typeof dataAnchor?.y === 'number' ? dataAnchor.y : vertical === 'center' ? .5 : vertical === 'bottom' ? 1 : 0;
  return {
    left: x,
    top: y,
    width: Math.abs(width * scaleX),
    height: Math.abs(height * scaleY),
    translate: `${-anchorX * 100}% ${-anchorY * 100}%`,
    transform: `rotate(${node.layout?.rotation ?? 0}rad)`,
  };
}

function componentGizmoStyle(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): React.CSSProperties {
  let [x, y] = node.layout?.position ?? [0, 0];
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodes.find(item => item.id === parentId);
    if (!parent) break;
    const [parentX, parentY] = parent.layout?.position ?? [0, 0];
    x += parentX;
    y += parentY;
    parentId = parent.parentId;
  }
  return { left: x, top: y };
}

function childIds(nodes: BeeGameUiContentNode[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    output.set(node.parentId, [...(output.get(node.parentId) ?? []), node.id]);
  }
  return output;
}

function renderUiNode(
  id: string,
  nodes: BeeGameUiContentNode[],
  children: Map<string, string[]>,
  assetUrls: Record<string, string>,
  fontFamilies: Record<string, string>,
  selectedId: string,
  select: (id: string) => void,
  hiddenIds: Set<string>,
  unpickableIds: Set<string>,
  root = false,
): React.ReactNode {
  const node = nodes.find(item => item.id === id);
  if (!node || node.enabled === false || hiddenIds.has(id)) return null;
  const style = uiNodeStyle(node, root, fontFamilies);
  const member = typeof node.data?.member === 'string' ? node.data.member : undefined;
  const image = node.assetRef
    ? assetUrls[member ? `${node.assetRef}:${member}` : node.assetRef]
    : undefined;
  const text = uiNodeText(node);
  const kind = uiNodeKind(node.role);
  return <div
    key={node.id}
    className={`ui-editor-node${selectedId === node.id ? ' selected' : ''}`}
    style={style}
    onPointerDown={event => { if (event.button === 0 && !unpickableIds.has(node.id)) { event.stopPropagation(); select(node.id); } }}
    data-role={node.role}
  >
    {image ? <UiImagePreview node={node} src={image} /> : null}
    {kind === 'slider' ? <UiSliderPreview node={node} assetUrls={assetUrls} /> : null}
    {kind === 'toggle' ? <UiTogglePreview node={node} /> : null}
    {kind === 'particle-system' ? <UiParticlePreview node={node} assetUrls={assetUrls} /> : null}
    {text && kind !== 'toggle' ? <span>{text}</span> : null}
    {(children.get(node.id) ?? []).map(child => renderUiNode(child, nodes, children, assetUrls, fontFamilies, selectedId, select, hiddenIds, unpickableIds))}
  </div>;
}

function resolveDataImage(value: unknown, assetUrls: Record<string, string>): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const reference = value as { assetRef?: unknown; member?: unknown };
  if (typeof reference.assetRef !== 'string') return undefined;
  return typeof reference.member === 'string'
    ? assetUrls[`${reference.assetRef}:${reference.member}`] ?? assetUrls[reference.assetRef]
    : assetUrls[reference.assetRef];
}

function UiSliderPreview({ node, assetUrls }: { node: BeeGameUiContentNode; assetUrls: Record<string, string> }) {
  const min = typeof node.data?.min === 'number' ? node.data.min : 0;
  const max = typeof node.data?.max === 'number' ? node.data.max : 1;
  const value = typeof node.data?.value === 'number' ? node.data.value : typeof node.data?.default === 'number' ? node.data.default : min;
  const amount = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const track = resolveDataImage(node.data?.track, assetUrls);
  const fill = resolveDataImage(node.data?.fill, assetUrls);
  return <span className="ui-editor-slider-preview" aria-hidden="true">
    <i className="ui-editor-slider-track" style={track ? { backgroundImage: `url(${track})` } : undefined} />
    <i className="ui-editor-slider-fill" style={{ width: `${amount * 100}%`, ...(fill ? { backgroundImage: `url(${fill})` } : {}) }} />
    <i className="ui-editor-slider-handle" style={{ left: `${amount * 100}%` }} />
  </span>;
}

function UiTogglePreview({ node }: { node: BeeGameUiContentNode }) {
  const initial = node.data?.value ?? node.data?.default;
  const checked = initial === true || initial === 'on';
  const followsSystem = initial === 'follow-prefers-reduced-motion';
  const label = uiNodeText(node);
  const boxColor = typeof node.style?.boxColor === 'string' ? node.style.boxColor : '#343947';
  const checkColor = typeof node.style?.checkColor === 'string' ? node.style.checkColor : '#ffffff';
  return <span className={`ui-editor-toggle-preview${checked ? ' checked' : ''}${followsSystem ? ' mixed' : ''}`} aria-hidden="true">
    <i className="ui-editor-toggle-box" style={{ background: boxColor, color: checkColor }}>{checked ? '✓' : followsSystem ? '−' : ''}</i>
    {label ? <b>{label}</b> : null}
  </span>;
}

function UiParticlePreview({ node, assetUrls }: { node: BeeGameUiContentNode; assetUrls: Record<string, string> }) {
  const texture = resolveDataImage(node.data?.texture, assetUrls);
  const tint = typeof node.data?.tint === 'string' ? node.data.tint : '#ffffff';
  const count = Math.max(3, Math.min(12, typeof node.data?.count === 'number' ? node.data.count : 8));
  return <span className="ui-editor-particle-preview" aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} style={{
    left: `${12 + ((index * 37) % 79)}%`,
    top: `${8 + ((index * 53) % 83)}%`,
    backgroundColor: tint,
    backgroundImage: texture ? `url(${texture})` : undefined,
  }} />)}</span>;
}

function uiNodeStyle(node: BeeGameUiContentNode, root: boolean, fontFamilies: Record<string, string>): React.CSSProperties {
  if (root) {
    const background = typeof node.data?.background === 'object' && node.data.background !== null
      ? node.data.background as { color?: unknown }
      : undefined;
    return {
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      perspective: 1000,
      transformStyle: 'preserve-3d',
      background: typeof background?.color === 'string' ? background.color : undefined,
    };
  }
  const zone = uiNodeKind(node.role) === 'particle-system' && typeof node.data?.zone === 'object' && node.data.zone !== null
    ? node.data.zone as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    : undefined;
  const [x, y] = node.layout?.position ?? [typeof zone?.x === 'number' ? zone.x : 0, typeof zone?.y === 'number' ? zone.y : 0];
  const anchor = node.layout?.anchor ?? 'top-left';
  const [vertical, horizontal] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
  const [scaleX, scaleY] = node.layout?.scale ?? [1, 1];
  const style = node.style ?? {};
  const data = node.data ?? {};
  const anchorData = typeof data.anchor === 'object' && data.anchor !== null
    ? data.anchor as { x?: unknown; y?: unknown }
    : undefined;
  const anchorX = typeof anchorData?.x === 'number' ? anchorData.x : horizontal === 'center' ? 0.5 : horizontal === 'right' ? 1 : 0;
  const anchorY = typeof anchorData?.y === 'number' ? anchorData.y : vertical === 'center' ? 0.5 : vertical === 'bottom' ? 1 : 0;
  const dataColor = typeof data.color === 'string' ? data.color : undefined;
  const dataAlpha = typeof data.alpha === 'number' ? data.alpha : undefined;
  const fontSize = typeof data.fontSize === 'number' ? data.fontSize : undefined;
  const label = typeof data.label === 'object' && data.label !== null
    ? data.label as { content?: unknown; fontSize?: unknown; color?: unknown }
    : undefined;
  const resolvedFontSize = fontSize ?? (typeof label?.fontSize === 'number' ? label.fontSize : 18);
  const visibleText = uiNodeText(node);
  const font = typeof data.font === 'object' && data.font !== null ? data.font as { assetRef?: unknown } : undefined;
  const fontFamily = supportsTextNode(uiNodeKind(node.role)) && typeof font?.assetRef === 'string' ? fontFamilies[font.assetRef] : undefined;
  const worldSpace = data.space === 'world';
  const rotation3D = Array.isArray(data.rotation3D) ? data.rotation3D : [0, 0, (node.layout?.rotation ?? 0) * 180 / Math.PI];
  const positionZ = typeof data.positionZ === 'number' ? data.positionZ : 0;
  const scaleZ = typeof data.scaleZ === 'number' ? data.scaleZ : 1;
  const [width, height] = node.layout?.size ?? (zone && typeof zone.width === 'number' && typeof zone.height === 'number'
    ? [zone.width, zone.height]
    : node.role === 'text'
    ? [Math.max(160, visibleText.length * resolvedFontSize * 1.05), resolvedFontSize * 1.35]
    : [160, 48]);
  const output: React.CSSProperties = {
    position: 'absolute',
    width,
    height,
    color: typeof style.color === 'string' ? style.color : dataColor ?? (typeof label?.color === 'string' ? label.color : undefined),
    background: typeof style.background === 'string'
      ? style.background
      : typeof style.fill === 'string'
        ? style.fill
        : node.role === 'shape' ? dataColor : undefined,
    border: typeof style.border === 'string' ? `1px solid ${style.border}` : undefined,
    borderRadius: typeof style.cornerRadius === 'number' ? style.cornerRadius : node.role === 'keycap' ? 6 : undefined,
    fontSize: resolvedFontSize,
    fontFamily,
    opacity: dataAlpha,
    textAlign: data.align === 'left' || data.align === 'right' || data.align === 'center' ? data.align : undefined,
    transformStyle: worldSpace ? 'preserve-3d' : undefined,
    transform: worldSpace
      ? `translateZ(${positionZ}px) rotateX(${Number(rotation3D[0]) || 0}deg) rotateY(${Number(rotation3D[1]) || 0}deg) rotateZ(${Number(rotation3D[2]) || 0}deg) scale3d(${scaleX}, ${scaleY}, ${scaleZ})`
      : `rotate(${node.layout?.rotation ?? 0}rad) scale(${scaleX}, ${scaleY})`,
  };
  if (node.role === 'shape') {
    if (data.shape === 'cone' || data.shape === 'triangle') output.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
    else if (data.shape === 'circle' || data.shape === 'ellipse') output.borderRadius = '50%';
  }
  if (node.role === 'keycap') output.boxShadow = 'inset 0 -2px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.18)';
  output.left = x;
  output.top = y;
  output.translate = `${-anchorX * 100}% ${-anchorY * 100}%`;
  return output;
}

function resolveNodeImage(node: BeeGameUiContentNode, assetUrls: Record<string, string>): string | undefined {
  if (!node.assetRef) return undefined;
  const member = typeof node.data?.member === 'string' ? node.data.member : undefined;
  return assetUrls[member ? `${node.assetRef}:${member}` : node.assetRef] ?? assetUrls[node.assetRef];
}

function EditorSelect({ label, ariaLabel, value, onValueChange, options }: { label: string; ariaLabel: string; value: string; onValueChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <div className="ui-editor-select-field"><span>{label}</span><ProjectSelect ariaLabel={ariaLabel} value={value} onValueChange={onValueChange} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} className="min-w-0" triggerClassName="ui-editor-select-trigger" contentClassName="ui-editor-select-content" /></div>;
}

function UiImagePreview({ node, src }: { node: BeeGameUiContentNode; src: string }) {
  const image = typeof node.data?.image === 'object' && node.data.image !== null ? node.data.image as Record<string, unknown> : {};
  const type = typeof image.type === 'string' ? image.type : isNineSliceRole(node.role) ? 'sliced' : 'simple';
  const preserveAspect = image.preserveAspect === true || (!('preserveAspect' in image) && node.data?.fit === 'contain');
  if (type === 'tiled') return <span className="ui-editor-image tiled" aria-hidden="true" style={{ backgroundImage: `url(${src})` }} />;
  if (type === 'sliced') {
    const border = typeof node.data?.border === 'object' && node.data.border !== null ? node.data.border as Record<string, unknown> : {};
    const left = typeof border.left === 'number' ? border.left : 16;
    const right = typeof border.right === 'number' ? border.right : 16;
    const top = typeof border.top === 'number' ? border.top : 16;
    const bottom = typeof border.bottom === 'number' ? border.bottom : 16;
    return <span className="ui-editor-image sliced" aria-hidden="true" style={{
      borderImageSource: `url(${src})`,
      borderImageSlice: `${top} ${right} ${bottom} ${left} fill`,
      borderWidth: `${top}px ${right}px ${bottom}px ${left}px`,
    }} />;
  }
  const amount = typeof image.fillAmount === 'number' ? Math.max(0, Math.min(1, image.fillAmount)) : 1;
  const method = typeof image.fillMethod === 'string' ? image.fillMethod : 'horizontal';
  const origin = image.fillOrigin === 'end' ? 'end' : 'start';
  const fillStyle: React.CSSProperties = {};
  if (type === 'filled') {
    if (method === 'horizontal') fillStyle.clipPath = origin === 'start' ? `inset(0 ${100 - amount * 100}% 0 0)` : `inset(0 0 0 ${100 - amount * 100}%)`;
    else if (method === 'vertical') fillStyle.clipPath = origin === 'start' ? `inset(0 0 ${100 - amount * 100}% 0)` : `inset(${100 - amount * 100}% 0 0 0)`;
    else {
      const sweep = method === 'radial90' ? 90 : method === 'radial180' ? 180 : 360;
      const start = origin === 'start' ? 0 : 360 - sweep;
      const mask = `conic-gradient(from ${start}deg, #000 ${amount * sweep}deg, transparent 0)`;
      fillStyle.maskImage = mask;
      fillStyle.WebkitMaskImage = mask;
    }
  }
  return <img className="ui-editor-image" src={src} alt="" draggable={false} style={{ ...fillStyle, objectFit: preserveAspect ? 'contain' : 'fill' }} />;
}

function fileStem(path: string): string {
  return path.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? path;
}

function isUiAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function waitForUiTransition(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 180);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('UI loading was stopped.', 'AbortError'));
    }, { once: true });
  });
}
