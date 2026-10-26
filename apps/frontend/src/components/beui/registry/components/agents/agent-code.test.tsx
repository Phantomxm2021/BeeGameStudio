import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentCode } from "./agent-code";

const tokenize = vi.hoisted(() => vi.fn((code: string) => [[{
  content: code, offset: 0, variants: { light: { color: "black" }, dark: { color: "white" } },
}]]));
vi.mock("shiki", () => ({ createHighlighter: async () => ({ codeToTokensWithThemes: tokenize }) }));
beforeEach(() => tokenize.mockClear());

it("keeps full plain and large output in one text node without tokenizing", async () => {
  const output = "literal <tag> output\n".repeat(10_000) + "LAST-LINE";
  const { container, rerender } = render(<AgentCode language="text" code={output} />);
  await act(async () => {});
  expect(container.querySelector("code")?.textContent).toBe(output);
  expect(container.querySelector("code")?.childElementCount).toBe(0);
  rerender(<AgentCode language="bash" code={output} />);
  await act(async () => {});
  expect(container.querySelector("code")?.textContent).toBe(output);
  expect(container.querySelector("code")?.childElementCount).toBe(0);
  expect(tokenize).not.toHaveBeenCalled();
});

it("shows an appended partial line immediately and highlights small code", async () => {
  const { container, rerender } = render(<AgentCode language="bash" code="echo start" />);
  await waitFor(() => expect(container.querySelector("code span span")).not.toBeNull());
  rerender(<AgentCode language="bash" code="echo start --new-tail" />);
  expect(container.querySelector("code")?.textContent).toBe("echo start --new-tail");
  await waitFor(() => expect(tokenize).toHaveBeenLastCalledWith("echo start --new-tail", expect.anything()));
});

it("releases tokenized versions when the block unmounts", async () => {
  const first = render(<AgentCode language="bash" code="echo history" />);
  await waitFor(() => expect(tokenize).toHaveBeenCalledTimes(1));
  first.unmount();
  render(<AgentCode language="bash" code="echo history" />);
  await waitFor(() => expect(tokenize).toHaveBeenCalledTimes(2));
});
