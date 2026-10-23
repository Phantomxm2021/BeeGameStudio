import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamingResponse } from './streaming-response';

describe('StreamingResponse actions', () => {
  it('shows the response time at the bottom while streaming and when complete', () => {
    const { rerender } = render(
      <StreamingResponse status="streaming" timeLabel="09:42" showActions={false}>
        A response in progress
      </StreamingResponse>,
    );
    expect(screen.getByText('09:42').tagName).toBe('TIME');
    rerender(
      <StreamingResponse status="complete" timeLabel="09:42" showActions={false}>
        A completed response
      </StreamingResponse>,
    );
    expect(screen.getByText('09:42').tagName).toBe('TIME');
  });

  it('keeps Copy while omitting retry and feedback controls', () => {
    const onCopy = vi.fn();

    render(
      <StreamingResponse
        status="complete"
        copyText="A completed response"
        timeLabel="09:42"
        onCopy={onCopy}
      >
        A completed response
      </StreamingResponse>,
    );

    expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
    expect(Boolean(screen.getByRole('button', { name: 'Copy response' }).compareDocumentPosition(screen.getByText('09:42')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry response' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not helpful' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
