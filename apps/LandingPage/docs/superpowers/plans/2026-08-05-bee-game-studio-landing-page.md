# Bee Game Studio Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零构建一个支持中、英、日、韩四种语言并能向 Supabase 写入候补名单的 Bee Game Studio 产品展示落地页。

**Architecture:** 使用 Vite、React 和 TypeScript 构建单页应用。页面文案放在强类型本地字典中，由轻量 `LocaleProvider` 负责浏览器语言检测、用户偏好持久化和 `<html lang>` 同步；候补名单通过独立 Supabase 客户端与服务模块写入，展示组件不直接依赖数据库实现。

**Tech Stack:** Vite 8、React 19、TypeScript 5、Supabase JS、Vitest、Testing Library、CSS、Supabase PostgreSQL/RLS

---

## 文件结构

```text
LandingPage/
├── index.html                         # 默认元数据和 React 挂载点
├── package.json                       # 构建、测试与依赖
├── vite.config.ts                     # React 与 Vitest 配置
├── .env.example                       # Supabase 公共环境变量示例
├── public/
│   ├── favicon.svg
│   ├── og.png
│   └── images/
│       ├── idea-becomes-playable.webp # 首屏主视觉
│       └── night-store.webp           # 深夜便利店叙事图
├── src/
│   ├── main.tsx                       # 应用入口
│   ├── App.tsx                        # 页面区块编排
│   ├── styles.css                     # 全局视觉、排版与响应式规则
│   ├── i18n/
│   │   ├── types.ts                   # Locale 与文案类型
│   │   ├── messages.ts                # 四语人工文案
│   │   ├── locale.ts                  # 检测、规范化与持久化函数
│   │   └── LocaleProvider.tsx         # React 上下文
│   ├── components/
│   │   ├── Header.tsx                 # 导航与语言选择器
│   │   ├── LanguageSelector.tsx       # 可访问语言菜单
│   │   ├── NarrativeSections.tsx      # 场景式页面叙事
│   │   └── WaitlistForm.tsx           # 候补名单表单与状态
│   ├── lib/
│   │   ├── supabase.ts                # 可选 Supabase 客户端初始化
│   │   └── waitlist.ts                # 写入接口、校验与错误映射
│   ├── test/
│   │   └── setup.ts                   # Testing Library 配置
│   └── __tests__/
│       ├── locale.test.ts
│       ├── LocaleProvider.test.tsx
│       ├── LanguageSelector.test.tsx
│       ├── App.test.tsx
│       └── WaitlistForm.test.tsx
└── supabase/
    └── waitlist.sql                    # 表、索引、约束与 RLS
```

### Task 1: 清理旧实现并建立可测试的 Vite 基线

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `index.html`
- Create: `.env.example`
- Create: `src/test/setup.ts`
- Delete: `src/App.tsx`
- Delete: `src/index.css`

- [ ] **Step 1: 安装运行时和测试依赖**

Run:

```bash
npm install @supabase/supabase-js
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: `package.json` 和 `package-lock.json` 更新，命令退出码为 0。

- [ ] **Step 2: 配置测试命令和 jsdom**

将 `package.json` 的 scripts 设为：

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

将 `vite.config.ts` 设为：

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { watch: { usePolling: true } },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
```

创建 `src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: 写最小入口测试并确认失败**

创建临时 `src/__tests__/App.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import App from "../App";

test("renders the Bee Game Studio brand", () => {
  render(<App />);
  expect(screen.getByText("Bee Game Studio")).toBeInTheDocument();
});
```

Run: `npm test -- src/__tests__/App.test.tsx`

Expected: FAIL，因为从零重建后 `src/App.tsx` 尚不存在。

- [ ] **Step 4: 创建最小应用使测试通过**

创建 `src/App.tsx`：

```tsx
export default function App() {
  return <main>Bee Game Studio</main>;
}
```

更新 `src/main.tsx`：

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

创建空的 `src/styles.css`，并将 `.env.example` 设为：

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 5: 运行测试和构建**

Run: `npm test -- src/__tests__/App.test.tsx && npm run build`

Expected: 1 test PASS；TypeScript 与 Vite 构建成功。

- [ ] **Step 6: 提交基线**

```bash
git add package.json package-lock.json vite.config.ts index.html .env.example src
git commit -m "chore: rebuild Vite React baseline"
```

### Task 2: 实现浏览器语言检测与持久化

**Files:**
- Create: `src/i18n/types.ts`
- Create: `src/i18n/locale.ts`
- Test: `src/__tests__/locale.test.ts`

- [ ] **Step 1: 写语言匹配失败测试**

创建 `src/__tests__/locale.test.ts`：

```ts
import { describe, expect, test } from "vitest";
import { detectLocale, normalizeLocale } from "../i18n/locale";

describe("normalizeLocale", () => {
  test.each([
    ["zh-CN", "zh-CN"],
    ["zh-TW", "zh-CN"],
    ["en-US", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["fr-FR", null],
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/__tests__/locale.test.ts`

Expected: FAIL，`../i18n/locale` 不存在。

- [ ] **Step 3: 实现类型和纯函数**

创建 `src/i18n/types.ts`：

```ts
export const supportedLocales = ["zh-CN", "en", "ja", "ko"] as const;
export type Locale = (typeof supportedLocales)[number];
```

创建 `src/i18n/locale.ts`：

```ts
import type { Locale } from "./types";

export const LOCALE_STORAGE_KEY = "bee-game-studio-locale";

export function normalizeLocale(value: string | null): Locale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  return null;
}

export function detectLocale(saved: string | null, browserLocales: readonly string[]): Locale {
  const savedLocale = normalizeLocale(saved);
  if (savedLocale) return savedLocale;
  for (const locale of browserLocales) {
    const supported = normalizeLocale(locale);
    if (supported) return supported;
  }
  return "en";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/__tests__/locale.test.ts`

Expected: 9 tests PASS。

- [ ] **Step 5: 提交语言核心**

```bash
git add src/i18n src/__tests__/locale.test.ts
git commit -m "feat: add locale detection"
```

### Task 3: 添加四语文案与 LocaleProvider

**Files:**
- Modify: `src/i18n/types.ts`
- Create: `src/i18n/messages.ts`
- Create: `src/i18n/LocaleProvider.tsx`
- Test: `src/__tests__/LocaleProvider.test.tsx`

- [ ] **Step 1: 写 Provider 行为测试**

创建 `src/__tests__/LocaleProvider.test.tsx`：

```tsx
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

beforeEach(() => localStorage.clear());

test("changes locale, document language, and saved preference", async () => {
  render(<LocaleProvider><Probe /></LocaleProvider>);
  await userEvent.click(screen.getByRole("button", { name: "日本語" }));
  expect(screen.getByText("ja")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("ja");
  expect(localStorage.getItem("bee-game-studio-locale")).toBe("ja");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/__tests__/LocaleProvider.test.tsx`

Expected: FAIL，Provider 不存在。

- [ ] **Step 3: 定义完整文案接口**

向 `src/i18n/types.ts` 添加：

```ts
export type Messages = {
  meta: { title: string; description: string };
  nav: { story: string; belief: string; join: string; language: string };
  hero: { title: string; body: string; note: string; continue: string; imageAlt: string };
  manifesto: { eyebrow: string; title: string; muted: string; body: string[] };
  moment: { quote: string; detail: string; body: string; conclusion: string[]; imageAlt: string };
  change: { title: string[]; edits: string[]; body: string };
  ownership: {
    eyebrow: string;
    title: string[];
    stages: Array<{ time: string; title: string; body: string }>;
  };
  vision: { eyebrow: string; title: string[]; emphasis: string; body: string[] };
  waitlist: {
    title: string[];
    body: string;
    name: string;
    email: string;
    persona: string;
    personas: Record<"idea" | "creator" | "investor", string>;
    submit: string;
    submitting: string;
    success: string;
    duplicate: string;
    error: string;
    privacy: string;
  };
};
```

- [ ] **Step 4: 创建四语人工字典**

在 `src/i18n/messages.ts` 中导出：

```ts
import type { Locale, Messages } from "./types";

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export const messages: Record<Locale, Messages> = {
  "zh-CN": {
    meta: { title: "Bee Game Studio — 让想象，真正发生。", description: "从一个念头，到一款可以亲手体验、继续改变的游戏。" },
    nav: { story: "创作方式", belief: "我们相信", join: "加入候补名单", language: "选择语言" },
    hero: { title: "让想象，真正发生。", body: "从一个念头，到一款可以亲手体验、继续改变的游戏。Bee Game Studio，让更多人参与游戏创作。", note: "不是从一张功能清单开始，而是从你最想亲手体验的那一刻开始。", continue: "继续了解", imageAlt: "纸上的便利店草图逐渐成为可以进入的游戏场景" },
    manifesto: { eyebrow: "一个一直存在的遗憾", title: "每个人心里，", muted: "都有一款还没被做出来的游戏。", body: ["也许它是一段你反复想象的冒险，一个只想和朋友一起探索的地方，或是一种从未有人做过的玩法。", "过去，只有掌握完整制作流程的人，才能让这些想法真正发生。Bee Game Studio 想改变这件事。"] },
    moment: { quote: "我想做一款关于深夜便利店的游戏。", detail: "每位客人带来的，都不只是一个订单。", body: "不必先想清楚一切。Bee Game Studio 理解你想要的氛围、人物和体验，陪你把这个念头慢慢展开。", conclusion: ["很快，你不再只是描述它。", "你开始亲手体验它。"], imageAlt: "雨夜里亮着暖光的微缩便利店游戏场景" },
    change: { title: ["玩过之后，", "你会知道它还可以怎样。"], edits: ["让雨下得更久一点。", "让那位沉默的客人，在第三次见面时说出秘密。", "让每个选择，都在故事里留下痕迹。"], body: "说出刚刚玩到的感受，继续完成它。游戏一边被体验，一边成为你真正想要的样子。" },
    ownership: { eyebrow: "从灵感到作品", title: ["一次灵感，", "不该止于一次惊喜。"], stages: [{ time: "今天", title: "亲手玩到第一个版本", body: "感受玩法是否成立。" }, { time: "接下来", title: "加入新的角色与故事", body: "让作品继续生长。" }, { time: "然后", title: "邀请朋友一起试玩", body: "听见真实的笑声与抱怨。" }, { time: "准备好时", title: "把它带给更多玩家", body: "这始终是你的游戏。" }] },
    vision: { eyebrow: "我们相信", title: ["创作游戏，", "不该只是少数人的"], emphasis: "特权。", body: ["当想法、体验与改变可以发生在同一个过程里，更多人将有机会创造自己真正想玩的游戏。", "这不是更快地使用旧工具，而是一种全新的游戏创作方式。"] },
    waitlist: { title: ["你的游戏，", "会从哪里开始？"], body: "Bee Game Studio 仍在准备中。加入候补名单，在开放体验时第一时间收到邀请。", name: "怎么称呼你", email: "你的邮箱", persona: "选择你的身份", personas: { idea: "我有一个游戏想法", creator: "我是独立游戏创作者", investor: "我是投资人或合作伙伴" }, submit: "加入候补名单", submitting: "正在提交…", success: "已经记下你的名字，开放体验时见。", duplicate: "这个邮箱已经在候补名单中。", error: "暂时无法提交，请稍后再试。", privacy: "我们只会发送与 Bee Game Studio 体验邀请有关的消息。" },
  },
  en: {
    meta: { title: "Bee Game Studio — Make imagination real.", description: "Turn one idea into a game you can experience, shape, and call your own." },
    nav: { story: "How creation changes", belief: "What we believe", join: "Join the waitlist", language: "Choose language" },
    hero: { title: "Make imagination real.", body: "From a passing thought to a game you can experience and keep shaping. Bee Game Studio opens game creation to more people.", note: "It does not begin with a feature list. It begins with the moment you most want to experience.", continue: "Discover more", imageAlt: "A convenience-store sketch on paper becoming a playable miniature scene" },
    manifesto: { eyebrow: "An idea that has waited long enough", title: "Everyone carries", muted: "a game that has never been made.", body: ["It may be an adventure you return to in your imagination, a place you only want to explore with friends, or a kind of play no one has tried before.", "Until now, bringing those ideas to life meant mastering an entire production process. Bee Game Studio is here to change that."] },
    moment: { quote: "I want to make a game about a late-night convenience store.", detail: "Every customer arrives with more than an order.", body: "You do not need every answer before you begin. Bee Game Studio understands the atmosphere, characters, and experience you are reaching for, then helps the idea unfold.", conclusion: ["Soon, you are no longer describing it.", "You are experiencing it."], imageAlt: "A miniature late-night convenience store glowing warmly in the rain" },
    change: { title: ["Once you play it,", "you know what it could become."], edits: ["Let the rain linger a little longer.", "Let the quiet customer reveal the secret on the third visit.", "Let every choice leave a trace in the story."], body: "Share what you felt while playing, then keep creating. The game takes shape as you experience it." },
    ownership: { eyebrow: "From inspiration to a finished work", title: ["A spark of inspiration", "should become more than a moment of surprise."], stages: [{ time: "Today", title: "Play the first version", body: "Feel whether the idea works." }, { time: "Next", title: "Add characters and stories", body: "Let the work keep growing." }, { time: "Then", title: "Invite friends to play", body: "Hear the laughter and the honest complaints." }, { time: "When it is ready", title: "Bring it to more players", body: "It remains your game." }] },
    vision: { eyebrow: "What we believe", title: ["Creating games", "should not be a privilege for"], emphasis: "the few.", body: ["When ideas, experience, and change can happen in one continuous process, more people can create the games they truly want to play.", "This is not a faster version of an old tool. It is a new way to create games."] },
    waitlist: { title: ["Where will", "your game begin?"], body: "Bee Game Studio is getting ready. Join the waitlist and be among the first invited to experience it.", name: "Your name", email: "Your email", persona: "Choose what describes you", personas: { idea: "I have an idea for a game", creator: "I am an independent game creator", investor: "I am an investor or partner" }, submit: "Join the waitlist", submitting: "Joining…", success: "You are on the list. See you when early access opens.", duplicate: "This email is already on the waitlist.", error: "We could not submit this right now. Please try again.", privacy: "We will only send messages related to Bee Game Studio early access." },
  },
  ja: {
    meta: { title: "Bee Game Studio — 想像を、現実に。", description: "ひとつのアイデアから、実際に遊び、育て続けられるゲームへ。" },
    nav: { story: "新しいつくり方", belief: "私たちの考え", join: "ウェイトリストに登録", language: "言語を選択" },
    hero: { title: "想像を、現実に。", body: "ひとつのアイデアから、実際に遊び、変え続けられるゲームへ。Bee Game Studioは、ゲームづくりをもっと多くの人へ開いていきます。", note: "機能の一覧から始めるのではなく、あなたがいちばん体験したい瞬間から始めます。", continue: "続きを見る", imageAlt: "紙に描かれたコンビニのスケッチが、遊べるミニチュアの場面へ変わっていく様子" },
    manifesto: { eyebrow: "ずっと残されてきた心残り", title: "誰の心にも、", muted: "まだつくられていないゲームがある。", body: ["何度も思い描いた冒険かもしれない。友人とだけ旅したい場所かもしれない。まだ誰も試したことのない遊びかもしれない。", "これまでは、制作のすべてを身につけた人だけが、その想像を形にできました。Bee Game Studioは、それを変えようとしています。"] },
    moment: { quote: "深夜のコンビニを舞台にしたゲームをつくりたい。", detail: "訪れる客が持ってくるのは、注文だけではない。", body: "最初からすべてを決める必要はありません。Bee Game Studioが、求めている空気や人物、体験を理解し、アイデアを少しずつ広げていきます。", conclusion: ["やがて、説明するだけではなくなる。", "自分の手で体験し始める。"], imageAlt: "雨の夜に暖かな光を灯すミニチュアのコンビニゲーム場面" },
    change: { title: ["遊んでみれば、", "次にどうしたいかが見えてくる。"], edits: ["雨を、もう少し長く降らせたい。", "無口な客が、三度目に秘密を話すようにしたい。", "どの選択も、物語に痕跡を残すようにしたい。"], body: "遊んで感じたことを伝え、そのままつくり続ける。ゲームは、体験されながら本当に望んだ姿へ近づいていきます。" },
    ownership: { eyebrow: "ひらめきから作品へ", title: ["ひとつのひらめきを、", "一度きりの驚きで終わらせない。"], stages: [{ time: "今日", title: "最初のかたちを遊ぶ", body: "遊びが成立するかを確かめる。" }, { time: "その次に", title: "人物と物語を加える", body: "作品を育て続ける。" }, { time: "そして", title: "友人に遊んでもらう", body: "笑い声も率直な不満も聞く。" }, { time: "準備ができたら", title: "もっと多くの人へ届ける", body: "ずっと、あなたのゲームです。" }] },
    vision: { eyebrow: "私たちが信じること", title: ["ゲームをつくることは、", "一部の人だけに許された"], emphasis: "特権ではない。", body: ["アイデアと体験と変化がひとつながりになれば、もっと多くの人が、本当に遊びたいゲームをつくれるようになります。", "古い道具を少し速くするのではなく、ゲームづくりそのものを新しくする。"] },
    waitlist: { title: ["あなたのゲームは、", "どこから始まりますか？"], body: "Bee Game Studioは公開に向けて準備中です。ウェイトリストに登録すると、体験開始時にいち早くご案内します。", name: "お名前", email: "メールアドレス", persona: "あなたに近いものを選択", personas: { idea: "ゲームのアイデアがある", creator: "インディーゲーム制作者", investor: "投資家・パートナー" }, submit: "ウェイトリストに登録", submitting: "登録中…", success: "登録しました。体験開始のご案内をお待ちください。", duplicate: "このメールアドレスはすでに登録されています。", error: "現在登録できません。時間をおいてもう一度お試しください。", privacy: "Bee Game Studioの体験案内に関するメールのみお送りします。" },
  },
  ko: {
    meta: { title: "Bee Game Studio — 상상을, 현실로.", description: "하나의 아이디어를 직접 플레이하고 계속 다듬을 수 있는 게임으로 만드세요." },
    nav: { story: "새로운 창작 방식", belief: "우리가 믿는 것", join: "대기 명단 등록", language: "언어 선택" },
    hero: { title: "상상을, 현실로.", body: "하나의 생각에서 직접 경험하고 계속 바꿔 갈 수 있는 게임까지. Bee Game Studio는 더 많은 사람에게 게임 창작의 문을 엽니다.", note: "기능 목록이 아니라, 가장 직접 경험하고 싶은 순간에서 시작합니다.", continue: "더 알아보기", imageAlt: "종이 위 편의점 스케치가 플레이할 수 있는 미니어처 장면으로 변하는 모습" },
    manifesto: { eyebrow: "오랫동안 남아 있던 아쉬움", title: "누구에게나 마음속에는", muted: "아직 만들어지지 않은 게임이 있습니다.", body: ["몇 번이고 상상했던 모험일 수도 있고, 친구와 함께 탐험하고 싶은 장소일 수도 있으며, 아무도 시도하지 않은 새로운 놀이일 수도 있습니다.", "지금까지는 제작 전 과정을 익힌 사람만 그런 상상을 현실로 만들 수 있었습니다. Bee Game Studio는 그것을 바꾸려 합니다."] },
    moment: { quote: "심야 편의점을 배경으로 한 게임을 만들고 싶어요.", detail: "손님이 들고 오는 것은 주문만이 아닙니다.", body: "처음부터 모든 것을 정할 필요는 없습니다. Bee Game Studio가 원하는 분위기와 인물, 경험을 이해하고 아이디어가 자연스럽게 펼쳐지도록 돕습니다.", conclusion: ["곧, 설명만 하고 있지 않게 됩니다.", "직접 그 순간을 경험하게 됩니다."], imageAlt: "비 내리는 밤 따뜻한 불빛이 켜진 미니어처 편의점 게임 장면" },
    change: { title: ["플레이하고 나면,", "다음에 무엇을 바꿀지 알게 됩니다."], edits: ["비가 조금 더 오래 내리게 해 주세요.", "말이 없던 손님이 세 번째 만남에서 비밀을 털어놓게 해 주세요.", "모든 선택이 이야기에 흔적을 남기게 해 주세요."], body: "방금 플레이하며 느낀 점을 말하고 계속 만들어 가세요. 게임은 경험되는 동안 진정으로 원하던 모습에 가까워집니다." },
    ownership: { eyebrow: "영감에서 작품으로", title: ["하나의 영감이", "한 번의 놀라움으로 끝나서는 안 됩니다."], stages: [{ time: "오늘", title: "첫 번째 버전을 플레이합니다", body: "아이디어가 재미로 이어지는지 느껴 봅니다." }, { time: "다음", title: "새로운 인물과 이야기를 더합니다", body: "작품을 계속 성장시킵니다." }, { time: "그리고", title: "친구를 초대해 함께 플레이합니다", body: "웃음과 솔직한 불만을 들어 봅니다." }, { time: "준비가 되면", title: "더 많은 플레이어에게 선보입니다", body: "언제나 당신의 게임입니다." }] },
    vision: { eyebrow: "우리가 믿는 것", title: ["게임을 만드는 일은", "소수만 누리는"], emphasis: "특권이어서는 안 됩니다.", body: ["아이디어와 경험, 변화가 하나의 과정 안에서 이어진다면 더 많은 사람이 정말 플레이하고 싶은 게임을 만들 수 있습니다.", "기존 도구를 더 빠르게 쓰는 것이 아니라, 게임을 만드는 완전히 새로운 방식입니다."] },
    waitlist: { title: ["당신의 게임은", "어디에서 시작될까요?"], body: "Bee Game Studio는 공개를 준비하고 있습니다. 대기 명단에 등록하면 체험이 시작될 때 가장 먼저 알려 드립니다.", name: "이름", email: "이메일", persona: "해당하는 항목을 선택하세요", personas: { idea: "게임 아이디어가 있습니다", creator: "인디 게임 제작자입니다", investor: "투자자 또는 파트너입니다" }, submit: "대기 명단 등록", submitting: "등록 중…", success: "등록되었습니다. 체험이 시작될 때 알려 드리겠습니다.", duplicate: "이미 대기 명단에 등록된 이메일입니다.", error: "지금은 등록할 수 없습니다. 잠시 후 다시 시도해 주세요.", privacy: "Bee Game Studio 체험 안내와 관련된 메시지만 보내 드립니다." },
  },
};
```

- [ ] **Step 5: 实现 LocaleProvider**

创建 `src/i18n/LocaleProvider.tsx`：

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectLocale, LOCALE_STORAGE_KEY } from "./locale";
import { messages } from "./messages";
import type { Locale } from "./types";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: (typeof messages)[Locale];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => detectLocale(
    localStorage.getItem(LOCALE_STORAGE_KEY),
    navigator.languages,
  ));

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, messages: messages[locale] }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
```

在 `src/main.tsx` 中用 `<LocaleProvider>` 包裹 `<App />`。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- src/__tests__/locale.test.ts src/__tests__/LocaleProvider.test.tsx`

Expected: PASS。

```bash
git add src/i18n src/main.tsx src/__tests__
git commit -m "feat: add four-language content"
```

### Task 4: 实现语言选择器和页面导航

**Files:**
- Create: `src/components/LanguageSelector.tsx`
- Create: `src/components/Header.tsx`
- Test: `src/__tests__/LanguageSelector.test.tsx`

- [ ] **Step 1: 写选择器交互测试**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { LanguageSelector } from "../components/LanguageSelector";

test("shows all locales and changes the active language", async () => {
  render(<LocaleProvider><LanguageSelector /></LocaleProvider>);
  expect(screen.getByRole("option", { name: "日本語" })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /选择语言|language/i }), "ja");
  expect(document.documentElement.lang).toBe("ja");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/__tests__/LanguageSelector.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现原生可访问选择器**

```tsx
import { localeLabels } from "../i18n/messages";
import { supportedLocales, type Locale } from "../i18n/types";
import { useLocale } from "../i18n/LocaleProvider";

export function LanguageSelector() {
  const { locale, setLocale, messages } = useLocale();
  return (
    <label className="language-selector">
      <span className="sr-only">{messages.nav.language}</span>
      <select
        aria-label={messages.nav.language}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {supportedLocales.map((value) => (
          <option key={value} value={value}>{localeLabels[value]}</option>
        ))}
      </select>
    </label>
  );
}
```

`Header.tsx` 只包含品牌名、两个锚点、`LanguageSelector` 和候补名单按钮。移动端隐藏次要锚点，但保留语言选择器和主按钮。

- [ ] **Step 4: 运行测试并提交**

Run: `npm test -- src/__tests__/LanguageSelector.test.tsx`

Expected: PASS。

```bash
git add src/components/Header.tsx src/components/LanguageSelector.tsx src/__tests__/LanguageSelector.test.tsx
git commit -m "feat: add language selector"
```

### Task 5: 实现场景式长页和各语言排版系统

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/NarrativeSections.tsx`
- Create: `src/styles.css`
- Test: `src/__tests__/App.test.tsx`

- [ ] **Step 1: 用四语页面测试替换最小测试**

```tsx
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "../i18n/LocaleProvider";
import App from "../App";

test("renders the complete Chinese narrative", () => {
  localStorage.setItem("bee-game-studio-locale", "zh-CN");
  render(<LocaleProvider><App /></LocaleProvider>);
  expect(screen.getByRole("heading", { name: "让想象，真正发生。" })).toBeInTheDocument();
  expect(screen.getByText("每个人心里，")).toBeInTheDocument();
  expect(screen.getByText("一次灵感，")).toBeInTheDocument();
  expect(screen.getByText("创作游戏，")).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "加入候补名单" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/__tests__/App.test.tsx`

Expected: FAIL，完整页面尚未渲染。

- [ ] **Step 3: 实现组件边界**

`App.tsx`：

```tsx
import { Header } from "./components/Header";
import { NarrativeSections } from "./components/NarrativeSections";
import { WaitlistForm } from "./components/WaitlistForm";

export default function App() {
  return (
    <>
      <Header />
      <main>
        <NarrativeSections />
        <WaitlistForm />
      </main>
    </>
  );
}
```

`NarrativeSections.tsx` 从 `useLocale()` 读取文案，依次渲染 `hero`、`manifesto`、`moment`、`change`、`ownership` 和 `vision` 六个语义化 `<section>`。数组标题的每一项渲染为 `<span className="semantic-line">`，不要在翻译字符串内嵌 `<br>`。

- [ ] **Step 4: 建立语言感知排版 CSS**

`styles.css` 至少包含：

```css
:root {
  --black: #090908;
  --paper: #f3f0e8;
  --ink: #171713;
  --ember: #e9a52b;
  --green: #183226;
}

html { scroll-behavior: smooth; }
body { margin: 0; background: var(--black); color: #f6f3ec; }

html[lang="zh-CN"] body {
  font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  line-break: strict;
  word-break: normal;
  text-autospace: ideograph-alpha ideograph-numeric;
}

html[lang="en"] body {
  font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  line-break: auto;
}

html[lang="ja"] body {
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif;
  line-break: strict;
  word-break: normal;
}

html[lang="ko"] body {
  font-family: "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  line-break: keep-all;
  word-break: keep-all;
}

.display-heading { letter-spacing: 0; text-wrap: balance; }
html[lang="en"] .display-heading { letter-spacing: -0.045em; }
.body-copy { max-width: 30em; line-height: 1.9; text-wrap: pretty; }
.semantic-line { display: block; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
```

将确认视觉稿中的黑色摄影首屏、暖白宣言、雨夜便利店、浅绿试玩变化、暖白成长过程、深色愿景和暖白候补名单转写为响应式 CSS。禁止新增功能卡片和通用 AI 装饰。

- [ ] **Step 5: 运行测试和构建**

Run: `npm test -- src/__tests__/App.test.tsx && npm run build`

Expected: PASS；无 TypeScript 或 CSS 构建错误。

- [ ] **Step 6: 提交页面结构**

```bash
git add src/App.tsx src/components/NarrativeSections.tsx src/styles.css src/__tests__/App.test.tsx
git commit -m "feat: build localized narrative landing page"
```

### Task 6: 生成并接入统一叙事插图

**Files:**
- Create: `public/images/idea-becomes-playable.webp`
- Create: `public/images/night-store.webp`
- Modify: `src/components/NarrativeSections.tsx`

- [ ] **Step 1: 生成首屏图像**

使用已确认提示方向：象牙色纸张位于安静的黑色工作台上，铅笔草图逐渐成为雨夜便利店微缩游戏场景；右侧集中主体，左侧保留中文标题负空间；编辑摄影与手工微缩模型质感；禁止文字、Logo、UI、蜂巢、霓虹、粒子和通用 AI 元素。

将最终图像保存为 `public/images/idea-becomes-playable.webp`。

- [ ] **Step 2: 生成叙事章节图像**

生成同一便利店场景的近景：雨夜、暖窗、一个微缩访客、铅笔线条仍在场景边缘可见，保持同一镜头语言与材质。将最终图像保存为 `public/images/night-store.webp`。

- [ ] **Step 3: 在页面中使用响应式图片**

```tsx
<img
  className="hero-image"
  src="/images/idea-becomes-playable.webp"
  alt={messages.hero.imageAlt}
  width="1728"
  height="912"
  fetchPriority="high"
/>
```

第二张图片读取 `messages.moment.imageAlt`，并使用 `loading="lazy"`。

- [ ] **Step 4: 检查文件尺寸与构建**

Run: `ls -lh public/images && npm run build`

Expected: 每张 WebP 小于 500 KB；构建成功。

- [ ] **Step 5: 提交图像**

```bash
git add public/images src/components/NarrativeSections.tsx src/i18n
git commit -m "feat: add narrative imagery"
```

### Task 7: 实现 Supabase 候补名单服务和表单

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/lib/waitlist.ts`
- Create: `src/components/WaitlistForm.tsx`
- Test: `src/__tests__/WaitlistForm.test.tsx`

- [ ] **Step 1: 写表单成功、重复和校验测试**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { WaitlistForm } from "../components/WaitlistForm";

const { joinWaitlistMock } = vi.hoisted(() => ({ joinWaitlistMock: vi.fn() }));
vi.mock("../lib/waitlist", () => ({ joinWaitlist: joinWaitlistMock }));

test("submits normalized waitlist data", async () => {
  joinWaitlistMock.mockResolvedValue({ status: "success" });
  render(<LocaleProvider><WaitlistForm /></LocaleProvider>);
  await userEvent.type(screen.getByLabelText("怎么称呼你"), "小林");
  await userEvent.type(screen.getByLabelText("你的邮箱"), " HELLO@EXAMPLE.COM ");
  await userEvent.selectOptions(screen.getByLabelText("选择你的身份"), "creator");
  await userEvent.click(screen.getByRole("button", { name: "加入候补名单" }));
  expect(joinWaitlistMock).toHaveBeenCalledWith({ name: "小林", email: "hello@example.com", persona: "creator", locale: "zh-CN", source: "landing-page" });
  expect(await screen.findByRole("status")).toHaveTextContent("已经记下你的名字");
});

test("uses native validation for an invalid email", async () => {
  render(<LocaleProvider><WaitlistForm /></LocaleProvider>);
  expect(screen.getByLabelText("你的邮箱")).toHaveAttribute("type", "email");
  expect(screen.getByLabelText("你的邮箱")).toBeRequired();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/__tests__/WaitlistForm.test.tsx`

Expected: FAIL，服务和组件不存在。

- [ ] **Step 3: 实现可选 Supabase 客户端**

```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
```

- [ ] **Step 4: 实现写入服务和错误映射**

```ts
import type { Locale } from "../i18n/types";
import { supabase } from "./supabase";

export type Persona = "idea" | "creator" | "investor";
export type WaitlistInput = { name: string; email: string; persona: Persona; locale: Locale; source: "landing-page" };
export type WaitlistResult = { status: "success" | "duplicate" | "error" };

export async function joinWaitlist(input: WaitlistInput): Promise<WaitlistResult> {
  if (!supabase) return { status: "error" };
  const { error } = await supabase.from("waitlist_signups").insert(input);
  if (!error) return { status: "success" };
  if (error.code === "23505") return { status: "duplicate" };
  return { status: "error" };
}
```

- [ ] **Step 5: 实现表单状态机**

`WaitlistForm.tsx` 使用受控 `name`、`email`、`persona`，提交时：

```ts
const result = await joinWaitlist({
  name: name.trim(),
  email: email.trim().toLowerCase(),
  persona,
  locale,
  source: "landing-page",
});
setStatus(result.status);
```

表单使用 `<form aria-label={messages.nav.join}>`；输入框均有可见或屏幕阅读器标签；提交期间禁用按钮；结果放入 `<p role="status" aria-live="polite">`；成功后保留成功状态，不立刻清空以免用户误以为未提交。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- src/__tests__/WaitlistForm.test.tsx`

Expected: PASS。

```bash
git add src/lib src/components/WaitlistForm.tsx src/__tests__/WaitlistForm.test.tsx
git commit -m "feat: connect Supabase waitlist"
```

### Task 8: 提供 Supabase SQL 和 RLS

**Files:**
- Create: `supabase/waitlist.sql`

- [ ] **Step 1: 创建表、约束和索引**

```sql
create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (email = lower(trim(email)) and char_length(email) <= 320),
  persona text not null check (persona in ('idea', 'creator', 'investor')),
  locale text not null check (locale in ('zh-CN', 'en', 'ja', 'ko')),
  source text not null default 'landing-page' check (char_length(source) between 1 and 80),
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_key unique (email)
);

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

revoke all on table public.waitlist_signups from anon, authenticated;
grant insert on table public.waitlist_signups to anon, authenticated;

drop policy if exists "public can join waitlist" on public.waitlist_signups;
create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 80
    and email = lower(trim(email))
    and persona in ('idea', 'creator', 'investor')
    and locale in ('zh-CN', 'en', 'ja', 'ko')
    and source = 'landing-page'
  );
```

- [ ] **Step 2: 在 Supabase SQL Editor 执行并验证**

执行 `supabase/waitlist.sql` 后，用匿名公钥从页面提交一条测试数据。

Expected: INSERT 成功；SELECT、UPDATE、DELETE 从匿名客户端均被 RLS 拒绝；重复邮箱返回 PostgreSQL `23505`。

- [ ] **Step 3: 提交 SQL**

```bash
git add supabase/waitlist.sql
git commit -m "docs: add Supabase waitlist schema"
```

### Task 9: 完成元数据、响应式和发布前验证

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: 更新默认元数据**

`index.html` 使用英文作为无 JavaScript 时的默认元数据：

```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#090908" />
  <meta name="description" content="Bee Game Studio turns an idea into a game you can experience and keep shaping." />
  <meta property="og:title" content="Bee Game Studio — Make imagination real." />
  <meta property="og:description" content="A new way to create games, beginning with what you want to play." />
  <meta property="og:image" content="/og.png" />
  <title>Bee Game Studio — Make imagination real.</title>
</head>
```

LocaleProvider 切换语言时同步更新 `document.title` 和 description，所需值放入四语 `Messages.meta`。

- [ ] **Step 2: 添加项目说明**

README 写明：

```markdown
## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `supabase/waitlist.sql` in the Supabase SQL Editor.
4. Run `npm install` and `npm run dev`.

The browser receives only the Supabase anonymous key. Never expose a service-role key in a Vite environment variable.
```

把 `/.superpowers/` 加入 `.gitignore`，避免头脑风暴预览文件进入产品仓库。

- [ ] **Step 3: 运行全部自动验证**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: 所有测试 PASS；Vite 构建成功；无空白错误。

- [ ] **Step 4: 在四种语言和三种视口进行视觉检查**

Run: `npm run dev`

检查 1440×900、768×1024、390×844：

- 每种语言标题都没有单个标点或孤立词落在新行；
- 导航、语言选择器和候补名单按钮不重叠；
- 首屏图像裁切不遮挡标题；
- 正文宽度和行距适合对应语言；
- 键盘可访问所有链接、选择器和表单；
- 开启“减少动态效果”后无持续动画；
- 无横向滚动。

- [ ] **Step 5: 最终提交**

```bash
git add index.html src/styles.css src/i18n README.md .gitignore
git commit -m "chore: prepare landing page for launch"
```

## 最终完成条件

- `npm test` 全部通过；
- `npm run build` 成功；
- 四种语言自动检测和手动切换均通过；
- Supabase 匿名写入成功且匿名读取被拒绝；
- 候补名单所有状态均已本地化；
- 桌面、平板、手机没有排版溢出；
- 插图与已确认视觉方向一致；
- 项目中不残留旧页面、伪造案例或通用 AI 营销组件。
