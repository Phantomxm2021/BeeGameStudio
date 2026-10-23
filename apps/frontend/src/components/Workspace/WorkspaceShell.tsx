import { type ReactNode, useState } from 'react';
import './WorkspaceShell.css';

export type WorkspacePane = 'preview' | 'collaboration';

interface WorkspaceShellProps {
  header: ReactNode;
  preview: ReactNode;
  collaboration: ReactNode;
  previewLabel?: string;
  collaborationLabel?: string;
  initialPane?: WorkspacePane;
}

/**
 * Owns the only workbench geometry. Slot wrappers control grid placement;
 * narrow layouts hide a wrapper without unmounting its feature panel.
 */
export function WorkspaceShell({
  header,
  preview,
  collaboration,
  previewLabel = 'Preview',
  collaborationLabel = 'Collaboration',
  initialPane = 'collaboration',
}: WorkspaceShellProps) {
  const [mobilePane, setMobilePane] = useState<WorkspacePane>(initialPane);

  return (
    <div
      className="workspace-shell"
      data-mobile-pane={mobilePane}
      data-testid="workspace-shell"
    >
      <div className="workspace-slot workspace-header-slot">{header}</div>
      <div className="workspace-slot workspace-preview-slot">{preview}</div>
      <div className="workspace-slot workspace-collaboration-slot">{collaboration}</div>
      <div className="workspace-mobile-tabs" role="group" aria-label="Workspace view">
        <button
          type="button"
          aria-pressed={mobilePane === 'preview'}
          className="workspace-mobile-tab"
          data-active={mobilePane === 'preview' ? 'true' : 'false'}
          onClick={() => setMobilePane('preview')}
        >
          {previewLabel}
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === 'collaboration'}
          className="workspace-mobile-tab"
          data-active={mobilePane === 'collaboration' ? 'true' : 'false'}
          onClick={() => setMobilePane('collaboration')}
        >
          {collaborationLabel}
        </button>
      </div>
    </div>
  );
}
