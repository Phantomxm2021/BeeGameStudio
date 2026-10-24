import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PublicationMarkdown } from './PublicationMarkdown';

describe('public release Markdown', () => {
  it('renders headings, lists, tables, links and code with safe public link behavior', () => {
    render(<PublicationMarkdown>{'## Controls\n\n- **Move** with `WASD`\n\n| Key | Action |\n| --- | --- |\n| R | Retry |\n\n[Guide](https://example.com/guide)\n\n> Have fun.'}</PublicationMarkdown>);
    expect(screen.getByRole('heading', { name: 'Controls', level: 2 })).toBeTruthy();
    expect(screen.getByRole('listitem')).toHaveTextContent('Move with WASD');
    expect(screen.getByRole('cell', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText('WASD').tagName).toBe('CODE');
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not execute embedded HTML or turn unsafe URLs into links', () => {
    const { container } = render(<PublicationMarkdown>{'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Unsafe](javascript:alert%281%29)\n\n![External image](https://example.com/tracker.png)\n\n- [x] Done\n\n```html\n<script>literal</script>\n```'}</PublicationMarkdown>);
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(container.querySelector('a')).not.toHaveAttribute('href', expect.stringMatching(/^javascript:/));
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(container.querySelector('pre code')).toHaveTextContent('<script>literal</script>');
  });
});
