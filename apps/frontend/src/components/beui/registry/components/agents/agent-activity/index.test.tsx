import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentActivity } from "./index";

afterEach(() => vi.unstubAllGlobals());

it("mounts and observes only expanded content, including after reopening", () => {
  const observers: Array<{ notify: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(callback: () => void) { observers.push({ notify: callback, observe: this.observe, disconnect: this.disconnect }); }
  });
  const items = [{ id: "large", type: "text" as const, content: <pre>{"output\n".repeat(10_000)}</pre> }];
  const { container, rerender } = render(<AgentActivity variant="timeline" items={items} summary="Details" activeLabel="Details" />);
  expect(container.querySelector("pre")).toBeNull();
  expect(observers).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(container.querySelector("pre")?.textContent?.length).toBe(70_000);
  expect(observers).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(container.querySelector("pre")).toBeNull();
  expect(observers[0].disconnect).toHaveBeenCalled();
  rerender(<AgentActivity variant="timeline" items={[{ ...items[0], content: <pre>latest result</pre> }]} summary="Details" activeLabel="Details" />);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(container.querySelector("pre")?.textContent).toBe("latest result");
  expect(observers).toHaveLength(2);
  const viewport = container.querySelector('[role="list"]')?.parentElement;
  if (!viewport) throw new Error("Missing activity viewport");
  Object.defineProperty(viewport, "scrollHeight", { value: 600 });
  Object.defineProperty(viewport, "clientHeight", { value: 200 });
  Object.defineProperty(container.querySelector('[role="list"]'), "offsetHeight", { value: 600 });
  act(() => observers[1].notify());
  expect(viewport.scrollTop).toBe(400);
  fireEvent.wheel(viewport, { deltaY: -20 });
  viewport.scrollTop = 100;
  Object.defineProperty(container.querySelector('[role="list"]'), "offsetHeight", { value: 600 });
  act(() => observers[1].notify());
  expect(viewport.scrollTop).toBe(100);
});
