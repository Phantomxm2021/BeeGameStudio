import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorUnavailableDialog } from './EditorUnavailableDialog';

describe('EditorUnavailableDialog', () => {
  it('identifies the requested editor and closes without editing data', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EditorUnavailableDialog kind="scene" onClose={onClose} />);

    expect(screen.getByRole('heading', { name: 'Scene Editor' })).toBeInTheDocument();
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
