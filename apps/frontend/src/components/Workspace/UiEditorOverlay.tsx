import { useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4 } from 'three';
import { uiAnchor, uiLocalMatrix } from '@beegame/scene-editor';
import { uiAtlasImages, uiImageKey, resolveUiImage } from './uiAtlas';
import { mapEditorAssets } from './editorAssetLoading';
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
import { Switch } from '../ui/switch';
import { Button } from '../beui/project-button';
import { Input } from '../beui/registry/components/motion/input';
import { RangeSlider } from '../beui/registry/components/motion/range-slider';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '../beui/registry/components/motion/context-menu';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
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
  | 'text' | 'image' | 'nine-slice' | 'button' | 'slider' | 'toggle' | 'dropdown' | 'tab'
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
  'middle-left', 'middle-center', 'middle-right',
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
  parentMatrix: Matrix4;
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
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const loadMoreAssetsRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const [closeRequested, setCloseRequested] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [unpickableIds, setUnpickableIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const transformRef = useRef<TransformDrag | undefined>(undefined);
  const undoRef = useRef<UiSnapshot[]>([]);
  const redoRef = useRef<UiSnapshot[]>([]);
  const currentRef = useRef<UiSnapshot | undefined>(undefined);
  const savedContentRef = useRef<Record<string, string>>({});
  const historyRef = useRef(new Map<string, { undo: UiSnapshot[]; redo: UiSnapshot[] }>());
  const revisionsRef = useRef<Record<string, string>>({});
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const inspectorEditRef = useRef<UiSnapshot | undefined>(undefined);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadControllerRef.current = controller;
    let active = true;
    const objectUrls: string[] = [];
    const loadedFontFaces: FontFace[] = [];
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
    setPickerLoading(false);
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
      revisionsRef.current = Object.fromEntries(uiDocuments.map(document => [document.path, document.revision]));
      historyRef.current.clear();
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
        const requiredAssets = new Set(uiDocuments.flatMap(item => item.document.assetRefs));
        const loadResources = async (resources: typeof manifest.resources, initial: boolean) => {
        const loadTargets = resources.flatMap(resource => resource.file_paths
          .filter(path => UI_IMAGE.test(path) || UI_FONT.test(path))
          .map(path => ({ resourceId: resource.id, path })));
        const totalFiles = loadTargets.length;
        let loadedFiles = 0;
        const failedFiles: string[] = [];
        const optionalFailures: string[] = [];
        const failedAsset = (id: string, path: string, error: unknown) => {
          const detail = `${id}/${path.split('/').at(-1) ?? path}: ${error instanceof Error ? error.message : String(error)}`;
          (requiredAssets.has(id) ? failedFiles : optionalFailures).push(detail);
        };
        const markFileLoaded = (resourceId: string, path: string) => {
          loadedFiles += 1;
          if (!initial) return;
          updateLoadState({
            progress: totalFiles ? 40 + Math.round((loadedFiles / totalFiles) * 54) : 94,
            label: uiLabel,
            detail: totalFiles
              ? `${resourceId} · ${path.split('/').at(-1) ?? path} · ${loadedFiles} of ${totalFiles}`
              : 'No external UI assets required',
          });
        };
        if (initial) updateLoadState({
          progress: 40,
          label: uiLabel,
          detail: totalFiles
            ? `${loadTargets[0].resourceId} · ${loadTargets[0].path.split('/').at(-1) ?? loadTargets[0].path} · 0 of ${totalFiles}`
            : 'No external UI assets required',
        });
        const imageTargets = resources
          .filter(resource => resource.status === 'verified')
          .flatMap(resource => resource.file_paths
            .filter(path => UI_IMAGE.test(path))
            .map(path => ({ resource, path })));
        const loaded = await mapEditorAssets(imageTargets, async ({ resource, path }) => {
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
                const sidecar = resource.file_paths.find(file => file === path.replace(/\.[^.]+$/, '.json'));
                if (sidecar) {
                  const metadata = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, sidecar, signal);
                  const frames = await uiAtlasImages(url, JSON.parse(await metadata.text()), signal);
                  for (const [frame, cropped] of Object.entries(frames)) {
                    entries.push([`${resource.id}:${member}#${frame}`, cropped]);
                    if (path === resource.root_path) entries.push([`${resource.id}#${frame}`, cropped]);
                  }
                }
                return entries;
              } catch (error) {
                if (isUiAbortError(error)) throw error;
                failedAsset(resource.id, path, error);
                return [] as Array<readonly [string, string]>;
              } finally {
                if (!signal.aborted) markFileLoaded(resource.id, path);
              }
            });
        if (!active) return;
        const entries = loaded.flat();
        for (const resource of manifest.resources) {
          if (entries.some(([key]) => key === resource.id)) continue;
          const first = entries.find(([key]) => key.startsWith(`${resource.id}:`));
          if (first) entries.push([resource.id, first[1]]);
        }
        setAssetUrls(previous => ({ ...previous, ...Object.fromEntries(entries) }));
        setAssetOptions(options => options.map(option => ({ ...option, members: option.members.flatMap(member => {
          const prefix = `${option.id}:${member}#`;
          const frames = entries.filter(([key]) => key.startsWith(prefix)).map(([key]) => `${member}#${key.slice(prefix.length)}`);
          return frames.length ? frames : [member];
        }) })));
        const fonts = await mapEditorAssets(resources.filter(resource => resource.file_paths.some(item => UI_FONT.test(item))), async resource => {
          const path = resource.file_paths.find(item => UI_FONT.test(item));
          if (!path) return undefined;
          return beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal).then(async blob => {
            if (!active) return undefined;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            const family = `BGS-${resource.id.replace(/[^a-z0-9_-]/gi, '-')}`;
            if (typeof FontFace !== 'undefined') {
              const face = new FontFace(family, `url(${url})`);
              await face.load();
              if (active) {
                document.fonts.add(face);
                loadedFontFaces.push(face);
              }
            }
            return [resource.id, family] as const;
          }).catch(error => {
            if (isUiAbortError(error)) throw error;
            failedAsset(resource.id, path, error);
            return undefined;
          }).finally(() => {
            if (!signal.aborted) markFileLoaded(resource.id, path);
          });
        });
        if (active) setFontFamilies(previous => ({ ...previous, ...Object.fromEntries(fonts.filter((item): item is readonly [string, string] => Boolean(item))) }));
        if (failedFiles.length) throw new Error(`Failed to load ${failedFiles.length} assets: ${failedFiles.join(', ')}`);
        if (active) setMessage(optionalFailures.length ? `Optional assets unavailable: ${optionalFailures.join(' · ')}` : '');
        };
        await loadResources(resources.filter(resource => requiredAssets.has(resource.id)), true);
        if (!active || signal.aborted) return;
        let pickerRequest: Promise<void> | undefined;
        loadMoreAssetsRef.current = () => {
          if (!pickerRequest) {
            setPickerLoading(true);
            pickerRequest = loadResources(resources.filter(resource => !requiredAssets.has(resource.id)), false)
              .catch(error => {
                pickerRequest = undefined;
                if (active && !isUiAbortError(error)) setMessage(`Could not load picker assets: ${error instanceof Error ? error.message : String(error)}`);
              }).finally(() => { if (active) setPickerLoading(false); });
          }
          return pickerRequest;
        };
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
      loadMoreAssetsRef.current = undefined;
      active = false;
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
      loadedFontFaces.forEach(face => document.fonts.delete(face));
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
  const selectedSlice = (selected?.data?.nineSlice as { border?: number[] } | undefined)?.border;
  const selectedBorder = typeof selected?.data?.border === 'object' && selected.data.border !== null
    ? selected.data.border as Record<string, unknown>
    : selectedSlice ? { left: selectedSlice[0], right: selectedSlice[1], top: selectedSlice[2], bottom: selectedSlice[3] } : {};
  const frameIssues = current?.document.data.nodes.flatMap(node => {
    if (!node.assetRef) return [];
    const states = node.data?.stateFrames;
    const frames = [node.data?.frame ?? node.data?.initialFacing, ...(states && typeof states === 'object' ? Object.values(states) : [])];
    return [...new Set(frames.filter((frame): frame is string => typeof frame === 'string'))]
      .filter(frame => !assetUrls[uiImageKey(node.assetRef!, { ...node.data, frame })])
      .map(frame => `${node.id}: unresolved frame "${frame}" in ${node.assetRef}; check the registered atlas metadata`);
  }) ?? [];
  const selectedKind = selected ? uiNodeKind(selected.role) : 'other';
  const textCapable = selected ? supportsTextNode(selectedKind) : false;
  const imageCapable = selected ? supportsImageNode(selectedKind) : false;
  const visualNode = selected ? isVisualNode(selectedKind) : false;

  useEffect(() => {
    if (current && !current.document.data.nodes.some(node => node.id === selectedId)) {
      setSelectedId(current.document.data.rootId);
    }
  }, [current, selectedId]);

  const chooseDocument = (path: string) => {
    finishInspectorEdit();
    if (current) historyRef.current.set(current.path, { undo: undoRef.current, redo: redoRef.current });
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
    const history = historyRef.current.get(path);
    undoRef.current = history?.undo ?? [];
    redoRef.current = history?.redo ?? [];
    setMessage('');
  };

  const applyCurrent = (next: UiSnapshot) => {
    next.revision = revisionsRef.current[next.path] ?? next.revision;
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
    if (JSON.stringify(next.document) === JSON.stringify(value.document)) return;
    if (!inspectorEditRef.current) pushUndo(value);
    applyCurrent(next);
  };

  const undo = () => {
    finishInspectorEdit();
    const value = currentRef.current;
    const previous = undoRef.current.pop();
    if (!value || !previous) return;
    redoRef.current.push(structuredClone(value));
    applyCurrent(previous);
  };

  const redo = () => {
    finishInspectorEdit();
    const value = currentRef.current;
    const next = redoRef.current.pop();
    if (!value || !next) return;
    undoRef.current.push(structuredClone(value));
    applyCurrent(next);
  };

  function finishInspectorEdit() {
    const before = inspectorEditRef.current;
    inspectorEditRef.current = undefined;
    if (before && currentRef.current?.path === before.path && JSON.stringify(before.document) !== JSON.stringify(currentRef.current.document)) {
      pushUndo(before);
    }
  }

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
    setContextMenuOpen(false);
    setMessage(`Deleted ${selected.name ?? selected.id}`);
  };

  const selectImageAsset = (resourceId: string, member?: string) => {
    if (!current || !selected) return;
    const option = assetOptions.find(item => item.id === resourceId);
    commitCurrent(next => {
      const node = next.document.data.nodes.find(item => item.id === selected.id);
      if (!node) return;
      if (!resourceId) return;
      node.assetRef = resourceId;
      node.data = { ...node.data };
      const [file, frame] = (member ?? option?.members[0] ?? '').split('#');
      if (file) node.data.member = file;
      else delete node.data.member;
      if (frame) node.data.frame = frame;
      else delete node.data.frame;
      delete node.data.frameParts;
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
    if (resourceId && !fontFamilies[resourceId]) void loadMoreAssetsRef.current?.();
    commitCurrent(next => {
      const node = next.document.data.nodes.find(item => item.id === selected.id);
      if (!node) return;
      const font = typeof node.data?.font === 'object' && node.data.font !== null ? node.data.font as Record<string, unknown> : {};
      const nextFont = { ...font };
      if (resourceId) nextFont.assetRef = resourceId;
      else delete nextFont.assetRef;
      node.data = { ...node.data, font: nextFont };
      if (resourceId && !next.document.assetRefs.includes(resourceId)) next.document.assetRefs.push(resourceId);
    });
  };

  const addComponent = (kind: UiComponentKind) => {
    if (!current || current.document.kind === 'ui-flow') return;
    const parent = selected && isContainerRole(selected.role) ? selected : current.document.data.nodes.find(node => node.id === current.document.data.rootId);
    const used = new Set(current.document.data.nodes.map(node => node.id));
    const node = createUiComponent(kind, uniqueNodeId(kind, used), parent?.id ?? current.document.data.rootId);
    if (kind === 'image') {
      const asset = imageAssets[0];
      if (!asset) return;
      if (!assetUrls[`${asset.id}:${asset.members[0]}`]) void loadMoreAssetsRef.current?.();
      node.assetRef = asset.id;
      node.data = { ...node.data, member: asset.members[0] };
    }
    commitCurrent(next => {
      next.document.data.nodes.push(node);
      if (node.assetRef && !next.document.assetRefs.includes(node.assetRef)) next.document.assetRefs.push(node.assetRef);
    });
    setExpandedIds(value => new Set(value).add(node.parentId ?? current.document.data.rootId));
    setSelectedId(node.id);
    setMenuOpen(false);
    setAddMenuOpen(false);
    setMessage(`Added ${node.name}`);
  };

  const resetView = () => {
    const viewport = stageRef.current?.parentElement;
    const [width, height] = canvasSize(current?.document);
    const availableWidth = viewport ? viewport.clientWidth - (collapsedPanels.hierarchy ? 32 : 300) - (collapsedPanels.inspector ? 32 : 300) : width;
    setZoom(Math.min(1, Math.max(.1, Math.min(availableWidth / width, ((viewport?.clientHeight ?? height) - 160) / height))));
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (loadState.status === 'ready' && stageRef.current?.parentElement?.clientWidth) resetView();
    // Fit only on document entry, not on every inspector edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState.status, current?.path]);

  const closeEditor = () => {
    finishInspectorEdit();
    const drafts = documents.map(item => currentRef.current?.path === item.path ? currentRef.current : item);
    if (savingRef.current || drafts.some(item => savedContentRef.current[item.path] !== JSON.stringify(item.document))) {
      setCloseRequested(true);
      return;
    }
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
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (!stageRect) return;
    const parentMatrix = parentTransform(selected, snapshot.document.data.nodes);
    const localPivot = nodePosition(selected, snapshot.document.data.nodes);
    const m = parentMatrix.elements;
    const centerX = stageRect.left + (m[0]*localPivot[0]+m[4]*localPivot[1]+m[12])*zoom;
    const centerY = stageRect.top + (m[1]*localPivot[0]+m[5]*localPivot[1]+m[13])*zoom;
    const inverse = parentMatrix.clone().invert().elements;
    const px = (event.clientX-centerX)/zoom, py = (event.clientY-centerY)/zoom;
    transformRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      position: [...(selected.layout?.position ?? [0, 0])],
      scale: [...(selected.layout?.scale ?? [1, 1])],
      rotation: selected.layout?.rotation ?? 0,
      centerX,
      centerY,
      pointerAngle: Math.atan2(inverse[1]*px+inverse[5]*py, inverse[0]*px+inverse[4]*py),
      before: structuredClone(snapshot),
      changed: false,
      parentMatrix,
    };
  };

  useEffect(() => {
    const pointerMove = (event: PointerEvent) => {
      const drag = transformRef.current;
      if (!drag) return;
      const inverse = drag.parentMatrix.clone().invert().elements;
      const screenX = (event.clientX - drag.startX) / zoom;
      const screenY = (event.clientY - drag.startY) / zoom;
      const dx = inverse[0] * screenX + inverse[4] * screenY;
      const dy = inverse[1] * screenX + inverse[5] * screenY;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
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
          const px = (event.clientX-drag.centerX)/zoom, py = (event.clientY-drag.centerY)/zoom;
          const angle = drag.rotation + Math.atan2(inverse[1]*px+inverse[5]*py, inverse[0]*px+inverse[4]*py) - drag.pointerAngle;
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
    window.addEventListener('pointercancel', pointerUp);
    window.addEventListener('blur', pointerUp);
    return () => {
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('blur', pointerUp);
    };
  }, [selectedId, snap, zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if (event.key === 'Escape') {
        if (closeRequested) return;
        if (document.querySelector('.ui-editor-overlay [aria-expanded="true"][aria-haspopup="listbox"]')) return;
        if (contextMenuOpen) setContextMenuOpen(false);
        else if (imagePickerOpen) setImagePickerOpen(false);
        else if (screenMenuOpen) setScreenMenuOpen(false);
        else if (addMenuOpen) setAddMenuOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else if (renamingId) setRenamingId('');
        else closeEditor();
        return;
      }
      if (menuOpen || imagePickerOpen || contextMenuOpen || closeRequested) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (editing) return;
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
    finishInspectorEdit();
    const submitted = currentRef.current;
    if (!submitted || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage('Saving…');
    try {
      const saved = await beeGameAdapter.saveProjectGameContentDocument(projectId, {
        path: submitted.path,
        expectedRevision: revisionsRef.current[submitted.path] ?? submitted.revision,
        document: submitted.document,
      });
      if (!mountedRef.current) return;
      const next = { path: saved.path, revision: saved.revision, document: saved.document };
      revisionsRef.current[next.path] = next.revision;
      const mergeSaved = (draft: UiSnapshot) => JSON.stringify(draft.document) === JSON.stringify(submitted.document) ? next : { ...draft, revision: next.revision };
      if (currentRef.current?.path === next.path) applyCurrent(mergeSaved(currentRef.current));
      setDocuments(value => value.map(item => item.path === next.path ? mergeSaved(item) : item));
      savedContentRef.current[next.path] = JSON.stringify(next.document);
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
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
      <ContextMenu onOpenChange={value => { setContextMenuOpen(value); if (value) setSelectedId(node.id); }}>
      <ContextMenuTrigger>
      <div tabIndex={0} className={`ui-editor-tree-row${node.id === selectedId ? ' selected' : ''}${hidden ? ' is-hidden' : ''}${node.enabled === false ? ' is-inactive' : ''}`} onClick={() => setSelectedId(node.id)} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); setSelectedId(node.id);
          if (event.key === 'Enter' && keyboard.apple) beginRename(node);
        }
      }} onDoubleClick={() => { setSelectedId(node.id); beginRename(node); }} onContextMenu={() => { setSelectedId(node.id); setMenuOpen(false); setImagePickerOpen(false); }}>
        <button type="button" className={`ui-editor-tree-chevron${open ? ' expanded' : ''}`} aria-label={open ? 'Collapse' : 'Expand'} disabled={!childList.length} onClick={event => { event.stopPropagation(); setExpandedIds(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }}>{childList.length ? <ChevronRight size={12} /> : null}</button>
        <span className="ui-editor-node-icon">{roleIcon(node.role)}</span>
        {renamingId === node.id ? <EditorInput autoFocus aria-label="Rename UI element" value={renameValue} onChange={event => setRenameValue(event.target.value)} onBlur={finishRename} onKeyDown={event => { if (event.key === 'Enter') finishRename(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenamingId(''); } }} onClick={event => event.stopPropagation()} /> : <span className="ui-editor-node-name">{node.name ?? node.id}</span>}
        <small>{node.role}</small>
        <span className="ui-editor-row-actions">
          <button type="button" aria-label={hidden ? `Show ${node.name ?? node.id}` : `Hide ${node.name ?? node.id}`} title={hidden ? 'Show in canvas' : 'Hide in canvas'} onClick={event => { event.stopPropagation(); toggleEditorSet(setHiddenIds, node.id); }}>{hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
          <button type="button" aria-label={pickable ? `Make ${node.name ?? node.id} unselectable` : `Make ${node.name ?? node.id} selectable`} title={pickable ? 'Disable canvas selection' : 'Enable canvas selection'} onClick={event => { event.stopPropagation(); toggleEditorSet(setUnpickableIds, node.id); }}>{pickable ? <MousePointer2 size={12} /> : <MousePointerBan size={12} />}</button>
        </span>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent ariaLabel="Hierarchy context menu" className="ui-editor-popup">
        <ContextMenuItem onSelect={() => beginRename(node)}><Pencil size={14} />Rename<ContextMenuShortcut>{keyboard.apple ? 'Return' : 'F2'}</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onSelect={duplicateSelected} disabled={node.id === current.document.data.rootId}><Copy size={14} />Duplicate<ContextMenuShortcut>{keyboard.modifier}D</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={deleteSelected} disabled={node.id === current.document.data.rootId} tone="destructive"><Trash2 size={14} />Delete<ContextMenuShortcut>{keyboard.delete}</ContextMenuShortcut></ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
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
            if (event.ctrlKey || !keyboard.apple || event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY))) {
              // macOS trackpad pinch gestures are exposed by Chromium as
              // ctrl+wheel. Keep their small deltas for smooth native zoom.
              const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
              setZoom(value => clampZoom(value * Math.exp(-delta * (event.ctrlKey ? .01 : .002))));
              return;
            }
            // Two-finger scrolling pans the canvas on both axes. Shift+wheel
            // remains useful for horizontal panning with a conventional mouse.
            const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
            const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
            setPan(value => ({ x: value.x - dx, y: value.y - dy }));
          }}
        >
          <div ref={stageRef} className="ui-editor-stage" aria-label="UI preview" style={{ width: canvasSize(current?.document)[0], height: canvasSize(current?.document)[1], transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {current ? renderUiNode(current.document.data.rootId, current.document.data.nodes, children, assetUrls, fontFamilies, selectedId, setSelectedId, hiddenIds, unpickableIds, true) : null}
            {current && showGizmos ? current.document.data.nodes
              .filter(node => node.id !== current.document.data.rootId && isTransformNode(uiNodeKind(node.role)) && isNodeVisible(node, current.document.data.nodes, hiddenIds) && !unpickableIds.has(node.id))
              .map(node => <button
                key={`gizmo-${node.id}`}
                type="button"
                className={`ui-editor-component-gizmo${node.id === selectedId ? ' selected' : ''}`}
                style={componentGizmoStyle(node, current.document.data.nodes)}
                aria-label={`Select ${node.name ?? node.id}`}
                title={`${node.name ?? node.id} · ${node.role}`}
                onPointerDown={event => { event.stopPropagation(); setSelectedId(node.id); }}
              >{roleIcon(node.role)}</button>) : null}
            {current && selected && isTransformNode(selectedKind) && isNodeVisible(selected, current.document.data.nodes, hiddenIds) && selected.id !== current.document.data.rootId && showGizmos && !hiddenIds.has(selected.id) && !unpickableIds.has(selected.id) ? <SelectionGizmo node={selected} nodes={current.document.data.nodes} mode={gizmoMode} onBegin={beginTransform} /> : null}
          </div>
        </section>
        <div className="ui-editor-floating-toolbar" role="toolbar" aria-label="UI editor tools">
          <MenuPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuPrimitive.Trigger render={<Button variant="ghost" size="icon" aria-label="Editor menu" />}><Menu size={18} /></MenuPrimitive.Trigger>
            <EditorMenuPopup>
              <MenuPrimitive.Item onClick={() => void save()} disabled={!current || saving}><Save size={14} />{saving ? 'Saving…' : 'Save'}<kbd>{keyboard.modifier}S</kbd></MenuPrimitive.Item>
              <MenuPrimitive.Item aria-label="Undo" onClick={undo} disabled={!undoRef.current.length}><Undo2 size={14} />Undo<kbd>{keyboard.modifier}Z</kbd></MenuPrimitive.Item>
              <MenuPrimitive.Item aria-label="Redo" onClick={redo} disabled={!redoRef.current.length}><Redo2 size={14} />Redo<kbd>{keyboard.apple ? `${keyboard.shift}${keyboard.modifier}Z` : `${keyboard.modifier}Y`}</kbd></MenuPrimitive.Item>
              <MenuPrimitive.Item aria-label="Delete" onClick={deleteSelected} disabled={!selected || selected.id === current?.document.data.rootId}><Trash2 size={14} />Delete<kbd>{keyboard.delete}</kbd></MenuPrimitive.Item>
              {documents.length > 1 ? <MenuPrimitive.SubmenuRoot open={screenMenuOpen} onOpenChange={setScreenMenuOpen}>
                <MenuPrimitive.SubmenuTrigger aria-label="Screens"><PanelsTopLeft size={14} />Screens<ChevronRight size={13} /></MenuPrimitive.SubmenuTrigger>
                <EditorMenuPopup submenu label="UI screens">
                  {documents.map(item => <MenuPrimitive.Item key={item.path} onClick={() => chooseDocument(item.path)}>{item.path === current?.path ? <CircleCheck size={14} /> : <Circle size={14} />}{item.document.id}{savedContentRef.current[item.path] !== JSON.stringify((current?.path === item.path ? current : item).document) ? ' •' : ''}</MenuPrimitive.Item>)}
                </EditorMenuPopup>
              </MenuPrimitive.SubmenuRoot> : null}
              {current?.document.kind !== 'ui-flow' ? <MenuPrimitive.SubmenuRoot open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                <MenuPrimitive.SubmenuTrigger aria-label="Add UI"><Plus size={14} />Add UI<ChevronRight size={13} /></MenuPrimitive.SubmenuTrigger>
                <EditorMenuPopup submenu label="Add UI objects">{UI_COMPONENTS.map(item => <MenuPrimitive.Item key={item.kind} disabled={item.kind === 'image' && !imageAssets.length} onClick={() => addComponent(item.kind)}>{componentMenuIcon(item.kind)}{item.label}</MenuPrimitive.Item>)}</EditorMenuPopup>
              </MenuPrimitive.SubmenuRoot> : null}
              <MenuPrimitive.Separator />
              <MenuPrimitive.Item aria-label="Close UI Editor" onClick={closeEditor}><X size={14} />Close editor<kbd>Esc</kbd></MenuPrimitive.Item>
            </EditorMenuPopup>
          </MenuPrimitive.Root>
          <span className="ui-editor-toolbar-divider" />
          <Button variant="ghost" size="sm" type="button" aria-pressed={gizmoMode === 'select'} className={gizmoMode === 'select' ? 'active' : ''} aria-label="Select tool" title="Select (Q)" onClick={() => setGizmoMode('select')}><MousePointer2 size={16} /></Button>
          <Button variant="ghost" size="sm" type="button" aria-pressed={gizmoMode === 'move'} className={gizmoMode === 'move' ? 'active' : ''} aria-label="Move tool" title="Move (W)" onClick={() => setGizmoMode('move')}><Move size={16} /></Button>
          <Button variant="ghost" size="sm" type="button" aria-pressed={gizmoMode === 'rotate'} className={gizmoMode === 'rotate' ? 'active' : ''} aria-label="Rotate tool" title="Rotate (E)" onClick={() => setGizmoMode('rotate')}><RotateCw size={16} /></Button>
          <Button variant="ghost" size="sm" type="button" aria-pressed={gizmoMode === 'scale'} className={gizmoMode === 'scale' ? 'active' : ''} aria-label="Scale tool" title="Scale (R)" onClick={() => setGizmoMode('scale')}><Scaling size={16} /></Button>
          <span className="ui-editor-toolbar-divider" />
          <Button variant="ghost" size="sm" type="button" className={showGizmos ? 'active' : ''} aria-pressed={showGizmos} aria-label="Toggle gizmos" title="Show component gizmos" onClick={() => setShowGizmos(value => !value)}><BoxSelect size={16} /></Button>
          <Button variant="ghost" size="sm" type="button" className={snap ? 'active' : ''} aria-pressed={snap} aria-label="Snap" title="Snap to 8px / 15°" onClick={() => setSnap(value => !value)}><Magnet size={16} /><span>Snap</span></Button>
          <span className="ui-editor-toolbar-divider" />
          <Button variant="ghost" size="sm" type="button" aria-label="Zoom out" title={`Zoom out (${keyboard.modifier}-)`} onClick={() => setZoom(value => clampZoom(value - .1))}><ZoomOut size={15} /></Button>
          <Button variant="ghost" size="sm" type="button" className="ui-editor-zoom-value" aria-label="Reset view" title="Reset view (Ctrl/Cmd+0)" onClick={resetView}>{Math.round(zoom * 100)}%</Button>
          <Button variant="ghost" size="sm" type="button" aria-label="Zoom in" title={`Zoom in (${keyboard.modifier}+)`} onClick={() => setZoom(value => clampZoom(value + .1))}><ZoomIn size={15} /></Button>
          <Button variant="ghost" size="sm" type="button" aria-label="Frame canvas" title="Frame canvas" onClick={resetView}><Maximize2 size={15} /></Button>
        </div>
        <aside className={`ui-editor-panel ui-editor-inspector${collapsedPanels.inspector ? ' is-collapsed' : ''}`} aria-label="UI inspector" inert={collapsedPanels.inspector}>
          <div className="ui-editor-panel-title"><strong>INSPECTOR</strong></div>
          <div className="ui-editor-panel-content ui-editor-inspector-content" onFocusCapture={event => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.closest('[role="slider"]')) {
              if (!inspectorEditRef.current && currentRef.current) inspectorEditRef.current = structuredClone(currentRef.current);
            }
          }} onBlur={event => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.closest('[role="slider"]')) finishInspectorEdit(); }}>
            {selected ? <>
              <div className="ui-editor-object-header">
                <div className="ui-editor-object-heading">
                  <span className="ui-editor-object-avatar">{roleIcon(selected.role)}</span>
                  <Switch size="sm" aria-label="Set active" checked={selected.enabled !== false} onCheckedChange={checked => updateSelected(node => { node.enabled = checked; })} />
                  <EditorInput className="ui-editor-name-input" aria-label="Object name" value={selected.name ?? selected.id} onChange={event => updateSelected(node => { node.name = event.target.value; })} />
                </div>
                <div className="ui-editor-object-subtitle"><span>{uiNodeTypeLabel(selectedKind)}</span><span title={`${selected.role} · ${selected.id}`}>{selected.role} · {selected.id}</span></div>
              </div>
              {selectedKind === 'canvas' ? <details className="ui-editor-inspector-component" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><PanelTop size={14} /><span>Canvas</span></summary><div className="ui-editor-section">
                <div className="ui-editor-pair"><span>Resolution</span>{[0, 1].map(index => <EditorInput key={index} aria-label={index === 0 ? 'Canvas width' : 'Canvas height'} type="number" min="1" value={canvasSize(current?.document)[index]} onChange={event => updateSelected(node => {
                  const size = canvasSize(currentRef.current?.document);
                  size[index] = Math.max(1, Number(event.target.value));
                  node.layout = { ...node.layout, size };
                  if (node.data?.referenceResolution) node.data = { ...node.data, referenceResolution: size };
                  const coordinate = node.data?.coordinateSystem;
                  if (coordinate && typeof coordinate === 'object') node.data = { ...node.data, coordinateSystem: { ...coordinate, width: size[0], height: size[1] } };
                })} />)}</div>
                <label>Background<input aria-label="Canvas background" type="color" value={String((selected.data?.background as { color?: string } | undefined)?.color ?? '#000000')} onChange={event => updateData('background', { ...(selected.data?.background as object ?? {}), color: event.target.value })} /></label>
              </div></details> : null}
              {selectedKind !== 'flow' && selectedKind !== 'flow-screen' && selectedKind !== 'canvas' ? <details className="ui-editor-inspector-component ui-editor-component-transform" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><Move size={14} /><span>Rect Transform</span></summary><div className="ui-editor-section">
                <EditorSelect label="Space" ariaLabel="UI render space" value={selected.data?.space === 'world' ? 'world' : 'screen-2d'} onValueChange={value => updateData('space', value)} options={[[ 'screen-2d', 'Screen Space'], ['world', 'World Space (XR)']]} />
                <div className="ui-editor-anchor-field"><span>Anchors</span><div className="ui-editor-anchor-presets" role="radiogroup" aria-label="Anchor preset">{ANCHOR_PRESETS.map(anchor => <button key={anchor} type="button" role="radio" aria-label={anchor} aria-checked={nodeAnchor(selected).join(',') === nodeAnchor({ ...selected, layout: { ...selected.layout, anchor } }).join(',')} className={nodeAnchor(selected).join(',') === nodeAnchor({ ...selected, layout: { ...selected.layout, anchor } }).join(',') ? 'active' : ''} onClick={() => updateSelected(node => { node.layout = { ...node.layout, anchor }; })}><i /></button>)}</div></div>
                <div className="ui-editor-pair"><span>Position</span>{[0, 1].map(index => <EditorInput key={index} aria-label={`Position ${index === 0 ? 'X' : 'Y'}`} type="number" value={selected.layout?.position?.[index] ?? 0} onChange={event => updateLayout('position', index, Number(event.target.value))} />)}</div>
                {selected.data?.space === 'world' ? <label>Position Z<EditorInput aria-label="Position Z" type="number" value={typeof selected.data?.positionZ === 'number' ? selected.data.positionZ : 0} onChange={event => updateData('positionZ', Number(event.target.value))} /></label> : null}
                <div className="ui-editor-pair"><span>Size</span>{[0, 1].map(index => <EditorInput key={index} aria-label={`Size ${index === 0 ? 'X' : 'Y'}`} type="number" min="0" value={selected.layout?.size?.[index] ?? (index === 0 ? 160 : 48)} onChange={event => updateLayout('size', index, Math.max(0, Number(event.target.value)))} />)}</div>
                {selected.data?.space === 'world' ? <div className="ui-editor-triplet"><span>Rotation</span>{['X', 'Y', 'Z'].map((axis, index) => {
                  const rotation = Array.isArray(selected.data?.rotation3D) ? selected.data.rotation3D : [0, 0, Math.round((selected.layout?.rotation ?? 0) * 180 / Math.PI * 100) / 100];
                  return <EditorInput key={axis} aria-label={`Rotation ${axis}`} title={axis} type="number" step={snap ? 15 : 1} value={Number(rotation[index]) || 0} onChange={event => updateRotation3D(index, Number(event.target.value))} />;
                })}</div> : <label>Rotation<EditorInput aria-label="Rotation" type="number" step={snap ? 15 : 1} value={Math.round((selected.layout?.rotation ?? 0) * 180 / Math.PI * 100) / 100} onChange={event => updateRotation(Number(event.target.value))} /></label>}
                <div className="ui-editor-pair ui-editor-scale-pair"><span>Scale</span>{[0, 1].map(index => <EditorInput key={index} aria-label={`Scale ${index === 0 ? 'X' : 'Y'}`} type="number" step="0.1" value={selected.layout?.scale?.[index] ?? 1} onChange={event => updateScale(index, Number(event.target.value))} />)}</div>
                {selected.data?.space === 'world' ? <label>Scale Z<EditorInput aria-label="Scale Z" type="number" step="0.1" value={typeof selected.data?.scaleZ === 'number' ? selected.data.scaleZ : 1} onChange={event => updateData('scaleZ', Number(event.target.value))} /></label> : null}
              </div></details> : null}
              {textCapable || imageCapable ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" />{imageCapable ? <ImageIcon size={14} /> : <Type size={14} />}<span>{imageCapable ? 'Image' : 'Text'}</span></summary><div className="ui-editor-section">
                {textCapable ? <label>Text<EditorInput value={uiNodeText(selected)} onChange={event => updateText(event.target.value)} /></label> : null}
                {imageCapable ? <>
                  <div className="ui-editor-source-image-field"><span>Source Image</span><Button variant="outline" aria-label="Choose source image" className="ui-editor-source-image" aria-haspopup="dialog" aria-expanded={imagePickerOpen} onClick={() => { setAssetSearch(''); setImagePickerOpen(true); void loadMoreAssetsRef.current?.(); }}>
                    {resolveNodeImage(selected, assetUrls) ? <img src={resolveNodeImage(selected, assetUrls)} alt="" /> : <ImageIcon size={15} />}
                    <span>{typeof selected.data?.frame === 'string' ? selected.data.frame : typeof selected.data?.member === 'string' ? selected.data.member : selected.assetRef ?? 'Choose image'}</span><ChevronRight size={12} />
                  </Button></div>
                  <EditorSelect label="Image Type" ariaLabel="Image type" value={selectedImageType} onValueChange={value => updateImage('type', value as UnityImageType)} options={[['simple', 'Simple'], ['sliced', 'Sliced'], ['tiled', 'Tiled'], ['filled', 'Filled']]} />
                  {selectedImageType === 'simple' || selectedImageType === 'filled' ? <div className="ui-editor-check-field"><span>Preserve Aspect</span><Switch size="sm" aria-label="Preserve aspect" checked={selectedImage.preserveAspect === true || (!('preserveAspect' in selectedImage) && selected.data?.fit === 'contain')} onCheckedChange={checked => updateImage('preserveAspect', checked)} /></div> : null}
                  {selectedImageType === 'sliced' ? <div className="ui-editor-slice-border"><span>Slice Border</span>{(['left', 'right', 'top', 'bottom'] as const).map(side => <label key={side}>{side[0].toUpperCase()}<EditorInput aria-label={`Slice ${side}`} type="number" min="0" value={typeof selectedBorder[side] === 'number' ? selectedBorder[side] : 0} onChange={event => updateBorder(side, Number(event.target.value))} /></label>)}</div> : null}
                  {selectedImageType === 'filled' ? <>
                    <EditorSelect label="Fill Method" ariaLabel="Fill method" value={typeof selectedImage.fillMethod === 'string' ? selectedImage.fillMethod : 'horizontal'} onValueChange={value => updateImage('fillMethod', value)} options={[['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['radial90', 'Radial 90'], ['radial180', 'Radial 180'], ['radial360', 'Radial 360']]} />
                    <EditorSelect label="Fill Origin" ariaLabel="Fill origin" value={typeof selectedImage.fillOrigin === 'string' ? selectedImage.fillOrigin : 'start'} onValueChange={value => updateImage('fillOrigin', value)} options={[['start', 'Start'], ['end', 'End']]} />
                <EditorRange label="Fill amount" value={typeof selectedImage.fillAmount === 'number' ? selectedImage.fillAmount : 1} onBegin={() => { inspectorEditRef.current = structuredClone(currentRef.current); }} onEnd={finishInspectorEdit} onChange={value => updateImage('fillAmount', value)} />
                  </> : null}
                </> : null}
              </div></details> : null}
              {selectedKind === 'dropdown' ? <details className="ui-editor-inspector-component" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><ListChecks size={14} /><span>Dropdown</span></summary><div className="ui-editor-section">
                <label>Options<EditorInput aria-label="Dropdown options" value={Array.isArray(selected.data?.options) ? selected.data.options.join(' | ') : ''} onChange={event => updateData('options', event.target.value.split('|').map(value => value.trim()))} /></label>
                <EditorSelect label="Selected" ariaLabel="Dropdown selection" value={String(selected.data?.selected ?? 0)} onValueChange={value => updateData('selected', Number(value))} options={Array.isArray(selected.data?.options) ? selected.data.options.map((option, index) => [String(index), String(option)] as const) : []} />
              </div></details> : null}
              {selectedKind === 'tab' ? <details className="ui-editor-inspector-component" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><PanelTop size={14} /><span>Tab</span></summary><div className="ui-editor-section">
                <div className="ui-editor-check-field"><span>Selected</span><Switch size="sm" aria-label="Tab selected" checked={selected.data?.selected === true} onCheckedChange={checked => updateData('selected', checked)} /></div>
              </div></details> : null}
              {selectedKind === 'slider' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><SlidersHorizontal size={14} /><span>Slider</span></summary><div className="ui-editor-section">
                <label>Min<EditorInput aria-label="Slider minimum" type="number" value={typeof selected.data?.min === 'number' ? selected.data.min : 0} onChange={event => updateData('min', Number(event.target.value))} /></label>
                <label>Max<EditorInput aria-label="Slider maximum" type="number" value={typeof selected.data?.max === 'number' ? selected.data.max : 1} onChange={event => updateData('max', Number(event.target.value))} /></label>
                <label>Step<EditorInput aria-label="Slider step" type="number" min="0" step="0.01" value={typeof selected.data?.step === 'number' ? selected.data.step : .1} onChange={event => updateData('step', Math.max(0, Number(event.target.value)))} /></label>
                <label>Value<EditorInput aria-label="Slider value" type="number" value={typeof selected.data?.value === 'number' ? selected.data.value : typeof selected.data?.default === 'number' ? selected.data.default : 0} onChange={event => updateData('default' in (selected.data ?? {}) ? 'default' : 'value', Number(event.target.value))} /></label>
                <label>Storage Key<EditorInput aria-label="Slider storage key" value={typeof selected.data?.storageKey === 'string' ? selected.data.storageKey : ''} onChange={event => updateData('storageKey', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'toggle' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><ToggleLeft size={14} /><span>Toggle</span></summary><div className="ui-editor-section">
                <label>Label<EditorInput aria-label="Toggle label" value={uiNodeText(selected)} onChange={event => updateText(event.target.value)} /></label>
                <EditorSelect label="Initial Value" ariaLabel="Toggle initial value" value={String(selected.data?.value ?? selected.data?.default ?? false)} onValueChange={next => {
                  const value = next === 'true' ? true : next === 'false' ? false : next;
                  updateData('default' in (selected.data ?? {}) ? 'default' : 'value', value);
                }} options={[["false", 'Off'], ["true", 'On'], ['follow-prefers-reduced-motion', 'Follow System']]} />
                <label>Storage Key<EditorInput aria-label="Toggle storage key" value={typeof selected.data?.storageKey === 'string' ? selected.data.storageKey : ''} onChange={event => updateData('storageKey', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'particle-system' ? <details className="ui-editor-inspector-component ui-editor-component-content" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><Circle size={14} /><span>Particle System</span></summary><div className="ui-editor-section">
                <label>Count<EditorInput aria-label="Particle count" type="number" min="0" value={typeof selected.data?.count === 'number' ? selected.data.count : 8} onChange={event => updateData('count', Math.max(0, Number(event.target.value)))} /></label>
                {typeof selected.data?.particleSize === 'object' && selected.data.particleSize !== null ? <div className="ui-editor-pair"><span>Particle Size</span>{(['min', 'max'] as const).map(key => <EditorInput key={key} aria-label={`Particle size ${key}`} title={key} type="number" min="0" value={typeof (selected.data?.particleSize as Record<string, unknown>)[key] === 'number' ? Number((selected.data?.particleSize as Record<string, unknown>)[key]) : 0} onChange={event => updateSelected(node => {
                  const range = typeof node.data?.particleSize === 'object' && node.data.particleSize !== null ? node.data.particleSize as Record<string, unknown> : {};
                  node.data = { ...node.data, particleSize: { ...range, [key]: Math.max(0, Number(event.target.value)) } };
                })} />)}</div> : <label>Particle Size<EditorInput aria-label="Particle size" type="number" min="0" value={typeof selected.data?.particleSize === 'number' ? selected.data.particleSize : 8} onChange={event => updateData('particleSize', Math.max(0, Number(event.target.value)))} /></label>}
                <EditorSelect label="Blend" ariaLabel="Particle blend mode" value={typeof selected.data?.blend === 'string' ? selected.data.blend : 'alpha'} onValueChange={value => updateData('blend', value)} options={[['alpha', 'Alpha'], ['additive', 'Additive'], ['multiply', 'Multiply']]} />
              </div></details> : null}
              {selectedKind === 'toast' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>Toast Behavior</span></summary><div className="ui-editor-section">
                <label>Trigger<EditorInput aria-label="Toast trigger" value={typeof selected.data?.trigger === 'string' ? selected.data.trigger : ''} onChange={event => updateData('trigger', event.target.value)} /></label>
                <label>Lifetime<EditorInput aria-label="Toast lifetime" type="number" min="0" step="0.1" value={typeof selected.data?.lifetimeSecs === 'number' ? selected.data.lifetimeSecs : 1.5} onChange={event => updateData('lifetimeSecs', Math.max(0, Number(event.target.value)))} /></label>
              </div></details> : null}
              {selectedKind === 'world-prompt' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>World Anchor Behavior</span></summary><div className="ui-editor-section">
                <label>World Anchor<EditorInput aria-label="World prompt anchor" value={typeof selected.data?.worldAnchor === 'string' ? selected.data.worldAnchor : ''} onChange={event => updateData('worldAnchor', event.target.value)} /></label>
                <label>Visible When<EditorInput aria-label="World prompt condition" value={typeof selected.data?.visibleWhen === 'string' ? selected.data.visibleWhen : ''} onChange={event => updateData('visibleWhen', event.target.value)} /></label>
              </div></details> : null}
              {selectedKind === 'capsule-segment' ? <details className="ui-editor-inspector-component ui-editor-component-behavior" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><BoxSelect size={14} /><span>State Segment Behavior</span></summary><div className="ui-editor-section">
                <label>Active When<EditorInput aria-label="Segment active condition" value={typeof selected.data?.activeWhen === 'string' ? selected.data.activeWhen : ''} onChange={event => updateData('activeWhen', event.target.value)} /></label>
                <label>Inactive Alpha<EditorInput aria-label="Segment inactive alpha" type="number" min="0" max="1" step="0.05" value={typeof selected.data?.inactiveAlpha === 'number' ? selected.data.inactiveAlpha : .3} onChange={event => updateData('inactiveAlpha', Math.max(0, Math.min(1, Number(event.target.value))))} /></label>
              </div></details> : null}
              {visualNode ? <details className="ui-editor-inspector-component ui-editor-component-appearance" open><summary><ChevronRight size={12} className="ui-editor-component-chevron" /><ImageIcon size={14} /><span>Appearance</span></summary><div className="ui-editor-section">
                <ColorField label="Color" value={typeof selected.style?.color === 'string' ? selected.style.color : typeof selected.data?.color === 'string' ? selected.data.color : '#ffffff'} onChange={value => updateStyle('color', value)} />
                <ColorField label="Background" value={typeof selected.style?.background === 'string' ? selected.style.background : '#000000'} onChange={value => updateStyle('background', value)} />
                <label>Radius<EditorInput type="number" min="0" value={typeof selected.style?.cornerRadius === 'number' ? selected.style.cornerRadius : 0} onChange={event => updateStyle('cornerRadius', Math.max(0, Number(event.target.value)))} /></label>
                <EditorRange label="Opacity" value={typeof selected.style?.opacity === 'number' ? selected.style.opacity : typeof selected.data?.alpha === 'number' ? selected.data.alpha : 1} onBegin={() => { inspectorEditRef.current = structuredClone(currentRef.current); }} onEnd={finishInspectorEdit} onChange={value => updateStyle('opacity', value)} />
                {textCapable ? <>
                  <EditorSelect label="Font" ariaLabel="Font asset" value={typeof selectedFont?.assetRef === 'string' ? selectedFont.assetRef : ''} onValueChange={selectFontAsset} options={[["", 'Default'], ...fontAssets.map(asset => [asset.id, asset.label] as const)]} />
                  <label>Font size<EditorInput type="number" min="1" value={uiFontSize(selected)} onChange={event => updateStyle('fontSize', Math.max(1, Number(event.target.value)))} /></label>
                  <EditorSelect label="Align" ariaLabel="Text alignment" value={String(selected.style?.align ?? selected.data?.align ?? 'center')} onValueChange={value => updateStyle('align', value)} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
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
        <Button variant="ghost" size="icon" className="ui-editor-panel-toggle ui-editor-toggle-hierarchy" type="button" aria-label={`${collapsedPanels.hierarchy ? 'Expand' : 'Collapse'} hierarchy`} aria-expanded={!collapsedPanels.hierarchy} onClick={() => setCollapsedPanels(value => ({ ...value, hierarchy: !value.hierarchy }))}>{collapsedPanels.hierarchy ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</Button>
        <Button variant="ghost" size="icon" className="ui-editor-panel-toggle ui-editor-toggle-inspector" type="button" aria-label={`${collapsedPanels.inspector ? 'Expand' : 'Collapse'} inspector`} aria-expanded={!collapsedPanels.inspector} onClick={() => setCollapsedPanels(value => ({ ...value, inspector: !value.inspector }))}>{collapsedPanels.inspector ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>
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
              <span title="Scroll the mouse wheel to zoom"><ZoomIn size={13} /><span>Scroll · Zoom</span></span>
            </>}
            <span title="Hold Shift while dragging a scale handle to preserve proportions"><Scaling size={13} /><kbd>{keyboard.shift}</kbd><span>Drag · Proportional</span></span>
          </div>
        </footer>
        <div className="ui-editor-notice" role="alert">{/^(Saved|Saving…|Duplicated|Added |Deleted |$)/.test(message) ? frameIssues.join('; ') : message}</div>
      </main>
      <Dialog open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
        <DialogContent className="ui-editor-asset-dialog" onKeyDown={event => event.stopPropagation()}>
          <DialogTitle>Select Source Image</DialogTitle><DialogDescription>{imageAssets.reduce((count, asset) => count + asset.members.length, 0)} project images available</DialogDescription>
          <Input aria-label="Search images" placeholder="Search images…" value={assetSearch} onChange={setAssetSearch} />
          {pickerLoading ? <p role="status">Loading project images…</p> : null}
          <div className="ui-editor-asset-grid">
            {imageAssets.flatMap(asset => asset.members.filter(member => `${asset.label} ${member}`.toLowerCase().includes(assetSearch.toLowerCase())).map(member => {
              const url = assetUrls[`${asset.id}:${member}`];
              return <Button variant="ghost" disabled={!url} className="ui-editor-asset-card" aria-pressed={selected?.assetRef === asset.id && selected?.data?.member === member} aria-label={`Use image ${member}`} key={`${asset.id}:${member}`} onClick={() => selectImageAsset(asset.id, member)}>{url ? <img loading="lazy" src={url} alt="" /> : <ImageIcon size={20} />}<span title={member}>{member}</span></Button>;
            }))}
          </div>
          {!imageAssets.some(asset => asset.members.some(member => `${asset.label} ${member}`.toLowerCase().includes(assetSearch.toLowerCase()))) ? <p>No matching images.</p> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={closeRequested} onOpenChange={setCloseRequested}>
        <DialogContent onKeyDown={event => event.stopPropagation()}>
          <DialogTitle>{saving ? 'Saving changes…' : 'Unsaved changes'}</DialogTitle>
          <DialogDescription>{saving ? 'Wait for the save to finish before closing.' : 'One or more screens have unsaved changes. Keep editing to save them, or discard and close.'}</DialogDescription>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCloseRequested(false)}>Keep editing</Button>
            <Button disabled={saving} onClick={() => { loadControllerRef.current?.abort(); onClose(); }}>Discard and close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorMenuPopup({ children, submenu = false, label }: { children: React.ReactNode; submenu?: boolean; label?: string }) {
  return <MenuPrimitive.Portal><MenuPrimitive.Positioner side={submenu ? 'right' : 'bottom'} align="start" sideOffset={6} className="z-[245]"><MenuPrimitive.Popup aria-label={label} aria-labelledby={undefined} className="ui-editor-popup ui-editor-menu" onKeyDown={event => event.stopPropagation()}>{children}</MenuPrimitive.Popup></MenuPrimitive.Positioner></MenuPrimitive.Portal>;
}

function EditorInput({ value, onChange, type, onBlur, onKeyDown, className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue' | 'size'> & { value?: string | number; onChange?: (event: { target: { value: string } }) => void }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  return <Input {...props} type={type} value={draft} className="ui-editor-input" classNames={{ input: className }} onChange={text => {
    setDraft(text);
    if (type === 'number' && (!text.trim() || !Number.isFinite(Number(text)))) return;
    onChange?.({ target: { value: text } });
  }} onBlur={event => {
    if (type === 'number') {
      const numeric = Number(draft);
      const clean = draft.trim() && Number.isFinite(numeric) ? Math.min(props.max === undefined ? Infinity : Number(props.max), Math.max(props.min === undefined ? -Infinity : Number(props.min), numeric)) : Number(value ?? 0);
      setDraft(String(clean));
      onChange?.({ target: { value: String(clean) } });
    }
    onBlur?.(event);
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(value ?? '')); }
    onKeyDown?.(event);
    if (event.key === 'Enter') event.currentTarget.blur();
  }} />;
}

function EditorRange({ label, value, onChange, onBegin, onEnd }: { label: string; value: number; onChange: (value: number) => void; onBegin: () => void; onEnd: () => void }) {
  return <div className="ui-editor-range-field" onPointerDownCapture={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd}>
    <span>{label}</span><RangeSlider aria-label={label} value={value} min={0} max={1} step={.01} showTicks={false} onValueChange={onChange} className="h-7" />
    <EditorInput aria-label={`${label} value`} type="number" min={0} max={1} step={.01} value={value} onChange={event => onChange(Number(event.target.value))} />
  </div>;
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
  return <label className="ui-editor-color-field"><span>{label}</span><span className="ui-editor-color-control"><input type="color" aria-label={`${label} picker`} value={color} onChange={event => onChange(event.target.value)} /><EditorInput aria-label={`${label} value`} value={value} onChange={event => onChange(event.target.value)} /></span></label>;
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
  if (value === 'button' || value === 'dropdown' || value === 'tab') return value;
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
  return kind === 'text' || kind === 'button' || kind === 'tab' || kind === 'keycap' || kind === 'toast' || kind === 'world-prompt' || kind === 'capsule-segment';
}

function supportsImageNode(kind: UiNodeKind): boolean {
  return kind === 'image' || kind === 'nine-slice';
}

function isVisualNode(kind: UiNodeKind): boolean {
  return kind !== 'flow' && kind !== 'flow-screen' && kind !== 'container' && kind !== 'canvas';
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
    dropdown: 'Dropdown Object',
    tab: 'Tab Object',
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
  return typeof node.data?.label === 'string' ? node.data.label : typeof label?.content === 'string' ? label.content : '';
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
    layout: { position: [0, 0] as [number, number], size: [160, 40] as [number, number], anchor: 'middle-center' },
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

function nodeSize(node: BeeGameUiContentNode): [number, number] {
  if (!node.parentId) {
    const coordinate = node.data?.coordinateSystem as { width?: number; height?: number } | undefined;
    const resolution = node.data?.referenceResolution as number[] | undefined;
    return [node.layout?.size?.[0] ?? resolution?.[0] ?? coordinate?.width ?? 1280, node.layout?.size?.[1] ?? resolution?.[1] ?? coordinate?.height ?? 720];
  }
  if (node.layout?.size) return node.layout.size;
  const size = uiFontSize(node);
  const zone = node.data?.zone as { width?: number; height?: number } | undefined;
  return zone?.width !== undefined && zone.height !== undefined ? [zone.width, zone.height] : node.role === 'text' ? [Math.max(160, uiNodeText(node).length * size * 1.05), size * 1.35] : [160, 48];
}

function uiFontSize(node: BeeGameUiContentNode): number {
  const label = node.data?.label as { fontSize?: number } | undefined;
  return typeof node.style?.fontSize === 'number' ? node.style.fontSize : typeof node.data?.fontSize === 'number' ? node.data.fontSize : label?.fontSize ?? 18;
}

function nodeAnchor(node: BeeGameUiContentNode) {
  return uiAnchor(node.layout?.anchor);
}

function nodePosition(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): [number, number] {
  const [x, y] = node.layout?.position ?? [0, 0];
  const parent = nodes.find(item => item.id === node.parentId);
  const [width, height] = parent ? nodeSize(parent) : [0, 0];
  const [ax, ay] = nodeAnchor(node);
  return [x + ax * width, y + ay * height];
}

function localTransform(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): Matrix4 {
  const [x, y] = nodePosition(node, nodes);
  const [width, height] = nodeSize(node);
  const [sx, sy] = node.layout?.scale ?? [1, 1];
  const custom = node.data?.anchor as { x?: number; y?: number } | undefined;
  const [presetX, presetY] = nodeAnchor(node);
  const ax = custom?.x ?? presetX;
  const ay = custom?.y ?? presetY;
  const [a, b, c, d, e, f] = uiLocalMatrix([0, 0], [width, height], [0, 0], [x, y], [ax, ay], node.layout?.rotation ?? 0, [sx, sy]);
  return new Matrix4().set(a, c, 0, e, b, d, 0, f, 0, 0, 1, 0, 0, 0, 0, 1);
}

function parentTransform(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): Matrix4 {
  const chain: BeeGameUiContentNode[] = [];
  const visited = new Set([node.id]);
  let parent = nodes.find(item => item.id === node.parentId);
  while (parent && parent.parentId && !visited.has(parent.id)) {
    visited.add(parent.id);
    chain.unshift(parent);
    parent = nodes.find(item => item.id === parent!.parentId);
  }
  return chain.reduce((matrix, item) => matrix.multiply(localTransform(item, nodes)), new Matrix4());
}

function selectionGizmoStyle(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): React.CSSProperties {
  const matrix = parentTransform(node, nodes).multiply(localTransform(node, nodes));
  const [width, height] = nodeSize(node);
  return { left: 0, top: 0, width, height, transformOrigin: '0 0', transform: `matrix3d(${matrix.elements.join(',')})` };
}

function componentGizmoStyle(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[]): React.CSSProperties {
  const matrix = parentTransform(node, nodes).multiply(localTransform(node, nodes)).elements;
  return { left: matrix[12], top: matrix[13] };
}

function isNodeVisible(node: BeeGameUiContentNode, nodes: BeeGameUiContentNode[], hidden: Set<string>): boolean {
  const visited = new Set<string>();
  let cursor: BeeGameUiContentNode | undefined = node;
  while (cursor && !visited.has(cursor.id)) {
    if (cursor.enabled === false || hidden.has(cursor.id)) return false;
    visited.add(cursor.id);
    cursor = nodes.find(item => item.id === cursor!.parentId);
  }
  return true;
}

function canvasSize(document?: BeeGameUiContentDocument): [number, number] {
  const root = document?.data.nodes.find(node => node.id === document.data.rootId);
  return root ? nodeSize(root) : [1280, 720];
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
  const style = uiNodeStyle(node, root, fontFamilies, nodes);
  const image = resolveNodeImage(node, assetUrls);
  const text = uiNodeText(node);
  const kind = uiNodeKind(node.role);
  return <div
    key={node.id}
    className={`ui-editor-node${selectedId === node.id ? ' selected' : ''}`}
    style={style}
    onPointerDown={event => { if (event.button === 0 && !unpickableIds.has(node.id)) { event.stopPropagation(); select(node.id); } }}
    data-role={node.role}
    data-selected={kind === 'tab' ? node.data?.selected === true : undefined}
  >
    {image ? <UiImagePreview node={node} src={image} /> : null}
    {kind === 'slider' ? <UiSliderPreview node={node} assetUrls={assetUrls} /> : null}
    {kind === 'toggle' ? <UiTogglePreview node={node} /> : null}
    {kind === 'particle-system' ? <UiParticlePreview node={node} assetUrls={assetUrls} /> : null}
    {kind === 'dropdown' ? <span>{Array.isArray(node.data?.options) ? String(node.data.options[Number(node.data?.selected ?? 0)] ?? '') : text}<ChevronRight size={14} className="ui-editor-dropdown-arrow" /></span> : text && kind !== 'toggle' ? <span className="ui-editor-text" style={{ justifyContent: style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : 'center', alignItems: node.style?.verticalAlign === 'top' ? 'flex-start' : node.style?.verticalAlign === 'bottom' ? 'flex-end' : 'center' }}>{text}</span> : null}
    {(children.get(node.id) ?? []).map(child => renderUiNode(child, nodes, children, assetUrls, fontFamilies, selectedId, select, hiddenIds, unpickableIds))}
  </div>;
}

function resolveDataImage(value: unknown, assetUrls: Record<string, string>): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const reference = value as { assetRef?: unknown; member?: unknown; frame?: unknown };
  if (typeof reference.assetRef !== 'string') return undefined;
  return resolveNodeImage({ id: '', role: 'image', assetRef: reference.assetRef, data: reference }, assetUrls);
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
  const count = Math.max(0, Math.min(200, Math.floor(typeof node.data?.count === 'number' ? node.data.count : 8)));
  const size = node.data?.particleSize;
  const range = size && typeof size === 'object' ? size as { min?: number; max?: number } : undefined;
  const minSize = typeof size === 'number' ? size : range?.min ?? 8;
  const maxSize = range?.max ?? minSize;
  const zone = node.data?.zone as { x?: number; y?: number; width?: number; height?: number } | undefined;
  const [width, height] = nodeSize(node);
  return <span className="ui-editor-particle-preview" aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} style={{
    left: (zone?.x ?? 0) + (12 + ((index * 37) % 79)) / 100 * (zone?.width ?? width),
    top: (zone?.y ?? 0) + (8 + ((index * 53) % 83)) / 100 * (zone?.height ?? height),
    width: Math.max(0, minSize + (maxSize - minSize) * ((index * 37 % 100) / 100)),
    mixBlendMode: node.data?.blend === 'additive' || node.data?.blend === 'add' ? 'screen' : node.data?.blend === 'multiply' ? 'multiply' : 'normal',
    color: tint,
    backgroundColor: tint,
    backgroundImage: texture ? `url(${texture})` : undefined,
  }} />)}</span>;
}

function uiNodeStyle(node: BeeGameUiContentNode, root: boolean, fontFamilies: Record<string, string>, nodes: BeeGameUiContentNode[]): React.CSSProperties {
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
  const [x, y] = nodePosition(node, nodes);
  const [presetX, presetY] = nodeAnchor(node);
  const [scaleX, scaleY] = node.layout?.scale ?? [1, 1];
  const style = node.style ?? {};
  const data = node.data ?? {};
  const anchorData = typeof data.anchor === 'object' && data.anchor !== null
    ? data.anchor as { x?: unknown; y?: unknown }
    : undefined;
  const anchorX = typeof anchorData?.x === 'number' ? anchorData.x : presetX;
  const anchorY = typeof anchorData?.y === 'number' ? anchorData.y : presetY;
  const dataColor = typeof data.color === 'string' ? data.color : undefined;
  const dataAlpha = typeof style.opacity === 'number' ? style.opacity : typeof data.alpha === 'number' ? data.alpha : undefined;
  const background = typeof style.background === 'object' && style.background !== null ? style.background as { color?: string; opacity?: number; radius?: number } : undefined;
  const border = typeof style.border === 'object' && style.border !== null ? style.border as { width?: number; color?: string; radius?: number } : undefined;
  const align = style.align ?? data.align;
  const shape = style.shape ?? data.shape;
  const label = typeof data.label === 'object' && data.label !== null
    ? data.label as { content?: unknown; fontSize?: unknown; color?: unknown }
    : undefined;
  const resolvedFontSize = uiFontSize(node);
  const font = typeof data.font === 'object' && data.font !== null ? data.font as { assetRef?: unknown } : undefined;
  const fontFamily = supportsTextNode(uiNodeKind(node.role)) && typeof font?.assetRef === 'string' ? fontFamilies[font.assetRef] : undefined;
  const worldSpace = data.space === 'world';
  const rotation3D = Array.isArray(data.rotation3D) ? data.rotation3D : [0, 0, (node.layout?.rotation ?? 0) * 180 / Math.PI];
  const positionZ = typeof data.positionZ === 'number' ? data.positionZ : 0;
  const scaleZ = typeof data.scaleZ === 'number' ? data.scaleZ : 1;
  const [width, height] = nodeSize(node);
  const output: React.CSSProperties = {
    position: 'absolute',
    width,
    height,
    color: typeof style.textColor === 'string' ? style.textColor : typeof style.color === 'string' ? style.color : dataColor ?? (typeof label?.color === 'string' ? label.color : undefined),
    background: Array.isArray(style.gradient) && style.gradient.every(color => typeof color === 'string') ? `linear-gradient(${style.gradient.join(',')})` : background?.color ? (typeof background.opacity === 'number' ? `color-mix(in srgb, ${background.color} ${background.opacity * 100}%, transparent)` : background.color) : typeof style.background === 'string'
      ? style.background
      : typeof style.fill === 'string'
        ? style.fill
        : node.role === 'shape' ? (typeof style.color === 'string' ? style.color : dataColor) : undefined,
    border: typeof style.border === 'string' ? `1px solid ${style.border}` : border ? `${border.width ?? 0}px solid ${border.color ?? 'transparent'}` : undefined,
    borderRadius: typeof style.cornerRadius === 'number' ? style.cornerRadius : typeof style.radius === 'number' ? style.radius : border?.radius ?? background?.radius ?? (node.role === 'keycap' ? 6 : undefined),
    fontSize: resolvedFontSize,
    fontFamily,
    fontWeight: typeof style.fontWeight === 'number' ? style.fontWeight : 400,
    letterSpacing: typeof style.letterSpacing === 'number' ? style.letterSpacing : 0,
    textTransform: 'none',
    opacity: dataAlpha,
    lineHeight: typeof style.lineHeight === 'number' ? style.lineHeight : 1.35,
    textAlign: align === 'left' || align === 'right' || align === 'center' ? align : 'center',
    transformStyle: worldSpace ? 'preserve-3d' : undefined,
    transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
    transform: worldSpace
      ? `translateZ(${positionZ}px) rotateX(${Number(rotation3D[0]) || 0}deg) rotateY(${Number(rotation3D[1]) || 0}deg) rotateZ(${Number(rotation3D[2]) || 0}deg) scale3d(${scaleX}, ${scaleY}, ${scaleZ})`
      : `rotate(${node.layout?.rotation ?? 0}rad) scale(${scaleX}, ${scaleY})`,
  };
  if (node.role === 'shape') {
    if (shape === 'cone' || shape === 'triangle') output.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
    else if (shape === 'circle' || shape === 'ellipse') output.borderRadius = '50%';
  }
  if (node.role === 'keycap') output.boxShadow = 'inset 0 -2px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.18)';
  output.left = x;
  output.top = y;
  output.translate = `${-anchorX * 100}% ${-anchorY * 100}%`;
  return output;
}

function resolveNodeImage(node: BeeGameUiContentNode, assetUrls: Record<string, string>): string | undefined {
  if (!node.assetRef) return undefined;
  return resolveUiImage(node.assetRef, node.data, assetUrls);
}

function EditorSelect({ label, ariaLabel, value, onValueChange, options }: { label: string; ariaLabel: string; value: string; onValueChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]> }) {
  return <div className="ui-editor-select-field"><span>{label}</span><ProjectSelect portal ariaLabel={ariaLabel} value={value} onValueChange={onValueChange} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} className="min-w-0" triggerClassName="ui-editor-select-trigger" contentClassName="ui-editor-select-content" /></div>;
}

function UiImagePreview({ node, src }: { node: BeeGameUiContentNode; src: string }) {
  const image = typeof node.data?.image === 'object' && node.data.image !== null ? node.data.image as Record<string, unknown> : {};
  const type = typeof image.type === 'string' ? image.type : isNineSliceRole(node.role) ? 'sliced' : 'simple';
  const preserveAspect = image.preserveAspect === true || (!('preserveAspect' in image) && node.data?.fit === 'contain');
  if (type === 'tiled') return <span className="ui-editor-image tiled" aria-hidden="true" style={{ backgroundImage: `url(${src})` }} />;
  if (type === 'sliced') {
    const border = typeof node.data?.border === 'object' && node.data.border !== null ? node.data.border as Record<string, unknown> : {};
    const slice = (node.data?.nineSlice as { border?: number[] } | undefined)?.border;
    const left = typeof border.left === 'number' ? border.left : slice?.[0] ?? 16;
    const right = typeof border.right === 'number' ? border.right : slice?.[1] ?? 16;
    const top = typeof border.top === 'number' ? border.top : slice?.[2] ?? 16;
    const bottom = typeof border.bottom === 'number' ? border.bottom : slice?.[3] ?? 16;
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
