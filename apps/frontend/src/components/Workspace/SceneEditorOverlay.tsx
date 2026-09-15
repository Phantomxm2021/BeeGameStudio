import { lazy, Suspense } from 'react';
import { X } from 'lucide-react';
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
  return (
    <div className="scene-editor-host fixed inset-0 z-[100] flex flex-col bg-[#09090b]" role="dialog" aria-modal="true" aria-label="Scene Editor">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#111113] px-4 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-white/90">Scene Editor</span>
          <span className="truncate text-[11px] text-white/45">{projectId}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Close Scene Editor"
          title="Close Scene Editor"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center bg-[#3c3f43] text-xs text-white/60">Loading Scene Editor…</div>}>
          <SceneEditor storageKey={`beegame.scene-editor.project.${projectId}.v1`} />
        </Suspense>
      </div>
    </div>
  );
}
