import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownRenderer, MessageItem } from './ChatComponents';

describe('MarkdownRenderer structured output', () => {
    it('renders reviewer payload JSON as a compact user-facing summary', () => {
        const content = JSON.stringify({
            verdict: 'APPROVED',
            blockers: [],
            improvements: [
                '移动端虚拟摇杆的布局细节可进一步细化以确保不同屏幕尺寸下的适配性，但属于非阻塞性优化。'
            ],
            affected_sections: [
                'core_loop',
                'gameplay_systems'
            ],
            summary: '所有列出的阻塞性问题均已通过修订解决。',
            issue_resolutions_by_id: {
                gdd_issue_1: {
                    resolution: 'closed',
                    supporting_quotes: ['internal quote'],
                },
            },
            protocol_valid: false,
        });

        const { container } = render(<MarkdownRenderer content={content} isUser={false} />);
        const text = container.textContent || '';

        expect(text).toContain('Verdict: APPROVED');
        expect(text).toContain('所有列出的阻塞性问题均已通过修订解决。');
        expect(text).toContain('Blocking issues: 0');
        expect(screen.getByText('Improvements')).not.toBeNull();
        expect(screen.getByText('移动端虚拟摇杆的布局细节可进一步细化以确保不同屏幕尺寸下的适配性，但属于非阻塞性优化。')).not.toBeNull();
        expect(text).toContain('Affected sections: core_loop, gameplay_systems');
        expect(screen.queryByText('issue_resolutions_by_id')).toBeNull();
        expect(screen.queryByText('supporting_quotes')).toBeNull();
        expect(screen.queryByText('protocol_valid')).toBeNull();
    });

    it('keeps generic structured JSON rendering for non-reviewer payloads', () => {
        const content = JSON.stringify({
            verdict: 'APPROVED',
            final_output: 'done',
            metadata: { foo: 'bar' },
        });

        render(<MarkdownRenderer content={content} isUser={false} />);

        expect(screen.getByText('done')).not.toBeNull();
    });

    it('renders languageless fenced code blocks as pre blocks', () => {
        const content = "### Diagram\n```\n[A] -> [B]\n | \n[C]\n```";
        render(<MarkdownRenderer content={content} isUser={false} />);
        
        // Should find a pre element (block)
        const preElement = document.querySelector('pre');
        expect(preElement).not.toBeNull();
        expect(preElement?.className).toContain('bg-zinc-800');
        expect(preElement?.textContent).toContain('[A] -> [B]');
    });

    it('renders single backtick code as inline code', () => {
        const content = "This is `inline` code";
        render(<MarkdownRenderer content={content} isUser={false} />);
        
        // Should not find a pre element
        const preElement = document.querySelector('pre');
        expect(preElement).toBeNull();
        
        // Should find a code element with inline styles
        const codeElement = screen.getByText('inline');
        expect(codeElement.tagName).toBe('CODE');
        expect(codeElement.className).toContain('bg-zinc-200');
    });
});

describe('MessageItem semantic rendering', () => {
    it('renders context updates as a collapsed divider without sender chrome', async () => {
        render(
            <MessageItem
                m={{
                    id: 'ctx-1',
                    sender: 'system',
                    content: 'Context used for architecture: blackboard 1, memory 1, RAG 1, skills 2.',
                    timestamp: Date.now(),
                    type: 'system_status',
                    taskKind: 'context_update',
                }}
            />
        );

        expect(screen.getByRole('button', { name: /context update/i })).not.toBeNull();
        expect(screen.queryByText('System Status')).toBeNull();
        expect(screen.queryByText(/Context used for architecture/)).toBeNull();

        await userEvent.setup().click(screen.getByRole('button', { name: /context update/i }));

        expect(screen.getByText(/Context used for architecture/)).not.toBeNull();
    });

    it('renders legacy context-use generation notices as a collapsed divider', async () => {
        render(
            <MessageItem
                m={{
                    id: 'ctx-use-1',
                    sender: 'tecton',
                    content: 'architecture phase generated 2 artifact(s) using context bundle ctx_49d65cf0b7ff.',
                    timestamp: Date.now(),
                    type: 'text',
                }}
            />
        );

        expect(screen.getByRole('button', { name: /use context/i })).not.toBeNull();
        expect(screen.queryByText(/architecture phase generated/)).toBeNull();

        await userEvent.setup().click(screen.getByRole('button', { name: /use context/i }));

        expect(screen.getByText(/architecture phase generated/)).not.toBeNull();
    });

    it('renders artifact cards from semantic type without relying on content keywords', () => {
        const onPreviewArtifact = vi.fn();
        render(
            <MessageItem
                m={{
                    id: 'msg-1',
                    sender: 'metis',
                    content: 'short summary only',
                    timestamp: Date.now(),
                    type: 'artifact_card',
                    artifactType: 'GDD',
                    documentTitle: 'GDD.md',
                    artifactId: 'art_1',
                }}
                onPreviewArtifact={onPreviewArtifact}
            />
        );

        expect(screen.getByText('GDD.md')).not.toBeNull();
        expect(screen.getByText('Open Preview')).not.toBeNull();
        expect(screen.getAllByText('Metis').length).toBeGreaterThan(0);

        screen.getByText('Open Preview').click();
        expect(onPreviewArtifact).toHaveBeenCalledWith('art_1', 'GDD.md', undefined);
    });

    it('does not render plain text generation notices as artifact cards when message type is text', () => {
        render(
            <MessageItem
                m={{
                    id: 'msg-plain-notice',
                    sender: 'metis',
                    content: '已生成产物：GDD.v5.md（GDD v1）',
                    timestamp: Date.now(),
                    type: 'text',
                }}
            />
        );

        expect(screen.queryByText('Open Preview')).toBeNull();
        expect(screen.getByText('已生成产物：GDD.v5.md（GDD v1）')).not.toBeNull();
    });

    it('renders revision request messages as action blocks', () => {
        render(
            <MessageItem
                m={{
                    id: 'msg-2',
                    sender: 'logos',
                    content: '请先修订后继续。',
                    timestamp: Date.now(),
                    type: 'revision_request',
                    nextAction: 'revise',
                    requiresUserAction: true,
                }}
            />
        );

        expect(screen.getByText('Revision Request')).not.toBeNull();
        expect(screen.getByText('revise')).not.toBeNull();
        expect(screen.getByText('请先修订后继续。')).not.toBeNull();
    });

    it('renders last failed check as a recoverable alert action', async () => {
        const onContinueFixing = vi.fn();
        render(
            <MessageItem
                m={{
                    id: 'failed-check-1',
                    sender: 'system',
                    content: 'Last check failed.\nCommand: game-engine build\nOutput: Exit code 1',
                    timestamp: Date.now(),
                    type: 'system_status',
                    taskKind: 'last_check_failed',
                    requiresUserAction: true,
                    nextAction: 'Continue from the last failed check. Fix the reported issue, rerun the relevant check, and keep going until the project runs.',
                }}
                onContinueFixing={onContinueFixing}
            />
        );

        expect(screen.getByText('Last check failed')).not.toBeNull();
        await userEvent.setup().click(screen.getByRole('button', { name: /continue fixing/i }));

        expect(onContinueFixing).toHaveBeenCalledWith(
            'Continue from the last failed check. Fix the reported issue, rerun the relevant check, and keep going until the project runs.',
        );
    });
});
