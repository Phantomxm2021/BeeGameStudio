import { describe, expect, test } from "vitest";
import { detectLocale, normalizeLocale } from "../i18n/locale";

describe("normalizeLocale", () => {
  test.each([
    ["zh-CN", "zh-CN"],
    ["zh-TW", "zh-CN"],
    ["en-US", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    [" en-US ", "en"],
    ["ZH-tw", "zh-CN"],
    ["fr-FR", null],
    ["english", null],
    ["enoch", null],
    ["zhblah", null],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});

test("saved locale wins over browser preferences", () => {
  expect(detectLocale("ja", ["zh-CN", "en-US"])).toBe("ja");
});

test("uses the first supported browser preference", () => {
  expect(detectLocale(null, ["fr-FR", "ko-KR", "en-US"])).toBe("ko");
});

test("falls back to English", () => {
  expect(detectLocale(null, ["fr-FR"])).toBe("en");
});
