import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { SceneDocument } from '@beegame/scene-editor';
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
    setInitialDocument(undefined);
    setLoadError('');
    canonicalRef.current = undefined;
    void beeGameAdapter.getProjectGameContent(projectId)
      .then(snapshot => {
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
        canonicalRef.current = { path: scene.path, revision: scene.revision, document };
        setInitialDocument(sceneContentToEditorDocument({
          document,
          documentRevision: scene.revision,
          irRevision: snapshot.index.irRevision,
          assetManifestRevision: snapshot.index.assetManifestRevision,
        }));
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
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
