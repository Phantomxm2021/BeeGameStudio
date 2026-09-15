import { lazy, Suspense, useEffect } from 'react';
import '@beegame/scene-editor/styles.css';
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
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="scene-editor-host fixed inset-0 z-[100] flex flex-col bg-[#09090b]" role="dialog" aria-modal="true" aria-label="Scene Editor">
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center bg-[#3c3f43] text-xs text-white/60">Loading Scene Editor…</div>}>
          <SceneEditor storageKey={`beegame.scene-editor.project.${projectId}.v1`} onClose={onClose} />
        </Suspense>
      </div>
    </div>
  );
}
