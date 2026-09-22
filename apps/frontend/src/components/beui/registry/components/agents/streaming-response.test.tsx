import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamingResponse } from './streaming-response';

describe('StreamingResponse actions', () => {
  it('keeps Copy while omitting retry and feedback controls', () => {
    const onCopy = vi.fn();

    render(
      <StreamingResponse
        status="complete"
        copyText="A completed response"
        onCopy={onCopy}
      >
        A completed response
      </StreamingResponse>,
    );

    expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry response' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not helpful' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
