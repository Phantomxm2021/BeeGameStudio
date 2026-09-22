import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubagentActivityView } from './SubagentActivityView';

describe('subagent activity presentation', () => {
    it('renders Read output as TSX with separate line numbers and Bash output as literal text', () => {
        const { container } = render(<SubagentActivityView lang="zh" running={false} activity={{ truncated: false, entries: [
            { id: 'note', kind: 'message', text: '**检查布局**' },
            { id: 'read', kind: 'tool', toolName: 'Read', filePath: 'src/Game.tsx', status: 'completed', output: '237→const value = <div />;\n238→return value;' },
            { id: 'bash', kind: 'tool', toolName: 'Bash', command: 'bun test', status: 'failed', output: '<script>not executable</script>' },
        ] }} />);
        expect(screen.getByText('检查布局').tagName).toBe('STRONG');
        fireEvent.click(screen.getByRole('button', { name: /Game.tsx/ }));
        expect(container.querySelector('[data-language="tsx"]')).toHaveTextContent('const value = <div />;');
        expect(container.querySelector('[aria-hidden="true"].font-mono')).toHaveTextContent('237');
        expect(screen.getByLabelText('命令')).toHaveTextContent('bun test');
        expect(screen.getByLabelText('工具输出')).toHaveTextContent('<script>not executable</script>');
        expect(container.querySelector('script')).toBeNull();
    });

    it('labels truncated and legacy output without inventing its type', () => {
        const { rerender } = render(<SubagentActivityView lang="en" running={false} legacyTrace={'<div>source</div>'} />);
        expect(screen.getByTestId('subagent-legacy-trace')).toHaveTextContent('source metadata is unavailable');
        expect(screen.getByTestId('subagent-legacy-trace')).toHaveTextContent('<div>source</div>');
        rerender(<SubagentActivityView lang="en" running={false} activity={{ truncated: true, entries: [
            { id: 'read', kind: 'tool', toolName: 'Read', status: 'failed', output: 'missing file', truncated: true },
        ] }} />);
        expect(screen.getByText(/Recent activity only/)).toBeInTheDocument();
        expect(screen.getByText(/This output is truncated/)).toBeInTheDocument();
    });
});
