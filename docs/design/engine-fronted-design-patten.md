# Bee Game Studio — UI Design Spec v1

## 1. 设计基调

整体方向：

* Dark Mode
* shadcn 体系
* Apple 式克制感
* 少阴影、轻边框
* 低饱和
* 高对比但不刺眼
* 不使用大面积纯黑
* 不使用高饱和蓝作为主视觉

核心关键词：

`Calm / Precise / Minimal / Native / Professional`

---

## 2. 字体

优先：

```css
font-family:
  Inter,
  "SF Pro Text",
  "SF Pro Display",
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

中文：

```css
"PingFang SC",
"Hiragino Sans GB",
"Microsoft YaHei"
```

推荐最终：

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Text",
  "PingFang SC",
  sans-serif;
```

### 字号体系

不要使用太多字号，只保留 7 级：

| Token       | Size | Line Height |  Weight | 用途                 |
| ----------- | ---: | ----------: | ------: | ------------------ |
| `text-xs`   | 11px |        16px |     400 | 时间、meta            |
| `text-sm`   | 12px |        18px | 400/500 | secondary          |
| `text-base` | 13px |        20px |     400 | 默认正文               |
| `text-md`   | 14px |        20px | 400/500 | 控件、Chat            |
| `text-lg`   | 16px |        24px | 500/600 | Section Title      |
| `text-xl`   | 20px |        28px |     600 | Page / Panel Title |
| `text-2xl`  | 28px |        34px |     600 | Empty State 等特殊标题  |

BGS 大部分界面实际上只用：

```text
12 / 13 / 14 / 16 / 20
```

就够了。

---

# 3. Font Weight

只使用四档：

```css
400 Regular
500 Medium
600 Semibold
700 Bold
```

但 700 极少使用。

推荐：

```text
正文            400
Button          500
Tab             500
Card title      500
Panel title     600
重要标题        600
```

不要大量 Bold。

---

# 4. 颜色系统

基于 shadcn semantic token，不直接在组件里写死颜色。

## Background

```css
--background: #090A0C;
--foreground: #F4F4F5;
```

## Surface

```css
--surface-1: #0C0D10;
--surface-2: #101215;
--surface-3: #15171B;
--surface-hover: #191C20;
```

层级关系：

```text
Background
#090A0C

Panel
#0C0D10

Card
#101215

Hover / Elevated
#15171B
```

不要全部一个黑色。

---

# 5. Border

Dark Mode 最重要的视觉语言之一。

```css
--border-subtle: rgba(255,255,255,.06);
--border: rgba(255,255,255,.09);
--border-strong: rgba(255,255,255,.14);
```

对应：

```text
大容器      6%
Card        8–9%
Hover       12%
Focus       14%+
```

推荐默认：

```css
border: 1px solid rgba(255,255,255,.08);
```

---

# 6. 文字颜色

不要全用纯白。

```css
--text-primary: rgba(255,255,255,.92);
--text-secondary: rgba(255,255,255,.62);
--text-muted: rgba(255,255,255,.42);
--text-disabled: rgba(255,255,255,.28);
```

对应：

```text
Title / Important
92%

正文
82–88%

Secondary
62%

Meta / 时间
42%

Disabled
28%
```

推荐：

```css
Primary   #F4F4F5
Secondary #A1A1AA
Muted     #71717A
```

也与 shadcn / zinc 系非常接近。

---

# 7. Accent Color

主 Accent 建议使用偏冷蓝，但非常克制。

```css
--primary: #2F81F7;
--primary-hover: #388BFD;
--primary-active: #1F6FEB;
```

不过不要让整个 UI 都变蓝。

只用于：

* active tab
* focus
* selected
* generation
* links
* progress

面积最好 `< 5%`。

---

# 8. Semantic Colors

## Success

```css
#3FB950
```

## Warning

```css
#D29922
```

## Error

```css
#F85149
```

## Info

```css
#58A6FF
```

统一降低饱和度，不用荧光色。

---

# 9. Radius

这一部分建议严格统一。

```css
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 10px;
--radius-xl: 12px;
--radius-2xl: 16px;
```

使用规则：

| 元素             |  Radius |
| -------------- | ------: |
| Badge          |   4–6px |
| Small Button   |     6px |
| Button         |     8px |
| Input          |     8px |
| Card           |    10px |
| Panel          |    12px |
| Dialog / Sheet | 12–16px |

不要：

```text
20px
24px
32px
```

尤其不要所有元素都做成胶囊。

---

# 10. Pill 使用规则

只有以下可以 Pill：

* Badge
* segmented control
* status
* tiny filter
* icon toggle group

推荐：

```css
border-radius: 999px;
```

普通 Button 不默认 Pill。

---

# 11. Spacing

使用 4px Grid。

```text
4
8
12
16
20
24
32
40
48
```

不要出现：

```text
13px
18px
27px
```

这种随机值。

推荐：

```text
Icon ↔ Text       8px
Control internal  8–12px
Card padding      12–16px
Panel padding     16–20px
Section gap       24px
Large gap         32px
```

---

# 12. Button

## Height

```text
xs    28px
sm    32px
md    36px
lg    40px
```

BGS 主力：

```text
32px / 36px
```

## Padding

```css
padding-inline: 12px;
```

带 icon：

```text
icon 16px
gap 6–8px
```

## Primary

```css
background: #F4F4F5;
color: #090A0C;
```

我更推荐 BGS 用 **白色 Primary Button**，而不是蓝色 Primary。

这会更高级，也更 Apple。

比如：

```text
Build
Generate
Continue
```

可以白底黑字。

蓝色保留给状态和 selection。

---

# 13. Secondary Button

```css
background: transparent;
border: 1px solid rgba(255,255,255,.1);
color: rgba(255,255,255,.88);
```

Hover：

```css
background: rgba(255,255,255,.05);
```

---

# 14. Ghost Button

```css
background: transparent;
border: none;
```

Hover：

```css
background: rgba(255,255,255,.05);
```

适用于：

* toolbar icon
* more
* close
* secondary navigation

---

# 15. Input / Textarea

## Height

```text
Input      36px
Composer   44–96px
```

## Style

```css
background: rgba(255,255,255,.025);
border: 1px solid rgba(255,255,255,.08);
border-radius: 10px;
```

Focus：

```css
border-color: rgba(255,255,255,.18);
box-shadow: 0 0 0 3px rgba(47,129,247,.12);
```

不要很重的蓝色边框。

---

# 16. Card

Card 不应该很“卡片化”。

默认：

```css
background: rgba(255,255,255,.02);
border: 1px solid rgba(255,255,255,.07);
border-radius: 10px;
```

Hover：

```css
background: rgba(255,255,255,.035);
border-color: rgba(255,255,255,.11);
```

不加大阴影。

---

# 17. Panel

大型面板：

```css
background: #0C0D10;
border: 1px solid rgba(255,255,255,.07);
border-radius: 12px;
```

不要 Glass Blur 作为默认设计语言。

Glass 只能少量用于：

* floating toolbar
* overlay controls
* contextual menu

---

# 18. Shadow

默认尽量没有。

允许：

```css
box-shadow:
  0 8px 24px rgba(0,0,0,.24);
```

只用于：

* Dialog
* Popover
* Dropdown
* Floating Panel

普通 Card：

```text
No shadow
```

---

# 19. Divider

```css
height: 1px;
background: rgba(255,255,255,.07);
```

能用 spacing 区分的地方，就不要 divider。

---

# 20. Icon

推荐：

```text
Lucide
```

尺寸：

```text
12px  meta
14px  compact
16px  default
18px  important
20px  feature
24px  empty state
```

绝大多数：

```text
16px
```

Stroke：

```text
1.5–1.75
```

不要 2.5+ 的粗线。

---

# 21. Tab

推荐：

```text
Height: 36px
Font: 14 / 500
```

Inactive：

```css
color: rgba(255,255,255,.5);
```

Active：

```css
color: rgba(255,255,255,.92);
```

Underline：

```css
height: 2px;
```

或者 shadcn 原生 segmented style。

不要：

```text
巨大背景块
大面积蓝色
```

---

# 22. Badge

```text
height 20–22px
padding 6–8px
font 11px / 500
radius 6px
```

不要 Badge 太多。

Badge 只表达：

```text
Ready
Running
Error
New
4
```

---

# 23. Tooltip

```text
font-size: 12px
radius: 6px
padding: 6px 8px
```

```css
background: #202226;
color: #F4F4F5;
```

延迟建议：

```text
500–700ms
```

避免鼠标一过去满屏 Tooltip。

---

# 24. Dropdown / Popover

```text
min-width: 180px
padding: 4px
radius: 10px
```

Item：

```text
height 32px
padding 8px
font 13px
radius 6px
```

Hover：

```css
background: rgba(255,255,255,.06);
```

---

# 25. Scrollbar

尽量弱化。

```css
width: 6px;
```

Track：

```text
transparent
```

Thumb：

```css
rgba(255,255,255,.12)
```

Hover：

```css
rgba(255,255,255,.2)
```

---

# 26. Selection

选中状态不要整个 Card 蓝色。

推荐：

```css
background: rgba(47,129,247,.08);
border-color: rgba(47,129,247,.4);
```

或者只用：

```text
2px accent indicator
```

---

# 27. Focus Ring

统一：

```css
box-shadow:
  0 0 0 2px #090A0C,
  0 0 0 4px rgba(47,129,247,.45);
```

仅 keyboard focus 明显显示。

---

# 28. Hover 动效

统一：

```css
transition:
  background-color 120ms ease,
  border-color 120ms ease,
  color 120ms ease,
  opacity 120ms ease;
```

避免：

```text
300ms+
```

普通 UI 应该非常快。

---

# 29. Panel 动画

Dropdown：

```text
120ms
```

Popover：

```text
140ms
```

Sheet：

```text
180–220ms
```

Dialog：

```text
180ms
```

原则：

> 交互越频繁，动画越短。

---

# 30. Opacity Scale

建议统一：

```css
100% Primary
88%  strong
64%  secondary
48%  muted
32%  disabled
16%  decorative
8%   borders
4%   surface
```

整个产品严格按这套透明度走，会非常统一。

---

# 31. 推荐 CSS Tokens

可以直接作为你项目基础：

```css
:root {
  --radius: 0.625rem;

  --background: #090a0c;
  --foreground: #f4f4f5;

  --card: #0f1013;
  --card-foreground: #f4f4f5;

  --popover: #121417;
  --popover-foreground: #f4f4f5;

  --primary: #f4f4f5;
  --primary-foreground: #090a0c;

  --secondary: #15171b;
  --secondary-foreground: #f4f4f5;

  --muted: #15171b;
  --muted-foreground: #8b8d94;

  --accent: #191c20;
  --accent-foreground: #f4f4f5;

  --destructive: #f85149;

  --border: rgba(255,255,255,.08);
  --input: rgba(255,255,255,.08);

  --ring: #2f81f7;

  --success: #3fb950;
  --warning: #d29922;
  --info: #58a6ff;
}
```
