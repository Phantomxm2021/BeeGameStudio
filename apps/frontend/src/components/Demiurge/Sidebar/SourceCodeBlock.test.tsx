import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SourceCodeBlock } from './SourceCodeBlock';

it('uses source line numbers from a read receipt and copies actual code without its gutter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<SourceCodeBlock path="/workspace/src/Example.ts" output={'237→const path = "/workspace/assets/raw.png";\n238→const escaped = "a\\nb";'} />);
    expect(screen.getByText('237')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('238')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Example.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const path = "/workspace/assets/raw.png";\nconst escaped = "a\\nb";'));
});

it('does not invent line numbers for an unnumbered partial read', () => {
    const { container } = render(<SourceCodeBlock path="snippet.ts" output="const partial = true;" />);
    expect(container.querySelectorAll('pre [aria-hidden="true"]')).toHaveLength(0);
    expect(container.querySelector('pre')).toHaveTextContent('const partial = true;');
});
