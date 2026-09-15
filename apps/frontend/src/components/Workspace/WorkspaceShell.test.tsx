import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from './WorkspaceShell';

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
});
