import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('img-fx', async () => {
  const React = await import('react');
  return {
    ImageGeneration: ({ children, images, autoReveal }: { children: React.ReactNode; images: string[]; autoReveal: boolean }) =>
      <div data-image-source={images[0]} data-auto-reveal={String(Boolean(autoReveal))}>{children}</div>,
  };
});
import { MarkdownRenderer } from './ChatMarkdownContent';

describe('MarkdownRenderer structured output', () => {
  it('keeps a streamed CodeBlock mounted when more code arrives and when streaming completes', () => {
    const initial = '```ts\nconst first = 1;\n';
    const { container, rerender } = render(<MarkdownRenderer content={initial} streaming />);
    const code = container.querySelector('pre');
    expect(screen.getByText('Writing')).toBeInTheDocument();
    const completed = initial + 'const second = 2;\n```';
    rerender(<MarkdownRenderer content={completed} streaming />);
    expect(container.querySelector('pre')).toBe(code);
    rerender(<MarkdownRenderer content={completed} />);
    expect(container.querySelector('pre')).toBe(code);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(container.querySelectorAll('pre pre')).toHaveLength(0);
  });

  it('preserves unsupported-language code as literal text and keeps inline code inline', () => {
    render(<MarkdownRenderer content={'`inline`\n\n```unknown-language\n<fixture>\\n</fixture>\n```'} />);
    expect(screen.getByText('inline').tagName).toBe('CODE');
    expect(document.querySelector('pre code')).toHaveTextContent('<fixture>\\n</fixture>');
    expect(document.querySelector('fixture')).toBeNull();
  });
  it('copies literal escapes and identifiers inside code unchanged', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<MarkdownRenderer content={'```js\nconst wp_1 = "a\\nb";\n```'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const wp_1 = "a\\nb";\n'));
  });

  it('renders markdown images with the image effect within the chat width', async () => {
    render(<MarkdownRenderer content="![Scene preview](https://example.com/scene.png)" />);
    const image = await screen.findByRole('img', { name: 'Scene preview' });
    expect(image.parentElement).toHaveAttribute('data-image-source', 'https://example.com/scene.png');
    expect(image.parentElement).toHaveAttribute('data-auto-reveal', 'false');
  });
  it('groups consecutive Markdown images into a horizontal gallery', async () => {
    const { container } = render(<MarkdownRenderer content={'![AI asset](https://example.com/a.png)\n![Drawn asset](https://example.com/b.png)'} />);
    expect(await screen.findAllByRole('img')).toHaveLength(2);
    expect(container.querySelector('.chat-image-gallery')?.querySelectorAll('[data-image-source]')).toHaveLength(2);
  });
  it('preserves image effects when the rest of a response streams in', async () => {
    const content = '![Preview](https://example.com/a.png)\n\nResult:';
    const { rerender } = render(<MarkdownRenderer content={content} />);
    const image = await screen.findByRole('img');
    rerender(<MarkdownRenderer content={content + ' ready'} />);
    expect(screen.getByRole('img')).toBe(image);
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

  it('wraps genuine JSON inside a user bubble without a dark code surface', () => {
    const content = JSON.stringify({ note: '一段很长的用户原始 JSON 内容' });
    const { container } = render(<MarkdownRenderer content={content} bubble />);
    const pre = container.querySelector('pre');
    expect(pre).toHaveClass('whitespace-pre-wrap', 'break-all', '!bg-transparent', 'text-[currentColor]');
    expect(pre?.querySelector('code')).toHaveClass('!bg-transparent', '!text-[currentColor]');
    expect(pre?.textContent).toBe(content);
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
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
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
