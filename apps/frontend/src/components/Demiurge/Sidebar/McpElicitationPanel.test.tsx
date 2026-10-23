import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { McpElicitationPanel } from './McpElicitationPanel';

const form = { mode: 'form', serverName: 'game-assets', message: 'Choose asset options', requestedSchema: {
  type: 'object', properties: { count: { type: 'integer', title: 'Count' }, enabled: { type: 'boolean', title: 'Enabled' },
    style: { type: 'string', title: 'Style', oneOf: [{ const: 'pixel', title: 'Pixel art' }, { const: 'vector', title: 'Vector art' }] } }, required: ['count', 'enabled'] } };
it('submits typed values including false and zero, and preserves input after a rejected answer', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined), onDismiss = vi.fn();
  const props = { input: form, language: 'en', busy: false, onSubmit, onDismiss };
  const { rerender } = render(<McpElicitationPanel {...props} />);
  fireEvent.change(screen.getByLabelText('Count'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Enabled'), { target: { value: 'false' } });
  fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'pixel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(JSON.parse(onSubmit.mock.calls[0][0].content)).toEqual({ count: 0, enabled: false, style: 'pixel' });
  rerender(<McpElicitationPanel {...props} error="Invalid response" />);
  expect(screen.getByLabelText('Count')).toHaveValue(0);
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid response');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

it('opens URL authorization only through an explicit link and waits for confirmation', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<McpElicitationPanel input={{ mode: 'url', serverName: 'assets', message: 'Authorize', url: 'https://example.org/authorize' }} language="en" busy={false} onSubmit={onSubmit} />);
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.org/authorize');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Done, continue' }));
  expect(onSubmit).toHaveBeenCalledWith({ content: '{}' });
});

it('does not allow unsupported nested forms or unsafe URL flows', () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<McpElicitationPanel input={{ ...form, requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } }} language="en" busy={false} onSubmit={onSubmit} />);
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  rerender(<McpElicitationPanel input={{ mode: 'url', url: 'javascript:alert(1)' }} language="en" busy={false} onSubmit={onSubmit} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done, continue' })).toBeDisabled();
});
