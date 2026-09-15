import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArtifactPreviewModal } from './ArtifactPreviewModal';

describe('ArtifactPreviewModal', () => {
  it('provides an accessible close control in the modal header', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ArtifactPreviewModal
        isOpen
        onClose={onClose}
        title="GDD.md"
        content="# Overview"
        isLoading={false}
        lang="en"
      />,
    );

    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toBeInTheDocument();
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
