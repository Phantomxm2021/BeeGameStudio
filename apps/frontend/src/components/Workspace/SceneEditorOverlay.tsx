import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SceneAsset, SceneDocument } from '@beegame/scene-editor';
import { parseSpriteSheet, type SpriteSheet } from '@beegame/scene-editor';
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
import { mapEditorAssets } from './editorAssetLoading';

const loadSceneEditor = async () => {
  const module = await import('@beegame/scene-editor');
  return { default: module.SceneEditor };
};
const SceneEditor = lazy(loadSceneEditor);

interface SceneEditorOverlayProps {
  projectId: string;
  onClose: () => void;
}

type SceneSnapshot = {
  path: string;
  revision: string;
  document: BeeGameSceneContentDocument;
  editorDocument: SceneDocument;
};

type SceneLoadState = EditorLoadState;

const INITIAL_LOAD_STATE: SceneLoadState = {
  status: 'loading',
  progress: 8,
  label: 'Opening scene',
  detail: 'Connecting to the project…',
};

export function SceneEditorOverlay({ projectId, onClose }: SceneEditorOverlayProps) {
  const [initialDocument, setInitialDocument] = useState<SceneDocument>();
  const [scenes, setScenes] = useState<SceneSnapshot[]>([]);
  const [selectedScenePath, setSelectedScenePath] = useState('');
  const [loadState, setLoadState] = useState<SceneLoadState>(INITIAL_LOAD_STATE);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
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
        const targetScene = sceneEntries.find(scene => scene.document.id === snapshot.index?.entryScene)
          ?? sceneEntries[0];
        const sceneLoadLabel = targetScene.document.id;
        // The picker must include verified project resources, not just existing scene references.
        if (!active || signal.aborted) return;
        const assets: Record<string, SceneAsset> = {};
        const assetMembers: Record<string, Record<string, string>> = {};
        const assetFailures: string[] = [];
        const requiredAssets = new Set(sceneEntries.flatMap(scene => scene.document.assetRefs));
        const failedAsset = (id: string, path: string, error: unknown) => {
          const detail = `${id}/${path.split('/').at(-1) ?? path}: ${error instanceof Error ? error.message : String(error)}`;
          if (requiredAssets.has(id)) assetFailures.push(detail);
          else console.warn('Optional scene asset unavailable:', detail);
        };
        const availableResources = manifest.resources.filter(resource => resource.status === 'verified');
        for (const resource of availableResources) {
          assets[resource.id] = {
            id: resource.id,
            name: resource.root_path.split('/').at(-1) ?? resource.id,
            mimeType: assetMimeType(resource.root_path),
            path: resource.root_path,
          };
        }
        const loadTargets = availableResources.flatMap(resource => resource.file_paths
          .filter(path => SCENE_PREVIEW.test(path) || /\.json$/i.test(path))
          .map(path => ({ name: `${resource.id} · ${path.split('/').at(-1) ?? path}` })));
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
        await mapEditorAssets(availableResources, async resource => {
          const previewPaths = resource.file_paths.filter(path => SCENE_PREVIEW.test(path));
          const members: Record<string, string> = {};
          const tables: Record<string, SpriteSheet> = {};
          const loaded = await mapEditorAssets(previewPaths, async path => {
            try {
              const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal);
              return { path, bytes: await blobToDataUrl(blob, signal) };
            } catch (error) {
              if (isAbortError(error)) throw error;
              failedAsset(resource.id, path, error);
              return undefined;
            } finally {
              if (!signal.aborted) markFileLoaded(`${resource.id} · ${path.split('/').at(-1) ?? path}`);
            }
          });
          for (const item of loaded) {
            if (!item) continue;
            const member = fileStem(item.path);
            const assetId = item.path === resource.root_path ? resource.id : `${resource.id}:${member}`;
            assets[assetId] = {
              id: assetId,
              name: item.path.split('/').at(-1) ?? assetId,
              mimeType: assetMimeType(item.path),
              path: item.path,
              bytes: item.bytes,
            };
            members[member] = assetId;
          }
          const tablePaths = resource.file_paths.filter(path => /\.json$/i.test(path));
          await mapEditorAssets(tablePaths, async path => {
            try {
              const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path, signal);
              const value = JSON.parse(await blob.text()) as unknown;
              throwIfAborted(signal);
              const sheet = parseSpriteSheet(value);
              if (sheet) tables[fileStem(path)] = sheet;
            } catch (error) {
              if (isAbortError(error)) throw error;
              failedAsset(resource.id, path, error);
            } finally {
              if (!signal.aborted) markFileLoaded(`${resource.id} · ${path.split('/').at(-1) ?? path}`);
            }
          });
          for (const [member, assetId] of Object.entries(members)) {
            if (tables[member]) assets[assetId].spriteSheet = tables[member];
          }
          const rootPath = preferredScenePreviewPath(resource.root_path, previewPaths);
          const rootMemberId = rootPath ? members[fileStem(rootPath)] : undefined;
          if (rootMemberId) assets[resource.id] = { ...assets[rootMemberId], id: resource.id };
          assetMembers[resource.id] = members;
        });
        if (!active || signal.aborted) return;
        if (assetFailures.length) {
          setLoadState({ status: 'error', progress: 90, label: 'Assets could not be loaded', detail: `${assetFailures.slice(0, 3).join(' · ')}${assetFailures.length > 3 ? ` · +${assetFailures.length - 3} more` : ''}` });
          return;
        }
        updateLoadState({ progress: 94, label: sceneLoadLabel, detail: 'Resolving hierarchy, transforms, and sprite regions…' });
        const availableScenes = sceneEntries.map(scene => ({
          path: scene.path,
          revision: scene.revision,
          document: scene.document,
          editorDocument: sceneContentToEditorDocument({
            document: scene.document,
            documentRevision: scene.revision,
            foundationDocumentRevision: snapshot.index!.documentRevision,
            assetManifestRevision: snapshot.index!.assetManifestRevision,
            assets,
            assetMembers,
          }),
        }));
        const entry = availableScenes.find(scene => scene.document.id === snapshot.index?.entryScene)
          ?? availableScenes[0];
        if (!entry) return;
        canonicalRef.current = { path: entry.path, revision: entry.revision, document: entry.document };
        setScenes(availableScenes);
        setSelectedScenePath(entry.path);
        setInitialDocument(entry.editorDocument);
        updateLoadState({ progress: 100, label: 'Scene ready', detail: entry.document.id });
        await waitForTransition(signal);
        if (active && !signal.aborted) setLoadState({ status: 'ready', progress: 100, label: 'Scene ready', detail: entry.document.id });
      })
      .catch(error => {
        if (active && !isAbortError(error)) {
          setLoadState({ status: 'error', progress: 0, label: 'Could not open scene', detail: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
    };
  }, [projectId, loadAttempt]);

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
    if (editorDirty || editorSaving) return;
    const next = scenes.find(scene => scene.path === path);
    if (!next) return;
    canonicalRef.current = { path: next.path, revision: next.revision, document: next.document };
    setSelectedScenePath(next.path);
    setInitialDocument(next.editorDocument);
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
      ? { ...item, revision: saved.revision, document: saved.document, editorDocument: savedEditorDocument }
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
              onSave={save}
              onClose={closeEditor}
              onDirtyChange={(dirty, saving) => { setEditorDirty(dirty); setEditorSaving(saving); }}
              sceneChoices={scenes.map(scene => ({ id: scene.path, label: scene.document.id }))}
              selectedSceneId={selectedScenePath}
              onSelectScene={chooseScene}
              sceneSwitchDisabled={editorDirty || editorSaving}
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
function preferredScenePreviewPath(rootPath: string, filePaths: string[]): string | undefined {
  if (SCENE_PREVIEW.test(rootPath)) return rootPath;
  return filePaths.find(path => SCENE_PREVIEW.test(path));
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

function waitForTransition(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 180);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Scene loading was stopped.', 'AbortError'));
    }, { once: true });
  });
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
  return 'application/octet-stream';
}
