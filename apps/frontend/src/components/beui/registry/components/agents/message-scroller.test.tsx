import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Message, MessageScroller } from "./message";

describe("MessageScroller PreviewRail", () => {
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
    fireEvent.click(anchors[1]);
    expect(scrollTo).toHaveBeenCalled();
  });
});
