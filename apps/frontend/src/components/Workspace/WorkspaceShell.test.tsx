import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from './WorkspaceShell';
import { DesktopLayoutContext } from '../Desktop/desktopLayoutContext';

describe('WorkspaceShell', () => {
  it('keeps the preview and collaboration slots mounted while switching the narrow layout', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell
        header={<header data-testid="workspace-header">Header</header>}
        preview={<section data-testid="workspace-preview"><iframe data-testid="workspace-preview-frame" title="preview" /></section>}
        collaboration={<aside data-testid="workspace-collaboration">Collaboration</aside>}
        previewLabel="Preview"
        collaborationLabel="Collaboration"
      />,
    );

    expect(screen.getByTestId('workspace-header')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-preview')).toBeInTheDocument();
    const frame = screen.getByTestId('workspace-preview-frame');
    expect(screen.getByTestId('workspace-collaboration')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-mobile-pane', 'preview');
    expect(screen.getByTestId('workspace-preview')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-collaboration')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-preview-frame')).toBe(frame);
  });
  it('resizes only the desktop layout, remembers the ratio and keeps the preview mounted', () => {
    localStorage.removeItem('bgs-desktop-chat-width');
    const content = <WorkspaceShell header={null} preview={<iframe title="Game" />} collaboration={<textarea aria-label="Chat" />} />;
    const wrap = () => <DesktopLayoutContext.Provider value={{ header: null, account: null }}>{content}</DesktopLayoutContext.Provider>;
    const view = render(wrap());
    const frame = screen.getByTitle('Game');
    const divider = screen.getByRole('separator');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(localStorage.getItem('bgs-desktop-chat-width')).toBe('37');
    expect(screen.getByTitle('Game')).toBe(frame);
    view.unmount();
    const next = render(wrap());
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '37');
    fireEvent.doubleClick(screen.getByRole('separator'));
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '35');
    next.unmount();
    render(content);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-shell')).not.toHaveAttribute('style');
    localStorage.removeItem('bgs-desktop-chat-width');
  });

});
