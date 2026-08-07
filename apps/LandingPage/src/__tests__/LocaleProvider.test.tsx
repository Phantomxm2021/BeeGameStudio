import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { LocaleProvider, useLocale } from "../i18n/LocaleProvider";

function Probe() {
  const { locale, setLocale, messages } = useLocale();

  return (
    <>
      <span>{locale}</span>
      <span>{messages.hero.title}</span>
      <button onClick={() => setLocale("ja")}>日本語</button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
  document.title = "";
  document.head
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", "");
  document.head
    .querySelector('meta[property="og:title"]')
    ?.setAttribute("content", "");
  document.head
    .querySelector('meta[property="og:description"]')
    ?.setAttribute("content", "");
});

test("changes locale, document metadata, and saved preference", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <Probe />
    </LocaleProvider>,
  );

  await user.click(screen.getByRole("button", { name: "日本語" }));

  expect(screen.getByText("ja")).toBeInTheDocument();
  expect(screen.getByText("アイデアを、ゲームへ。", { selector: "span" })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("ja");
  expect(document.title).toBe("Bee Game Studio — アイデアを、ゲームへ。");
  expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
    "content",
    "最初のひと言から、初めて遊ぶ瞬間まで。",
  );
  expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Bee Game Studio — アイデアを、ゲームへ。",
  );
  expect(document.head.querySelector('meta[property="og:description"]')).toHaveAttribute(
    "content",
    "つくりたいものを言葉にすると、Bee Game Studioが自分で遊べるゲームに変えます。",
  );
  expect(localStorage.getItem("bee-game-studio-locale")).toBe("ja");
});

test("falls back to English when browser locale APIs are unavailable", () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const windowStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

  Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
  Object.defineProperty(window, "localStorage", { configurable: true, value: undefined });

  try {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByText("en")).toBeInTheDocument();
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    if (windowStorageDescriptor) Object.defineProperty(window, "localStorage", windowStorageDescriptor);
  }
});

test("ignores storage access errors while keeping locale selection usable", () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const windowStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  const throwingStorage = {
    getItem: () => {
      throw new DOMException("storage disabled", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("storage disabled", "SecurityError");
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: throwingStorage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: throwingStorage,
  });

  try {
    expect(() =>
      render(
        <LocaleProvider>
          <Probe />
        </LocaleProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByText("en")).toBeInTheDocument();
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    if (windowStorageDescriptor) Object.defineProperty(window, "localStorage", windowStorageDescriptor);
  }
});
