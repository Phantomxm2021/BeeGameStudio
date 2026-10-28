import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopLayout } from '../Desktop/desktopLayoutContext';
import { readDesktopPreference, writeDesktopPreference } from '../Desktop/desktopPreferences';
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
  const desktop = useDesktopLayout();
  const { t } = useTranslation('landing');
  const shell = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const stored = desktop ? Number(readDesktopPreference('bgs-desktop-chat-width')) : 0;
    return Number.isFinite(stored) && stored >= 20 && stored <= 65 ? stored : 35;
  });
  const widthRef = useRef(chatWidth);
  const [mobilePane, setMobilePane] = useState<WorkspacePane>(initialPane);
  const updateWidth = (value: number, save = false) => {
    const minimum = shell.current?.clientWidth ? Math.min(65, Math.max(20, Math.ceil(320 / shell.current.clientWidth * 100))) : 20;
    const next = Math.max(minimum, Math.min(65, Math.round(value)));
    widthRef.current = next;
    setChatWidth(next);
    if (save) writeDesktopPreference('bgs-desktop-chat-width', String(next));
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = shell.current?.getBoundingClientRect();
    if (bounds?.width) updateWidth((bounds.right - event.clientX) / bounds.width * 100);
  };
  useEffect(() => {
    if (!desktop) return;
    const focusChat = () => setMobilePane('collaboration');
    window.addEventListener('beegame-focus-chat-input', focusChat);
    return () => window.removeEventListener('beegame-focus-chat-input', focusChat);
  }, [desktop]);

  return (
    <div
      ref={shell}
      className="workspace-shell"
      data-resizable={desktop ? 'true' : undefined}
      data-resizing={isDragging ? 'true' : undefined}
      style={desktop ? { '--desktop-chat-width': `${chatWidth}%` } as CSSProperties : undefined}
      data-mobile-pane={mobilePane}
      data-testid="workspace-shell"
    >
      <div className="workspace-slot workspace-header-slot">{header}</div>
      <div className="workspace-slot workspace-preview-slot">{preview}</div>
      {desktop ? <div role="separator" aria-orientation="vertical" tabIndex={0}
        className="desktop-workspace-divider" aria-label={t('desktop.resizePanels')}
        aria-valuemin={20} aria-valuemax={65} aria-valuenow={chatWidth}
        title={t('desktop.resizePanelsHint')}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          dragging.current = true;
          setIsDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag(event);
        }}
        onPointerMove={event => { if (dragging.current) drag(event); }}
        onPointerUp={event => {
          if (!dragging.current) return;
          drag(event);
          updateWidth(widthRef.current, true);
          dragging.current = false;
          setIsDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { dragging.current = false; setIsDragging(false); }}
        onPointerCancel={() => { dragging.current = false; setIsDragging(false); }}
        onDoubleClick={() => updateWidth(35, true)}
        onKeyDown={event => {
          const next = event.key === 'ArrowLeft' ? chatWidth + 2 : event.key === 'ArrowRight' ? chatWidth - 2
            : event.key === 'Home' ? 35 : null;
          if (next !== null) { event.preventDefault(); updateWidth(next, true); }
        }} /> : null}
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
