import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './ChatComponents';

describe('MarkdownRenderer structured output', () => {
    it('renders only the explicit user-facing text from a generic JSON payload', () => {
        const content = JSON.stringify({
            verdict: 'APPROVED',
            final_output: 'done',
            metadata: { foo: 'bar' },
        });

        render(<MarkdownRenderer content={content} isUser={false} />);

        expect(screen.getByText('done')).not.toBeNull();
        expect(screen.queryByText('metadata')).toBeNull();
        expect(screen.queryByText('foo')).toBeNull();
        expect(screen.queryByText('bar')).toBeNull();
    });

    it('hides internal JSON payloads without user-facing text', () => {
        const content = JSON.stringify({
            workerType: 'resource-preparer',
            status: 'completed',
            writtenPaths: ['assets/asset-manifest.json'],
            importIds: ['imp-one'],
        });

        const { container } = render(<MarkdownRenderer content={content} isUser={false} />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText('resource-preparer')).toBeNull();
        expect(screen.queryByText('assets/asset-manifest.json')).toBeNull();
    });

    it('does not expose nested JSON inside a deliverable payload', () => {
        const content = JSON.stringify({
            deliverable: {
                summary: '资源准备完成。',
                internal: { revision: 'private-revision' },
            },
        });

        render(<MarkdownRenderer content={content} isUser={false} />);

        expect(screen.getByText('资源准备完成。')).not.toBeNull();
        expect(screen.queryByText('internal')).toBeNull();
        expect(screen.queryByText('private-revision')).toBeNull();
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
