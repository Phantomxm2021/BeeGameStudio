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

export function SceneEditorOverlay({ projectId, onClose }: SceneEditorOverlayProps) {
  const [initialDocument, setInitialDocument] = useState<SceneDocument>();
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
    const objectUrls: string[] = [];
    setInitialDocument(undefined);
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
        const scene = snapshot.documents?.find(item => {
          const document = item.document as Partial<BeeGameSceneContentDocument>;
          return document.kind === 'scene-2d' && document.id === snapshot.index?.entryScene;
        });
        if (!scene) {
          setLoadError(`Entry scene ${snapshot.index.entryScene} is missing from the content package.`);
          return;
        }
        const document = scene.document as BeeGameSceneContentDocument;
        const loadedAssets = await Promise.all(
          manifest.resources
            .filter(resource => resource.status === 'verified' && document.assetRefs.includes(resource.id))
            .map(async resource => {
              const path = preferredSceneImagePath(resource.root_path, resource.file_paths);
              if (!path) return undefined;
              try {
                const blob = await beeGameAdapter.loadProjectAssetFile(projectId, resource.id, path);
                const uri = URL.createObjectURL(blob);
                if (!active) {
                  URL.revokeObjectURL(uri);
                  return undefined;
                }
                objectUrls.push(uri);
                return {
                  asset: {
                    id: resource.id,
                    name: path.split('/').at(-1) ?? resource.id,
                    mimeType: blob.type || imageMimeType(path),
                    path,
                    uri,
                  } satisfies SceneAsset,
                  regions: spriteRegions(resource.content_profile),
                };
              } catch {
                return undefined;
              }
            }),
        );
        if (!active) return;
        const assets: Record<string, SceneAsset> = {};
        const assetRegions: Record<string, Record<string, TextureRegion>> = {};
        for (const loaded of loadedAssets) {
          if (!loaded) continue;
          assets[loaded.asset.id] = loaded.asset;
          assetRegions[loaded.asset.id] = loaded.regions;
        }
        canonicalRef.current = { path: scene.path, revision: scene.revision, document };
        setInitialDocument(sceneContentToEditorDocument({
          document,
          documentRevision: scene.revision,
          irRevision: snapshot.index.irRevision,
          assetManifestRevision: snapshot.index.assetManifestRevision,
          assets,
          assetRegions,
        }));
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [projectId]);

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
  };

  return (
    <div className="scene-editor-host fixed inset-0 z-[100] flex flex-col bg-[#09090b]" role="dialog" aria-modal="true" aria-label="Scene Editor">
      <div className="min-h-0 flex-1">
        {loadError ? (
          <div className="grid h-full place-items-center bg-[#3c3f43] px-6 text-center text-sm text-white/70" role="alert">{loadError}</div>
        ) : initialDocument ? (
          <Suspense fallback={<div className="grid h-full place-items-center bg-[#3c3f43] text-xs text-white/60">Loading Scene Editor…</div>}>
            <SceneEditor
              initialDocument={initialDocument}
              initialProjection="orthographic"
              initialView={{ position: [0, 20, 0.001], target: [0, 0, 0] }}
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
