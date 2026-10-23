import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToastContext } from '../../contexts/ToastContext';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';

function Actions() {
  const { showSuccess, showError, showWarning, dismissAll, toasts } = useToastContext();
  return <div>
    <button onClick={() => { showSuccess('Saved'); showSuccess('Saved'); }}>Save</button>
    <button onClick={() => showError('Failed')}>Error</button>
    <button onClick={() => showWarning('Warning')}>Warn</button>
    <button onClick={() => { for (let i = 0; i < 6; i++) showSuccess('Notice ' + i); }}>Many</button>
    <button onClick={dismissAll}>Clear</button>
    <output data-testid="count">{toasts.length}</output>
  </div>;
}

describe('global BeUI toast integration', () => {
  it('portals one stack, deduplicates notifications and supports dismissing each status', async () => {
    const { container } = render(<ToastProvider><Actions /></ToastProvider>);
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByText('Error'));
    fireEvent.click(screen.getByText('Warn'));
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite');
    expect(container.contains(screen.getByRole('list'))).toBe(false);
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    fireEvent.click(screen.getAllByLabelText('Dismiss toast')[0]);
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));
  });

  it('keeps a burst within four visible cards', () => {
    render(<ToastProvider><Actions /></ToastProvider>);
    fireEvent.click(screen.getByText('Many'));
    expect(screen.getByTestId('count')).toHaveTextContent('6');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows a global error above an open settings-style dialog', async () => {
    render(<ToastProvider><Dialog open><DialogContent><DialogTitle>Settings</DialogTitle><Actions /></DialogContent></Dialog></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    const toast = await screen.findByText('Failed');
    expect(toast.closest('ol')).toHaveClass('z-[10000]');
    expect(screen.getByRole('dialog')).not.toContainElement(toast);
    expect(toast.closest('[aria-hidden="true"], [inert]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss toast' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
