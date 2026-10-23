import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubagentActivityView } from './SubagentActivityView';

describe('subagent activity presentation', () => {
    it('updates an approval record in place, without confusing approval with tool completion', () => {
        const permission = { id: 'approval-bash', kind: 'permission' as const, toolName: 'Bash',
            message: 'Shell expansion requires manual approval', status: 'pending' as const };
        const { container, rerender } = render(<SubagentActivityView lang="zh" running={true}
            activity={{ truncated: false, entries: [permission] }} />);
        const row = container.querySelector('[data-permission-id="approval-bash"]');
        expect(row).toHaveTextContent('等待批准');
        rerender(<SubagentActivityView lang="zh" running={true}
            activity={{ truncated: false, entries: [{ ...permission, status: 'allowed' }] }} />);
        expect(container.querySelector('[data-permission-id="approval-bash"]')).toBe(row);
        expect(row).toHaveTextContent('已批准');
        expect(row).not.toHaveTextContent('等待批准');
        rerender(<SubagentActivityView lang="zh" running={false}
            activity={{ truncated: false, entries: [permission] }} />);
        expect(row).toHaveTextContent('结束状态未确认');
        expect(row).not.toHaveTextContent('审批已取消');
        rerender(<SubagentActivityView lang="zh" running={false}
            activity={{ truncated: false, entries: [{ ...permission, status: 'cancelled' }] }} />);
        expect(row).toHaveTextContent('审批已取消');
    });

    it('keeps incomplete, stopped and completed statuses distinct without exposing attachment diagnostics', () => {
        const { container } = render(<SubagentActivityView lang="zh" running={false} activity={{ truncated: false, entries: [
            { id: 'unresolved', kind: 'tool', toolName: 'Bash', status: 'running', elapsedTimeSeconds: 120 },
            { id: 'image', kind: 'tool', toolName: 'Read', status: 'completed', attachmentError: 'raw-attachment-error' },
            { id: 'stopped', kind: 'tool', toolName: 'Bash', status: 'cancelled' },
        ] }} />);
        const missing = container.querySelector('[data-tool-id="unresolved"]')!;
        expect(missing).toHaveTextContent('未完成');
        expect(missing).not.toHaveTextContent('已停止');
        expect(missing).toHaveTextContent('120s');
        expect(container.querySelector('[data-tool-id="stopped"]')).toHaveTextContent('已停止');
        expect(container).not.toHaveTextContent('raw-attachment-error');
    });

    it('shows tool actions and failures while omitting code, inputs and outputs', () => {
        const { container } = render(<SubagentActivityView lang="zh" running={false} activity={{ truncated: false, entries: [
            { id: 'note', kind: 'message', text: '**检查布局**' },
            { id: 'read', kind: 'tool', toolName: 'Read', filePath: '/Users/alice/Game/src/Game.tsx', status: 'completed', output: '237→const value = <div />;' },
            { id: 'bash', kind: 'tool', toolName: 'Bash', command: 'bun test src/Game.tsx --raw-flag', input: '{"raw-input":true}',
                status: 'failed', output: 'raw-failure-output' },
        ] }} />);
        expect(screen.queryByText('检查布局')).not.toBeInTheDocument();
        expect(container).toHaveTextContent('Game.tsx');
        expect(container).not.toHaveTextContent('/Users/alice/Game');
        expect(container).not.toHaveTextContent('const value');
        expect(container).not.toHaveTextContent('raw-input');
        expect(container).not.toHaveTextContent('raw-flag');
        expect(container).not.toHaveTextContent('raw-failure-output');
        expect(container.querySelector('[data-tool-id="bash"]')).toHaveAccessibleDescription('失败');
        expect(container.querySelector('button, pre, details')).toBeNull();
    });

    it('keeps partial history marked without exposing truncated tool output', () => {
        const { container } = render(<SubagentActivityView lang="en" running={false} activity={{ truncated: true, entries: [
            { id: 'read', kind: 'tool', toolName: 'Read', status: 'failed', output: 'raw-truncated-output', truncated: true },
        ] }} />);
        expect(screen.getByText(/Recent activity only/)).toBeInTheDocument();
        expect(container).not.toHaveTextContent('raw-truncated-output');
        expect(screen.getByRole('group', { name: 'Read' })).toHaveAccessibleDescription('Failed');
    });
});
