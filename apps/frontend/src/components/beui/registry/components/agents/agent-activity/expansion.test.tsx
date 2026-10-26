import { act, fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AgentActivity } from './index';
import { ToolActivityRow } from '../../../../../Demiurge/Sidebar/ToolActivityRow';

it('bounds initial work when a large tool timeline expands', () => {
  const observers: Array<{ notify: IntersectionObserverCallback; node?: Element }> = [];
  vi.stubGlobal('IntersectionObserver', class {
    record: typeof observers[number];
    constructor(notify: IntersectionObserverCallback) { this.record = { notify }; observers.push(this.record); }
    observe(node: Element) { this.record.node = node; }
    disconnect() {} unobserve() {}
  });
  try {
    const items = Array.from({ length: 224 }, (_, index) => ({
      id: `tool-${index}`, type: 'text' as const,
      content: <ToolActivityRow id={`tool-${index}`} name="Shell" input={{ command: 'node check.mjs' }}
        state={index % 15 === 0 ? 'failed' : 'completed'} output={'log line\n'.repeat(index % 15 === 0 ? 6500 : 100)} lang="en" />,
    }));
    const view = render(<AgentActivity variant="timeline" items={items} summary="Details" status="complete" />);
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(view.container.querySelectorAll('[data-tool-id]')).toHaveLength(0);
    expect(view.container.querySelectorAll('[data-activity-item]')).toHaveLength(224);
    act(() => observers.slice(0, 8).forEach(observer => observer.notify(
      [{ isIntersecting: true, target: observer.node } as IntersectionObserverEntry], {} as IntersectionObserver,
    )));
    const rows = view.container.querySelectorAll('[data-tool-id]').length;
    const nodes = view.container.querySelectorAll('*').length;
    const characters = view.container.textContent?.length;
    expect(rows).toBe(8);
    expect(nodes).toBeLessThan(1000);
    expect(characters).toBeLessThan(15_000);
    // Scrolling to an unvisited record must still reveal it; nothing is dropped.
    const last = observers[223];
    act(() => last.notify([{ isIntersecting: true, target: last.node } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(view.container.querySelector('[data-tool-id="tool-223"]')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Details' }));
    expect(view.container.querySelectorAll('[data-tool-id]')).toHaveLength(0);
    view.unmount();
  } finally { vi.unstubAllGlobals(); }
});
