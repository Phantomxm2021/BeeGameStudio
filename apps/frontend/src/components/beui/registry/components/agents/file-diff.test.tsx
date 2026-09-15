import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileDiff } from './file-diff';

describe('FileDiff', () => {
  it('shows line numbers and change counts and supports disclosure', () => {
    render(
      <FileDiff
        file="src/example.ts"
        status="complete"
        lines={[
          { id: 'context', type: 'context', oldLine: 1, newLine: 1, content: 'const before = true;' },
          { id: 'removed', type: 'removed', oldLine: 2, content: 'const value = 1;' },
          { id: 'added', type: 'added', newLine: 2, content: 'const value = 2;' },
        ]}
      />,
    );

    const diff = screen.getByTestId('beegame-file-diff');
    expect(diff).toHaveTextContent('src/example.ts');
    expect(diff).toHaveTextContent('+1');
    expect(diff).toHaveTextContent('−1');
    expect(diff.querySelectorAll('[data-diff-line]')).toHaveLength(3);
    expect(diff).toHaveTextContent('const value = 1;');
    expect(diff).toHaveTextContent('const value = 2;');

    const trigger = diff.querySelector('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger!);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
