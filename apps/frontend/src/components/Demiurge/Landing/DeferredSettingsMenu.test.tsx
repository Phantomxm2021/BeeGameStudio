import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredSettingsMenu } from './DeferredSettingsMenu';

const { loaded, importReady, resolveImport } = vi.hoisted(() => {
  let resolveImport!: () => void;
  const importReady = new Promise<void>(resolve => { resolveImport = resolve; });
  return { loaded: vi.fn(), importReady, resolveImport };
});
vi.mock('./SettingsMenu', async () => {
  loaded();
  await importReady;
  const { useState } = await import('react');
  return { SettingsMenu: ({ isOpen }: { isOpen: boolean }) => {
    const [draft, setDraft] = useState('');
    return <div hidden={!isOpen}><input aria-label="settings draft" value={draft} onChange={event => setDraft(event.target.value)} /></div>;
  } };
});

it('allows closing during first load, stays closed on completion, and retains later drafts', async () => {
  const props = { lang: 'en' as const, onClose: vi.fn(), onSetLang: vi.fn() };
  const view = render(<DeferredSettingsMenu {...props} isOpen={false} />);
  await act(async () => {});
  expect(loaded).not.toHaveBeenCalled();
  view.rerender(<DeferredSettingsMenu {...props} isOpen />);
  const loading = await screen.findByRole('dialog', { name: 'Settings' });
  fireEvent.keyDown(loading, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledOnce();
  view.rerender(<DeferredSettingsMenu {...props} isOpen={false} />);
  view.rerender(<DeferredSettingsMenu {...props} isOpen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close settings' }));
  expect(props.onClose).toHaveBeenCalledTimes(2);
  view.rerender(<DeferredSettingsMenu {...props} isOpen={false} />);
  await act(async () => { resolveImport(); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'settings draft' })).not.toBeInTheDocument();
  view.rerender(<DeferredSettingsMenu {...props} isOpen />);
  const input = await screen.findByRole('textbox', { name: 'settings draft' });
  fireEvent.change(input, { target: { value: 'unsaved value' } });
  view.rerender(<DeferredSettingsMenu {...props} isOpen={false} />);
  expect(input).not.toBeVisible();
  view.rerender(<DeferredSettingsMenu {...props} isOpen />);
  await waitFor(() => expect(input).toBeVisible());
  expect(input).toHaveValue('unsaved value');
  expect(loaded).toHaveBeenCalledOnce();
  view.unmount();
});
