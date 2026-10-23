import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SceneAsset, SceneDocument } from '@beegame/scene-editor';
import { atlasFrameName, parseSpriteSheet, parseTileSet, type SpriteSheet } from '@beegame/scene-editor';
import '@beegame/scene-editor/styles.css';
import {
  beeGameAdapter,
  type BeeGameSceneContentDocument,
} from '../../services/beeGameAdapter';
import {
  editorDocumentToSceneContent,
  sceneContentToEditorDocument,
} from './sceneContentAdapter';
import { EditorLoadingView, type EditorLoadState } from './EditorLoadingView';
import './SceneEditorOverlay.css';
import { editorAtlasPath, mapEditorAssets } from './editorAssetLoading';

const loadSceneEditor = async () => {
  const module = await import('@beegame/scene-editor');
  return { default: module.SceneEditor };
};
const SceneEditor = lazy(loadSceneEditor);

interface SceneEditorOverlayProps {
  projectId: string;
  onClose: () => void;
  initialDocumentPath?: string | null;
}

type SceneSnapshot = {
  path: string;
  revision: string;
  document: BeeGameSceneContentDocument;
  loadDocument: () => SceneDocument;
};

type SceneLoadState = EditorLoadState;

const INITIAL_LOAD_STATE: SceneLoadState = {
  status: 'loading',
  progress: 8,
  label: 'Opening scene',
  detail: 'Connecting to the project…',
};

export function SceneEditorOverlay({ projectId, onClose, initialDocumentPath }: SceneEditorOverlayProps) {
  const [initialDocument, setInitialDocument] = useState<SceneDocument>();
  const [scenes, setScenes] = useState<SceneSnapshot[]>([]);
  const [selectedScenePath, setSelectedScenePath] = useState('');
  const [loadState, setLoadState] = useState<SceneLoadState>(INITIAL_LOAD_STATE);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [uploadingAssets, setUploadingAssets] = useState(false);
  const uploadAssetsRef = useRef<((files: File[]) => Promise<Record<string, SceneAsset>>) | undefined>(undefined);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const canonicalRef = useRef<{
    path: string;
    revision: string;
    document: BeeGameSceneContentDocument;
  } | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loadControllerRef.current = controller;
    let active = true;
    let prerequisiteProgress = 8;
    const updateLoadState = (next: Omit<SceneLoadState, 'status'>) => {
      if (active && !signal.aborted) setLoadState({ status: 'loading', ...next });
    };
    const prerequisiteReady = (weight: number, detail: string) => {
      prerequisiteProgress += weight;
      updateLoadState({ progress: prerequisiteProgress, label: 'Opening scene', detail });
    };
    canonicalRef.current = undefined;
    void Promise.all([
      beeGameAdapter.getProjectGameContent(projectId, signal).then(value => {
        prerequisiteReady(14, 'Scene documents loaded');
        return value;
      }),
      beeGameAdapter.getProjectAssets(projectId, signal).then(value => {
        prerequisiteReady(12, 'Asset manifest loaded');
        return value;
      }),
      loadSceneEditor().then(() => prerequisiteReady(8, 'Editor tools loaded')),
    ])
      .then(async ([snapshot, manifest]) => {
        if (!active || signal.aborted) return;
        if ((snapshot.state !== 'ready' && snapshot.state !== 'draft') || !snapshot.index) {
          setLoadState({ status: 'error', progress: prerequisiteProgress, label: 'Scene unavailable', detail: `Scene content is not available yet (${snapshot.state.replaceAll('_', ' ')}).` });
          return;
        }
        const requestedDocumentPath = initialDocumentPath?.trim() || undefined;
        const requestedDocument = requestedDocumentPath
          ? snapshot.documents?.find(item => item.path === requestedDocumentPath)
          : undefined;
        if (requestedDocumentPath && !requestedDocument) {
          setLoadState({
            status: 'error',
            progress: prerequisiteProgress,
            label: 'Scene unavailable',
            detail: `Requested scene document "${requestedDocumentPath}" was not found in this project.`,
          });
          return;
        }
        const requestedKind = requestedDocument?.document as Partial<BeeGameSceneContentDocument> | undefined;
        if (requestedDocumentPath && requestedDocument && requestedKind?.kind !== 'scene-2d' && requestedKind?.kind !== 'scene-3d') {
          setLoadState({
            status: 'error',
            progress: prerequisiteProgress,
            label: 'Scene unavailable',
            detail: `Requested document "${requestedDocumentPath}" is not a scene document.`,
          });
          return;
        }
        const sceneEntries = snapshot.documents?.flatMap(item => {
          const document = item.document as Partial<BeeGameSceneContentDocument>;
          return document.kind === 'scene-2d' || document.kind === 'scene-3d'
            ? [{ ...item, document: item.document as BeeGameSceneContentDocument }]
            : [];
        }) ?? [];
        if (!sceneEntries.length) {
          setLoadState({ status: 'error', progress: prerequisiteProgress, label: 'No scene found', detail: 'The content package has no Scene documents yet.' });
          return;
        }
        const targetScene = requestedDocumentPath
          ? sceneEntries.find(scene => scene.path === requestedDocumentPath)
          : sceneEntries.find(scene => scene.document.id === snapshot.index?.entryScene)
            ?? sceneEntries[0];
        if (!targetScene) {
          setLoadState({
            status: 'error',
            progress: prerequisiteProgress,
            label: 'Scene unavailable',
            detail: `Requested scene document "${requestedDocumentPath}" could not be opened.`,
          });
          return;
        }
        const sceneLoadLabel = targetScene.document.id;
        // The picker must include verified project resources, not just existing scene references.
        if (!active || signal.aborted) return;
        const progress = updateLoadState;
        async function loadResourceAssets(resources: typeof manifest.resources, initial: boolean) {
          const updateLoadState = initial ? progress : () => {};
          const assets: Record<string, SceneAsset> = {};
          const assetMembers: Record<string, Record<string, string>> = {};
          const assetFailures: Array<{ id: string; detail: string }> = [];
          const requiredAssets = new Set(initial ? sceneEntries.flatMap(scene => scene.document.assetRefs) : resources.map(resource => resource.id));
          const failedAsset = (id: string, path: string, error: unknown) => {
            const detail = `${id}/${path.split('/').at(-1) ?? path}: ${error instanceof Error ? error.message : String(error)}`;
            // TileSet image dependencies are known only after JSON has loaded.
            // Classify failures after all metadata, not by async completion order.
            assetFailures.push({ id, detail });
          };
          const availableResources = resources.filter(resource => resource.status === 'verified');
          for (const resource of availableResources) {
            assets[resource.id] = {
              id: resource.id,
              resourceId: resource.id,
              name: resource.root_path.split('/').at(-1) ?? resource.id,
              mimeType: assetMimeType(resource.root_path),
              path: resource.root_path,
            };
          }
          const loadTargets = availableResources.flatMap(resource => resource.file_paths
            .filter(path => SCENE_PREVIEW.test(path) || SCENE_FONT.test(path) || /\.json$/i.test(path))
            .map(path => ({ resource, path, name: `${resource.id} · ${path.split('/').at(-1) ?? path}` })));
          const totalFiles = loadTargets.length;
          let loadedFiles = 0;
          const markFileLoaded = (name: string) => {
            loadedFiles += 1;
            updateLoadState({
              progress: totalFiles ? 42 + Math.round((loadedFiles / totalFiles) * 48) : 90,
              label: sceneLoadLabel,
              detail: totalFiles ? `${name} · ${loadedFiles} of ${totalFiles}` : 'No external scene assets required',
            });
          };
          updateLoadState({
            progress: 42,
            label: sceneLoadLabel,
            detail: totalFiles ? `${loadTargets[0].name} · 0 of ${totalFiles}` : 'No external scene assets required',
          });
          // One file-level queue keeps the former 4 x 4 ceiling without making
          // small packs/metadata wait for a resource-level slot or all its images.
          const loadedFilesData = await mapEditorAssets(loadTargets, async ({ resource, path, name }) => {
            try {
              const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal);
              if (/\.json$/i.test(path)) {
                const value = JSON.parse(await blob.text()) as unknown;
                throwIfAborted(signal);
                const sheet = parseSpriteSheet(value);
                const tileSet = (value as { schema?: string } | null)?.schema === 'beegame-tileset.v1' ? parseTileSet(value) : undefined;
                return { resourceId: resource.id, path, sheet, tileSet };
              }
              return { resourceId: resource.id, path, bytes: await blobToDataUrl(blob, signal) };
            } catch (error) {
              if (isAbortError(error)) throw error;
              failedAsset(resource.id, path, error);
              return undefined;
            } finally {
              if (!signal.aborted) markFileLoaded(name);
            }
          }, signal, 16);
          const filesByResource = new Map<string, NonNullable<typeof loadedFilesData[number]>[]>();
          for (const item of loadedFilesData) {
            if (!item) continue;
            const files = filesByResource.get(item.resourceId) ?? [];
            files.push(item);
            filesByResource.set(item.resourceId, files);
          }
          for (const resource of availableResources) {
            // Fonts are first-class scene text assets. Keep them in the same
            // asset table as images so the scene viewport can resolve the exact
            // authored font reference instead of falling back to a system font.
            const previewPaths = resource.file_paths.filter(path => SCENE_PREVIEW.test(path) || SCENE_FONT.test(path));
            const stemCounts = new Map<string, number>();
            for (const path of previewPaths) stemCounts.set(fileStem(path), (stemCounts.get(fileStem(path)) ?? 0) + 1);
            const members: Record<string, string> = {};
            const tables: Record<string, SpriteSheet> = {};
            for (const item of filesByResource.get(resource.id) ?? []) {
              if (item.bytes === undefined) {
                const { path, sheet, tileSet } = item;
                if (sheet) tables[path] = sheet;
                if (sheet || tileSet) {
                  const id = tileSet && path === resource.root_path ? resource.id : `${resource.id}:${path}`;
                  assets[id] = { id, resourceId: resource.id, name: path.split('/').at(-1)!, path, mimeType: 'application/json', ...(sheet ? { spriteSheet: sheet } : {}), ...(tileSet ? { tileSet } : {}) };
                  members[path] = id;
                }
                continue;
              }
              const member = fileStem(item.path);
              const assetId = item.path === resource.root_path ? resource.id : `${resource.id}:${item.path}`;
              assets[assetId] = {
                id: assetId,
                resourceId: resource.id,
                name: item.path.split('/').at(-1) ?? assetId,
                mimeType: assetMimeType(item.path),
                path: item.path,
                bytes: item.bytes,
              };
              if (stemCounts.get(member) === 1) members[member] = assetId;
              members[item.path] = assetId;
            }
            for (const path of previewPaths) {
              const assetId = members[path];
              const metadataPath = editorAtlasPath(resource, path);
              const table = metadataPath ? tables[metadataPath] : undefined;
              if (assetId && table) assets[assetId].spriteSheet = table;
            }
            const rootPath = previewPaths.find(path => editorAtlasPath(resource, path) === resource.root_path)
              ?? preferredScenePreviewPath(resource.root_path, previewPaths);
            const rootMemberId = rootPath ? members[rootPath] : undefined;
            if (rootMemberId && !assets[resource.id].tileSet) assets[resource.id] = { ...assets[rootMemberId], id: resource.id };
            assetMembers[resource.id] = members;
          }
          if (!active || signal.aborted) throw new DOMException('Editor closed', 'AbortError');
          // Resolve the same explicit dependency chain as the authored contract:
          // Tilemap -> TileSet -> image (+ named atlas frame).
          for (const scene of initial ? sceneEntries : []) for (const node of scene.document.data.nodes) for (const component of node.components ?? []) {
            if (component.type !== 'tilemap' || !component.assetRef) continue;
            const member = component.data?.member;
            const id = typeof member === 'string' ? assetMembers[component.assetRef]?.[member] : component.assetRef;
            const tileSet = id && assets[id]?.tileSet;
            if (!tileSet) throw new Error(`Tilemap ${node.id}: TileSet unavailable: ${component.assetRef}${member ? ':' + member : ''}`);
            for (const [tileId, tile] of Object.entries(tileSet.tiles)) {
              requiredAssets.add(tile.sprite.assetRef);
              for (const path of [tile.sprite.member, tile.sprite.atlasMember].filter((path): path is string => !!path)) {
                if (!assetMembers[tile.sprite.assetRef]?.[path])
                  throw new Error(`Tilemap ${node.id}, tile ${tileId}: resource file unavailable: ${tile.sprite.assetRef}:${path}`);
              }
              if (tile.sprite.atlasMember) {
                const atlas = assets[assetMembers[tile.sprite.assetRef][tile.sprite.atlasMember]]?.spriteSheet;
                if (!atlas || !('frames' in atlas) || !atlas.frames[atlasFrameName(tile.sprite.frame!)])
                  throw new Error(`Tilemap ${node.id}, tile ${tileId}: atlas frame unavailable: ${tile.sprite.frame}`);
              }
            }
          }
          const requiredFailures = assetFailures.filter(failure => requiredAssets.has(failure.id)).map(failure => failure.detail);
          for (const failure of assetFailures.filter(failure => !requiredAssets.has(failure.id))) console.warn('Optional scene asset unavailable:', failure.detail);
          if (requiredFailures.length) throw new Error(requiredFailures.join(' · '));
          return { assets, assetMembers };
        }
        let { assets, assetMembers } = await loadResourceAssets(manifest.resources, true);
        uploadAssetsRef.current = async files => {
          const result = await beeGameAdapter.uploadProjectAsset(projectId, `user-${crypto.randomUUID()}`, files);
          if (!active || signal.aborted) throw new DOMException('Editor closed during upload', 'AbortError');
          const imported = await loadResourceAssets(result.manifest.resources.filter(resource => resource.id === result.resource.id), false);
          assets = { ...assets, ...imported.assets };
          assetMembers = { ...assetMembers, ...imported.assetMembers };
          return imported.assets;
        };
        updateLoadState({ progress: 94, label: sceneLoadLabel, detail: 'Resolving hierarchy, transforms, and sprite regions…' });
        const availableScenes = sceneEntries.map(scene => {
          let editorDocument: SceneDocument | undefined;
          return {
            path: scene.path,
            revision: scene.revision,
            document: scene.document,
            // Materialize only the opened scene, then reuse it when switching back.
            loadDocument: () => { editorDocument ??= sceneContentToEditorDocument({
              document: scene.document,
              documentRevision: scene.revision,
              foundationDocumentRevision: snapshot.index!.documentRevision,
              assetManifestRevision: snapshot.index!.assetManifestRevision,
              assets,
              assetMembers,
            }); return { ...editorDocument, assets: { ...editorDocument.assets, ...assets } }; },
          };
        });
        const entry = availableScenes.find(scene => scene.path === targetScene.path);
        if (!entry) return;
        canonicalRef.current = { path: entry.path, revision: entry.revision, document: entry.document };
        setScenes(availableScenes);
        setSelectedScenePath(entry.path);
        setInitialDocument(entry.loadDocument());
        updateLoadState({ progress: 100, label: 'Scene ready', detail: entry.document.id });
        if (active && !signal.aborted) setLoadState({ status: 'ready', progress: 100, label: 'Scene ready', detail: entry.document.id });
      })
      .catch(error => {
        if (active && !isAbortError(error)) {
          controller.abort();
          setLoadState({ status: 'error', progress: 0, label: 'Could not open scene', detail: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      uploadAssetsRef.current = undefined;
      active = false;
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
    };
  }, [initialDocumentPath, projectId, loadAttempt]);

  const closeEditor = () => {
    loadControllerRef.current?.abort();
    onClose();
  };

  // The loaded editor owns Escape (selection, menus and unsaved changes).
  // Before it mounts, the loading/error surface must remain dismissible too.
  useEffect(() => {
    if (loadState.status === 'ready') return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      loadControllerRef.current?.abort();
      onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [loadState.status, onClose]);

  const stopLoading = () => {
    loadControllerRef.current?.abort();
    onClose();
  };

  const retryLoading = () => {
    setInitialDocument(undefined);
    setScenes([]);
    setSelectedScenePath('');
    setLoadState(INITIAL_LOAD_STATE);
    setLoadAttempt(value => value + 1);
  };

  const chooseScene = (path: string) => {
    if (editorDirty || editorSaving || uploadingAssets) return;
    const next = scenes.find(scene => scene.path === path);
    if (!next) return;
    try {
      const document = next.loadDocument();
      canonicalRef.current = { path: next.path, revision: next.revision, document: next.document };
      setSelectedScenePath(next.path);
      setInitialDocument(document);
    } catch (error) {
      setLoadState({ status: 'error', progress: 100, label: 'Could not open scene', detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const save = async (document: SceneDocument) => {
    const current = canonicalRef.current;
    if (!current) throw new Error('The project scene is not loaded.');
    const saved = await beeGameAdapter.saveProjectGameContentDocument(projectId, {
      path: current.path,
      expectedRevision: current.revision,
      document: editorDocumentToSceneContent(document, current.document),
    });
    if (canonicalRef.current?.path === current.path) canonicalRef.current = {
      path: saved.path,
      revision: saved.revision,
      document: saved.document,
    };
    const savedEditorDocument: SceneDocument = {
      ...document,
      source: { ...document.source, contentDigest: saved.revision, contentRevision: saved.revision },
    };
    setScenes(items => items.map(item => item.path === saved.path
      ? { ...item, revision: saved.revision, document: saved.document, loadDocument: () => savedEditorDocument }
      : item));
  };

  return (
    <div className="scene-editor-host fixed inset-0 z-[100] bg-[#303238]" role="dialog" aria-modal="true" aria-label="Scene Editor">
      {loadState.status === 'ready' && initialDocument ? (
        <Suspense fallback={(
          <EditorLoadingView
            state={{ status: 'loading', progress: 96, label: 'Starting editor', detail: 'Preparing the scene viewport…' }}
            progressLabel="Scene loading progress"
            onStop={closeEditor}
          />
        )}>
          <div className="h-full min-h-0">
            <SceneEditor
              key={selectedScenePath}
              initialDocument={initialDocument}
              initialProjection={initialDocument.dimension === '2d' ? 'orthographic' : 'perspective'}
              initialView={initialDocument.dimension === '2d'
                ? { position: [0, 0, 10], target: [0, 0, 0], showGizmos: true }
                : { position: [7, 5, 7], target: [0, 0, 0], showGizmos: true }}
              onUploadAssets={async files => {
                if (!uploadAssetsRef.current) throw new Error('Editor resources are unavailable');
                setUploadingAssets(true);
                try { return await uploadAssetsRef.current(files); }
                finally { setUploadingAssets(false); }
              }}
              onSave={save}
              onClose={closeEditor}
              onDirtyChange={(dirty, saving) => { setEditorDirty(dirty); setEditorSaving(saving); }}
              sceneChoices={scenes.map(scene => ({ id: scene.path, label: scene.document.id }))}
              selectedSceneId={selectedScenePath}
              onSelectScene={chooseScene}
              sceneSwitchDisabled={editorDirty || editorSaving || uploadingAssets}
            />
          </div>
        </Suspense>
      ) : (
        <EditorLoadingView
          state={loadState}
          progressLabel="Scene loading progress"
          onStop={stopLoading}
          onRetry={retryLoading}
          onExit={closeEditor}
        />
      )}
    </div>
  );
}

const SCENE_IMAGE = /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i;
const SCENE_PREVIEW = /\.(?:png|jpe?g|webp|gif|avif|bmp|glb|gltf|bin)$/i;
const SCENE_FONT = /\.(?:woff2?|ttf|otf)$/i;
function preferredScenePreviewPath(rootPath: string, filePaths: string[]): string | undefined {
  if (SCENE_PREVIEW.test(rootPath) || SCENE_FONT.test(rootPath)) return rootPath;
  return filePaths.find(path => SCENE_PREVIEW.test(path) || SCENE_FONT.test(path));
}

function fileStem(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.[^.]+$/, '');
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new DOMException('Scene loading was stopped.', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Asset file did not decode as a data URL.'));
    reader.onerror = () => reject(reader.error ?? new Error('Asset file could not be read.'));
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsDataURL(blob);
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Scene loading was stopped.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function assetMimeType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension && SCENE_IMAGE.test(path)) return `image/${extension}`;
  if (extension === 'glb') return 'model/gltf-binary';
  if (extension === 'gltf') return 'model/gltf+json';
  if (extension === 'obj') return 'model/obj';
  if (extension === 'fbx') return 'application/octet-stream';
  if (extension === 'json') return 'application/json';
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'woff') return 'font/woff';
  if (extension === 'woff2') return 'font/woff2';
  if (extension === 'ttf') return 'font/ttf';
  if (extension === 'otf') return 'font/otf';
  return 'application/octet-stream';
}
