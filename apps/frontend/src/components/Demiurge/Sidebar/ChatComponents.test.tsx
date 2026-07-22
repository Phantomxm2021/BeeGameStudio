import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './ChatComponents';

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
        expect(preElement?.className).toContain('bg-zinc-950');
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
        expect(codeElement.className).toContain('bg-zinc-950');
    });
});
