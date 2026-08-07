import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import App from "../App";
import { LocaleProvider } from "../i18n/LocaleProvider";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("bee-game-studio-locale", "zh-CN");
});

test("renders the localized narrative with Chinese headings and a waitlist CTA", () => {
  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  expect(screen.getByRole("link", { name: "Bee Game Studio" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "把想法，做成游戏。" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /你不是没有能力/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "听懂想法" })).toBeInTheDocument();
  expect(document.querySelector(".process-frame.is-active")).toHaveTextContent("我想做一款关于深夜便利店的游戏。");
  expect(screen.getByRole("heading", { name: /不只是想象/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /制作可以交给 AI/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /每个人都应该有机会/ })).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "加入优先体验名单" })).toBeInTheDocument();
  expect(screen.getByText("© 2026")).toBeInTheDocument();
  expect(screen.getAllByRole("navigation", { name: "主要导航" })).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "选择语言" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "加入优先体验名单" })).toHaveLength(2);
  for (const link of screen.getAllByRole("link", { name: "加入优先体验名单" })) {
    expect(link).toHaveAttribute("href", "#waitlist");
  }
});

test("exposes the narrative anchors and translated navigation links", () => {
  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  for (const id of ["top", "story", "belief", "waitlist"]) {
    expect(document.getElementById(id)).toBeInTheDocument();
  }

  for (const [name, href] of [
    ["产品", "#story"],
    ["我们相信", "#belief"],
  ] as const) {
    for (const link of screen.getAllByRole("link", { name })) {
      expect(link).toHaveAttribute("href", href);
    }
  }
});

test("reveals the playable game image at the final creation stage", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  const images = screen.getAllByRole("img");
  expect(images).toHaveLength(1);
  expect(images[0]).toHaveAttribute("src", "/images/game/hero-game-native-v1.png");

  await user.click(screen.getByRole("tab", { name: "亲自试玩" }));
  expect(screen.getByRole("img", { name: "雨夜里亮着暖光的微缩便利店游戏场景" }))
    .toHaveAttribute("src", "/images/game/store-choice-v1.png");
});

test("explains the AI work as a visible creative transformation", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  await user.click(screen.getByRole("tab", { name: "找到感觉" }));
  expect(document.querySelector(".process-frame.is-active")).toHaveTextContent("雨夜、暖光、沉默的客人，成为这款游戏的感觉。");

  await user.click(screen.getByRole("tab", { name: "让场景成形" }));
  expect(document.querySelector(".process-frame.is-active")).toHaveTextContent("便利店、角色和选择，逐渐变成你想要的样子。");
});

test("tracks pointer position for the page light and cursor effects", () => {
  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  const page = document.querySelector(".site-page");
  expect(page).toBeInTheDocument();

  Object.defineProperty(window, "innerWidth", { configurable: true, value: 960 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
  fireEvent.pointerMove(page!, { clientX: 240, clientY: 160 });

  expect(page).toHaveStyle({
    "--pointer-x": "240px",
    "--pointer-y": "160px",
    "--parallax-x": "-0.500",
    "--parallax-y": "-0.500",
    "--pointer-opacity": "1",
  });
});

test("keeps every creation stage mounted for a shared crossfade", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  const frames = document.querySelectorAll(".process-frame");
  expect(frames).toHaveLength(4);
  expect(document.querySelector(".process-frame--idea")).toHaveClass("is-active");

  await user.click(screen.getByRole("tab", { name: "让场景成形" }));
  expect(document.querySelector(".process-frame--build")).toHaveClass("is-active");
  expect(document.querySelector(".process-frame--idea")).not.toHaveClass("is-active");
});

test("pauses creation stages while the visual canvas is being explored", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  const visual = document.querySelector(".process-visual");
  expect(visual).toHaveAttribute("data-process-paused", "false");

  await user.hover(visual!);
  expect(visual).toHaveAttribute("data-process-paused", "true");

  await user.unhover(visual!);
  expect(visual).toHaveAttribute("data-process-paused", "false");
});

test("presents the creation journey as a scroll-driven story", () => {
  render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );

  const process = document.querySelector(".process");
  expect(process).toHaveAttribute("data-scroll-story", "true");
  expect(document.querySelectorAll(".process-beat")).toHaveLength(4);
  expect(document.querySelector(".process-beat.is-active")).toHaveTextContent("我想做一款关于深夜便利店的游戏。");
});
