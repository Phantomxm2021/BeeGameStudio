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


const approval = { mode: 'form', serverName: 'bgs-blender', message: 'Allow Blender to execute code?',
  _meta: { bgs_approval_kind: 'mcp_tool_call', persist: ['session', 'always'],
    tool_title: 'Execute Blender code', tool_params: { code: 'print("noop")', user_prompt: 'Build a game' } },
  requestedSchema: { type: 'object', properties: {} } };
it('shows native approval arguments and defaults to a single call, preserving explicit supported scope choices', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<McpElicitationPanel input={approval} language="en" busy={false} onSubmit={onSubmit} />);
  expect(screen.getByText('Execute Blender code')).toBeInTheDocument();
  expect(screen.getByLabelText('Tool arguments')).toHaveTextContent('print');
  expect(screen.getByLabelText('Tool arguments')).toHaveTextContent('noop');
  expect(screen.getByLabelText('Approval scope')).toHaveValue('once');
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(onSubmit).toHaveBeenLastCalledWith({ content: '{}' });
  for (const persist of ['session', 'always']) {
    fireEvent.change(screen.getByLabelText('Approval scope'), { target: { value: persist } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ content: '{}', persist });
  }
});

it('only offers advertised native approval scopes and never upgrades ordinary forms to tool approvals', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined), onDismiss = vi.fn();
  const props = { language: 'zh', busy: false, onSubmit, onDismiss };
  const { rerender } = render(<McpElicitationPanel {...props} input={{ ...approval, _meta: { ...approval._meta, persist: 'session' } }} />);
  expect(screen.getByRole('option', { name: '本会话内的此工具' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '今后对此工具不再询问' })).not.toBeInTheDocument();
  rerender(<McpElicitationPanel {...props} input={{ ...approval, _meta: { bgs_approval_kind: 'mcp_tool_call' } }} />);
  expect(screen.queryByLabelText('授权范围')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '允许' }));
  expect(onSubmit).toHaveBeenLastCalledWith({ content: '{}' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onDismiss).toHaveBeenCalledOnce();
  rerender(<McpElicitationPanel {...props} input={{ ...approval, _meta: { persist: ['session', 'always'] } }} />);
  expect(screen.queryByLabelText('授权范围')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('调用参数')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument();
});
