import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Message, MessageScroller } from "./message";

describe("MessageScroller PreviewRail", () => {
  it("stops following immediately when the reader scrolls upward, before a scroll event", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let notifyResize: (() => void) | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      let viewport: HTMLElement | null = null;
      render(<MessageScroller viewportRef={(node) => { viewport = node; }}>
        <Message from="assistant">Latest response</Message>
      </MessageScroller>);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
      if (!viewport) throw new Error("Expected a message viewport");
      const scrollTo = vi.fn();
      viewport.scrollTo = scrollTo;
      fireEvent.wheel(viewport, { deltaY: -120 });
      act(() => notifyResize?.());
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("does not auto-follow content changes while older history is loading", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let notifyResize: (() => void) | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    try {
      let viewport: HTMLElement | null = null;
      render(
        <MessageScroller
          pauseAutoFollow
          viewportRef={(node) => {
            viewport = node;
            if (node) {
              Object.defineProperty(node, "scrollHeight", { configurable: true, value: 480 });
              Object.defineProperty(node, "clientHeight", { configurable: true, value: 120 });
            }
          }}
        >
          <Message from="assistant">Existing response</Message>
        </MessageScroller>,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      if (!viewport) throw new Error("Expected a message viewport");
      const scrollTo = vi.fn();
      viewport.scrollTo = scrollTo;
      scrollTo.mockClear();

      act(() => notifyResize?.());
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("shows readable anchors after overflow and scrolls to the selected message", async () => {
    let viewport: HTMLElement | null = null;
    render(
      <MessageScroller
        navigation="rail"
        viewportRef={(node) => {
          viewport = node;
          if (node) {
            Object.defineProperty(node, "scrollHeight", { configurable: true, value: 480 });
            Object.defineProperty(node, "clientHeight", { configurable: true, value: 120 });
          }
        }}
      >
        <Message from="user">First request</Message>
        <Message from="assistant">First answer</Message>
        <Message from="user">Second request</Message>
        <Message from="assistant">Loading response</Message>
      </MessageScroller>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const rail = screen.getByRole("navigation", { name: "Message navigation" });
    const anchors = screen.getAllByRole("button", { name: /Go to/ });
    expect(rail).toBeInTheDocument();
    expect(anchors.length).toBe(2);
    expect(anchors[0]).toHaveAccessibleName("Go to user message 1 of 2");

    if (!viewport) throw new Error("Expected a message viewport");
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 0, writable: true });
    fireEvent.click(anchors[1]);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("keeps a single user anchor visible when the transcript overflows", async () => {
    let viewport: HTMLElement | null = null;
    render(
      <MessageScroller
        navigation="rail"
        viewportRef={(node) => {
          viewport = node;
          if (node) {
            Object.defineProperty(node, "scrollHeight", { configurable: true, value: 480 });
            Object.defineProperty(node, "clientHeight", { configurable: true, value: 120 });
          }
        }}
      >
        <Message from="user">Only request</Message>
        <Message from="assistant">A long running response</Message>
      </MessageScroller>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    if (!viewport) throw new Error("Expected a message viewport");
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 0, writable: true });
    const userMessage = screen.getByLabelText("user message");
    userMessage.getBoundingClientRect = () => ({
      x: 0,
      y: 240,
      top: 240,
      right: 100,
      bottom: 280,
      left: 0,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
    viewport.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 120,
      left: 0,
      width: 100,
      height: 120,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "Go to user message 1 of 1" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 200, behavior: "smooth" });
  });
});
