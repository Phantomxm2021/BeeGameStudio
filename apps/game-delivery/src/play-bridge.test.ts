import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { playBridgeScript } from "./play-bridge.js";
function setup(referrer = "https://portal.test/g/one") {
  const listeners = new Map(),
    messages: unknown[] = [];
  const document = {
    referrer,
    visibilityState: "visible",
    addEventListener: (name: string, cb: unknown) => listeners.set(name, cb),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const parent = { postMessage: (...args: unknown[]) => messages.push(args) };
  runInNewContext(
    playBridgeScript("deploy_123", "https://portal.test").replace(
      /^<script>|<\/script>$/g,
      "",
    ),
    { document, window: { parent }, URL },
  );
  const fire = (type: string, extra = {}) =>
    listeners.get(type)?.({
      type,
      isTrusted: true,
      key: " ",
      button: 0,
      ...extra,
    });
  return { document, messages, fire, listeners };
}
describe("first game interaction bridge", () => {
  it("does not report loading, synthetic input, hidden input or navigation keys", () => {
    const s = setup();
    expect(s.messages).toHaveLength(0);
    s.fire("pointerdown", { isTrusted: false });
    s.fire("keydown", { key: "Tab" });
    s.fire("keydown", { ctrlKey: true });
    s.fire("pointerdown", { button: 2 });
    s.document.visibilityState = "hidden";
    s.fire("pointerdown");
    expect(s.messages).toHaveLength(0);
    s.document.visibilityState = "visible";
    s.fire("keydown", { key: "ArrowLeft" });
    s.fire("pointerdown");
    expect(s.messages).toEqual([
      [
        { type: "beegame:play", version: 1, deploymentId: "deploy_123" },
        "https://portal.test",
      ],
    ]);
    expect(s.listeners.size).toBe(0);
  });
  it("does not attach outside the configured portal", () => {
    expect(setup("https://evil.test/").listeners.size).toBe(0);
    expect(setup("").listeners.size).toBe(0);
  });
});
