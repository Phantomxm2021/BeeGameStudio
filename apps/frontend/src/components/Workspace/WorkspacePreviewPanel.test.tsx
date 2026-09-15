import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';

const props = {
  title: 'Preview',
  labels: { console: 'Console', fixBuildErrors: 'Fix build errors' },
  embeddedPreviewUrl: '',
  previewState: 'idle' as const,
  statusText: 'Waiting for a playable surface',
  previewDetailText: '',
  buildErrorLog: '',
  previewFrameRef: { current: null },
  canShowPreview: false,
};

describe('WorkspacePreviewPanel', () => {
  it('uses one semantic preview well without an elevated border or shadow', () => {
    render(<WorkspacePreviewPanel {...props} />);
    const surface = screen.getByTestId('beegame-preview-surface');
    expect(surface).toHaveClass('bg-[var(--preview-well)]', 'rounded-xl');
    expect(surface).not.toHaveClass('border', 'shadow', 'shadow-lg');
  });
});
