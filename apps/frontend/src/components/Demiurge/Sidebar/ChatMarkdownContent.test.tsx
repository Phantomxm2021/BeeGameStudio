import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './ChatMarkdownContent';

describe('MarkdownRenderer structured output', () => {
  it('keeps literal escapes and identifiers inside code unchanged', () => {
    render(<MarkdownRenderer content={'```js\nconst wp_1 = "a\\nb";\n```'} />);
    expect(document.querySelector('pre code')?.textContent).toBe('const wp_1 = "a\\nb";\n');
  });

  it('renders markdown images lazily within the chat width', () => {
    render(<MarkdownRenderer content="![Scene preview](https://example.com/scene.png)" />);
    expect(screen.getByRole('img', { name: 'Scene preview' })).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('img')).toHaveClass('max-w-full', 'object-contain');
  });
  it('retains the entire JSON response instead of picking fields by name', () => {
    const content = JSON.stringify({
      verdict: 'APPROVED',
      final_output: 'done',
      metadata: { foo: 'bar' },
    });

    render(<MarkdownRenderer content={content} />);

    expect(document.querySelector('pre code')?.textContent).toBe(content);
  });

  it('does not guess whether visible JSON is internal based on its field names', () => {
    const content = JSON.stringify({
      workerType: 'resource-curator',
      status: 'completed',
      writtenPaths: ['assets/asset-manifest.json'],
      importIds: ['imp-one'],
    });

    const { container } = render(<MarkdownRenderer content={content} />);

    expect(container.querySelector('pre code')?.textContent).toBe(content);
  });

  it('preserves nested data in a deliverable response', () => {
    const content = JSON.stringify({
      deliverable: {
        summary: '资源准备完成。',
        internal: { revision: 'private-revision' },
      },
    });

    render(<MarkdownRenderer content={content} />);

    expect(document.querySelector('pre code')?.textContent).toBe(content);
  });

  it('renders languageless fenced code blocks as pre blocks', () => {
    const content = '### Diagram\n```\n[A] -> [B]\n | \n[C]\n```';
    render(<MarkdownRenderer content={content} />);

    // Should find a pre element (block)
    const preElement = document.querySelector('pre');
    expect(preElement).not.toBeNull();
    expect(preElement?.className).toContain('bg-[var(--surface-3)]');
    expect(preElement?.textContent).toContain('[A] -> [B]');
  });

  it('renders single backtick code as inline code', () => {
    const content = 'This is `inline` code';
    render(<MarkdownRenderer content={content} />);

    // Should not find a pre element
    const preElement = document.querySelector('pre');
    expect(preElement).toBeNull();

    // Should find a code element with inline styles
    const codeElement = screen.getByText('inline');
    expect(codeElement.tagName).toBe('CODE');
    expect(codeElement.className).toContain('bg-[var(--surface-3)]');
  });

  it('renders common assistant markdown as semantic elements without source markers', () => {
    render(<MarkdownRenderer content={'# Heading\n\n- one\n- two\n\n`inline`\n\n```ts\nconst ready = true;\n```\n\n[Docs](https://example.com/docs)'} />);

    expect(screen.getByRole('heading', { name: 'Heading', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('inline').tagName).toBe('CODE');
    expect(document.querySelector('pre code')).toHaveTextContent('const ready = true;');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(document.body.textContent).not.toContain('# Heading');
    expect(document.body.textContent).not.toContain('```');
  });
});
