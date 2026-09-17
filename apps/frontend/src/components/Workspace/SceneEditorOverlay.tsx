import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SceneAsset, SceneDocument, SceneNode } from '@beegame/scene-editor';
import '@beegame/scene-editor/styles.css';
import {
  beeGameAdapter,
  type BeeGameSceneContentDocument,
} from '../../services/beeGameAdapter';
import {
  editorDocumentToSceneContent,
  sceneContentToEditorDocument,
  type SpriteFrameTable,
} from './sceneContentAdapter';
import './SceneEditorOverlay.css';

const SceneEditor = lazy(async () => {
  const module = await import('@beegame/scene-editor');
  return { default: module.SceneEditor };
});

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

export function SceneEditorOverlay({ projectId, onClose }: SceneEditorOverlayProps) {
  const [initialDocument, setInitialDocument] = useState<SceneDocument>();
  const [scenes, setScenes] = useState<SceneSnapshot[]>([]);
  const [selectedScenePath, setSelectedScenePath] = useState('');
  const [loadError, setLoadError] = useState('');
  const canonicalRef = useRef<{
    path: string;
    revision: string;
    document: BeeGameSceneContentDocument;
  } | undefined>(undefined);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setInitialDocument(undefined);
    setScenes([]);
    setSelectedScenePath('');
    setLoadError('');
    canonicalRef.current = undefined;
    void Promise.all([
      beeGameAdapter.getProjectGameContent(projectId),
      beeGameAdapter.getProjectAssets(projectId),
    ])
      .then(async ([snapshot, manifest]) => {
        if (!active) return;
        if ((snapshot.state !== 'ready' && snapshot.state !== 'draft') || !snapshot.index) {
          setLoadError(`Scene content is not available yet (${snapshot.state.replaceAll('_', ' ')}).`);
          return;
        }
        const sceneEntries = snapshot.documents?.flatMap(item => {
          const document = item.document as Partial<BeeGameSceneContentDocument>;
          return document.kind === 'scene-2d'
            ? [{ ...item, document: item.document as BeeGameSceneContentDocument }]
            : [];
        }) ?? [];
        if (!sceneEntries.length) {
          setLoadError('The content package has no Scene documents yet.');
          return;
        }
        const referencedAssets = new Set(sceneEntries.flatMap(scene => scene.document.assetRefs));
        if (!active) return;
        const assets: Record<string, SceneAsset> = {};
        const assetRegions: Record<string, Record<string, TextureRegion>> = {};
        const assetMembers: Record<string, Record<string, string>> = {};
        const frameTables: Record<string, Record<string, SpriteFrameTable>> = {};
        const assetFailures: string[] = [];
        await Promise.all(manifest.resources.map(async resource => {
          if (resource.status !== 'verified' || !referencedAssets.has(resource.id)) return;
          const imagePaths = resource.file_paths.filter(path => SCENE_IMAGE.test(path));
          if (!imagePaths.length) return;
          const members: Record<string, string> = {};
          const tables: Record<string, SpriteFrameTable> = {};
          const loaded = await Promise.all(imagePaths.map(async path => {
            try {
              const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path);
              return { path, bytes: await blobToDataUrl(blob) };
            } catch (error) {
              assetFailures.push(`${resource.id}/${path.split('/').at(-1) ?? path}: ${error instanceof Error ? error.message : String(error)}`);
              return undefined;
            }
          }));
          for (const item of loaded) {
            if (!item) continue;
            const member = fileStem(item.path);
            const assetId = item.path === resource.root_path ? resource.id : `${resource.id}:${member}`;
            assets[assetId] = {
              id: assetId,
              name: item.path.split('/').at(-1) ?? assetId,
              mimeType: imageMimeType(item.path),
              path: item.path,
              bytes: item.bytes,
            };
            members[member] = assetId;
          }
          const tablePaths = resource.file_paths.filter(path => /\.json$/i.test(path));
          await Promise.all(tablePaths.map(async path => {
            try {
              const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path);
              const value = JSON.parse(await blob.text()) as unknown;
              if (isSpriteFrameTable(value)) tables[fileStem(path)] = value;
            } catch (error) {
              assetFailures.push(`${resource.id}/${path.split('/').at(-1) ?? path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }));
          if (!assets[resource.id]) {
            const rootPath = preferredSceneImagePath(resource.root_path, imagePaths);
            const rootMemberId = rootPath ? members[fileStem(rootPath)] : undefined;
            if (rootMemberId) assets[resource.id] = { ...assets[rootMemberId], id: resource.id };
          }
          assetMembers[resource.id] = members;
          frameTables[resource.id] = tables;
          assetRegions[resource.id] = spriteRegions(resource.content_profile);
        }));
        if (assetFailures.length) {
          setLoadError(`Scene assets could not be loaded: ${assetFailures.slice(0, 3).join(' · ')}${assetFailures.length > 3 ? ` · +${assetFailures.length - 3} more` : ''}`);
          return;
        }
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
            assetRegions,
            assetMembers,
            frameTables,
          }),
        }));
        const entry = availableScenes.find(scene => scene.document.id === snapshot.index?.entryScene)
          ?? availableScenes[0];
        if (!entry) return;
        canonicalRef.current = { path: entry.path, revision: entry.revision, document: entry.document };
        setScenes(availableScenes);
        setSelectedScenePath(entry.path);
        setInitialDocument(entry.editorDocument);
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const chooseScene = (path: string) => {
    const next = scenes.find(scene => scene.path === path);
    if (!next) return;
    canonicalRef.current = { path: next.path, revision: next.revision, document: next.document };
    setSelectedScenePath(next.path);
    setInitialDocument(next.editorDocument);
    setLoadError('');
  };

  const save = async (document: SceneDocument) => {
    const current = canonicalRef.current;
    if (!current) throw new Error('The project scene is not loaded.');
    const saved = await beeGameAdapter.saveProjectGameContentDocument(projectId, {
      path: current.path,
      expectedRevision: current.revision,
      document: editorDocumentToSceneContent(document, current.document),
    });
    canonicalRef.current = {
      path: saved.path,
      revision: saved.revision,
      document: saved.document,
    };
    setScenes(items => items.map(item => item.path === saved.path
      ? { ...item, revision: saved.revision, document: saved.document }
      : item));
  };

  return (
    <div className="scene-editor-host fixed inset-0 z-[100] flex flex-col bg-[#09090b]" role="dialog" aria-modal="true" aria-label="Scene Editor">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-[#17181b] px-4 text-sm text-white">
        <strong>Scene Editor</strong>
        <select
          aria-label="Scene document"
          className="min-w-40 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
          value={selectedScenePath}
          onChange={event => chooseScene(event.target.value)}
          disabled={!scenes.length}
        >
          {scenes.map(scene => <option key={scene.path} value={scene.path}>{scene.document.id}</option>)}
        </select>
        <span className="min-w-0 flex-1 truncate text-xs text-white/50">
          {loadError ? 'Scene is not ready to edit' : scenes.length > 1 ? `${scenes.length} scenes` : ''}
        </span>
        <button type="button" className="rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10" onClick={onClose}>Back to project</button>
      </header>
      <div className="min-h-0 flex-1">
        {loadError ? (
          <div className="grid h-full place-items-center bg-[#3c3f43] px-6 text-center text-sm text-white/70" role="alert">
            <div><p>{loadError}</p><button type="button" className="mt-4 rounded-md bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20" onClick={onClose}>Back to project</button></div>
          </div>
        ) : initialDocument ? (
          <Suspense fallback={<div className="grid h-full place-items-center bg-[#3c3f43] text-xs text-white/60">Loading Scene Editor…</div>}>
            <SceneEditor
              key={selectedScenePath}
              initialDocument={initialDocument}
              initialProjection="orthographic"
              initialView={{ position: [6.4, 20, 3.601], target: [6.4, 0, 3.6], showGizmos: false }}
              onSave={save}
              onClose={onClose}
            />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center bg-[#3c3f43] text-xs text-white/60">Loading project scene…</div>
        )}
      </div>
    </div>
  );
}

const SCENE_IMAGE = /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i;
type TextureRegion = NonNullable<NonNullable<SceneNode['material']>['textureRegion']>;

function preferredSceneImagePath(rootPath: string, filePaths: string[]): string | undefined {
  if (SCENE_IMAGE.test(rootPath)) return rootPath;
  return filePaths.find(path => SCENE_IMAGE.test(path));
}

function fileStem(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.[^.]+$/, '');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Asset file did not decode as a data URL.'));
    reader.onerror = () => reject(reader.error ?? new Error('Asset file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function imageMimeType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return extension ? `image/${extension}` : 'application/octet-stream';
}

function spriteRegions(contentProfile: Record<string, unknown> | undefined): Record<string, TextureRegion> {
  const components = contentProfile?.components;
  if (!Array.isArray(components)) return {};
  const regions: Record<string, TextureRegion> = {};
  for (const component of components) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) continue;
    const value = component as Record<string, unknown>;
    if (value.kind !== 'sprite-frame' && value.kind !== 'atlas-region') continue;
    if (typeof value.id !== 'string' || !value.specs || typeof value.specs !== 'object' || Array.isArray(value.specs)) continue;
    const specs = value.specs as Record<string, unknown>;
    const region = { x: specs.x, y: specs.y, width: specs.width, height: specs.height };
    if (!isTextureRegion(region)) continue;
    regions[value.id] = region;
  }
  return regions;
}

function isTextureRegion(value: Record<string, unknown>): value is TextureRegion {
  return (
    typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 &&
    typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 &&
    typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 &&
    typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0
  );
}

function isSpriteFrameTable(value: unknown): value is SpriteFrameTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const table = value as Record<string, unknown>;
  return (
    typeof table.frameWidth === 'number' && table.frameWidth > 0 &&
    typeof table.frameHeight === 'number' && table.frameHeight > 0 &&
    typeof table.framesPerFacing === 'number' && table.framesPerFacing > 0
  );
}
