import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolActivityRow } from './ToolActivityRow';

afterEach(() => vi.unstubAllGlobals());

it('copies the displayed result, preserves source data and renders markup as literal output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const output = '<script>alert(1)</script> /Users/demo/project/report.json\ncloudflare / gpt-image-2.5-flare / low';
    const { container } = render(<ToolActivityRow id="copy" name="Read" state="completed" output={output} lang="zh" />);
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('log')).toHaveTextContent('<script>alert(1)</script> report.json BGS Image');
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith('<script>alert(1)</script> report.json\nBGS Image');
    expect(output).toContain('/Users/demo/project/');
});

it('reports clipboard failures without claiming that output was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ToolActivityRow id="copy-failure" name="Shell" state="failed" output="Permission denied" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
});

it('keeps partial output accessible when a running tool fails or stops', () => {
    const { rerender } = render(<ToolActivityRow id="partial" name="Shell" state="running" output="partial result" lang="en" />);
    for (const state of ['failed', 'stopped', 'incomplete'] as const) {
        rerender(<ToolActivityRow id="partial" name="Shell" state={state} output="partial result" lang="en" />);
        expect(screen.getByRole('log')).toHaveTextContent('partial result');
        expect(screen.getByRole('group')).toHaveAccessibleDescription({ failed: 'Failed', stopped: 'Stopped', incomplete: 'Incomplete' }[state]);
    }
});

it('bounds large output on open, expands it on request and copies the entire result', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const output = 'BEGIN\n' + 'line of output\n'.repeat(1800) + 'END';
    const { container } = render(<ToolActivityRow id="bounded" name="Shell" state="completed" output={output} lang="en" />);
    fireEvent.click(screen.getByRole('button'));
    const code = container.querySelector('code')!;
    expect(code.textContent).toContain('BEGIN');
    expect(code.textContent).toContain('END');
    expect(code.textContent.length).toBeLessThan(13_000);
    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(output));
    fireEvent.click(screen.getByRole('button', { name: 'Show more output' }));
    expect(code.textContent.length).toBeGreaterThan(13_000);
    expect(code.textContent.length).toBeLessThan(25_000);
    fireEvent.click(screen.getByRole('button', { name: 'Show more output' }));
    expect(code.textContent).toBe(output);
    expect(screen.queryByRole('button', { name: 'Show more output' })).not.toBeInTheDocument();
});
