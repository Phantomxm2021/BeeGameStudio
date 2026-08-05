# Bee Game Studio Landing Page Design

## Purpose

Build a pre-launch product landing page for Bee Game Studio in `apps/landingpage`.
The page must explain a simple product truth: everyone can create a game of
their own, beginning with one idea.

The page is a product presentation, not a technical explainer, an internal
workflow dashboard, or a generic AI-generation campaign. Bee Game Studio stays
visible through a simplified representation of its real idea input, creative
conversation, and playable preview. The copy explains those product moments
through what a person does and how the result changes their life.

## Product Positioning

Primary promise:

> 人人都能做出自己的游戏。只需要一个 idea，就可以开始。

The English and Japanese versions express the same promise naturally rather
than translating it word for word.

The visitor's emotional journey is:

1. I have an idea for a game.
2. I can begin without first becoming a game developer.
3. I can see and play something that used to exist only in my mind.
4. I can keep shaping it by describing the experience I want.
5. I can share the result with people who matter to me.

The page must not lead with models, engines, agents, workflow phases, source
code, token usage, generation speed, or technical architecture. It must not
present Bee as a black-box vending machine that replaces the creator. The
visitor remains the author of the game's direction.

## Expression Principles

The page borrows product-presentation habits associated with Apple product
pages without copying Apple assets or trade dress:

- One human outcome per section.
- Short display copy followed by a restrained explanatory sentence.
- Large product or lifestyle imagery that proves the statement.
- Generous whitespace and a consistent reading axis.
- Product UI appears only where it helps a visitor understand the experience.
- Life scenes explain why the product matters; they do not replace the product.

The copy avoids feature lists disguised as emotional language. For example,
instead of explaining an internal generation workflow, the page says that an
idea can become something the visitor can enter and play.

## Page Narrative

### 1. Navigation

A compact, sticky header contains:

- Bee Game Studio brand mark and name.
- Product, stories, and coming-soon anchor links on desktop.
- A visible language dropdown for Simplified Chinese, English, and Japanese.
- A primary early-access action on desktop.

Mobile keeps the brand and language dropdown while removing secondary links.

### 2. Hero: Everyone Can Make Their Own Game

The hero clearly states the product promise and shows the Bee idea-input
surface immediately. The supporting copy explains that the visitor does not
need to become a game developer before beginning.

The simplified Bee surface is based on the real product interaction:

- A prompt asking what game the visitor wants to make.
- A natural example idea.
- A clear start action.

The surface is a visual demonstration only. It does not pretend to run the
actual Bee creation workflow from the marketing page.

### 3. Begin When the Idea Appears

This section shows a restrained product conversation beside a large playable
preview. It communicates that the visitor can describe the experience they
want, see the result, and continue shaping it.

The copy stays in the visitor's language. It does not expose workflow stages or
technical implementation details.

### 4. The First Time You Play Your Own Game

A full-bleed original game-world illustration becomes the visual climax. The
headline focuses on the first moment the visitor enters a place that previously
existed only in their imagination.

### 5. A Story Shared With a Child

A calm parent-and-child illustration accompanies copy about tonight's story
becoming tomorrow's shared adventure. This is a life outcome, not a claim about
a children's-game feature.

### 6. An Idea Shared With Friends

A dark, intimate illustration shows friends playing a world that began as a
conversation. The copy turns "what if this game existed" into a shared memory.

### 7. Pre-launch Invitation

The final section connects the initial idea to the identity change:

> 从我有一个 idea，到这是我做的游戏。

The primary action is an email early-access form. The secondary action is a
creator-community link. Because no submission backend or community URL is in
scope, the implementation must not transmit data or claim that a remote signup
succeeded. It provides client-side validation and a clearly documented
integration boundary for later connection.

## Visual System

### Color

- `#F5F5F7`: main light canvas.
- `#FFFFFF`: product and content surfaces.
- `#1D1D1F`: primary light-theme text.
- `#050506`: dark product and cinematic sections.
- `#F4B914`: Bee yellow for identity, active states, and the primary dark-theme
  call to action.
- `#0071E3`: restrained link and light-theme action color.

Yellow is a signal, not a background treatment. The page avoids generic AI
gradients and decorative honeycomb patterns.

### Typography

Use a system-first type stack:

```css
-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC",
"Hiragino Sans", sans-serif
```

All languages share the same hierarchy but have locale-specific metrics.

- Simplified Chinese uses compact tracking and semantic display lines.
- English uses slightly larger display type with tighter leading.
- Japanese uses increased leading, `line-break: strict`, and natural Japanese
  line-breaking rules.

Display headlines use line breaks as pauses and omit unnecessary punctuation.
Body copy retains correct punctuation. Chinese and Japanese content uses strict
line-breaking rules so punctuation cannot become an invalid line opening or an
isolated visual fragment.

Every headline translation stores separate desktop and mobile line arrays. The
component renders these authored lines instead of inserting breaks through
keyword, regular-expression, or character-count matching.

### Imagery

Use three original image-generation assets:

1. A warm game-world reveal for the Bee preview and first-play section.
2. Two friends experiencing a game world that grew from their idea.
3. A parent and child exploring a world emerging from a bedtime story.

The images use a restrained charcoal, cream, and Bee-yellow palette. They
contain no embedded text, logos, or recognizable copyrighted characters.

### Motion

Motion is secondary to reading:

- Gentle section entry and product-surface reveal.
- No scroll-jacking.
- No continuous decorative animation.
- Full support for `prefers-reduced-motion`.

## Responsive Layout

Desktop uses a maximum content width around 1160 pixels and full-bleed imagery
for the first-play climax. Lifestyle sections alternate copy and imagery while
preserving one clear reading axis.

At widths below 820 pixels:

- Navigation removes secondary links.
- The hero title uses authored mobile lines.
- Product input content can wrap naturally.
- Product conversation collapses so the game preview remains the main visual.
- Lifestyle sections become a single column.
- Email and action controls stack vertically.

The page must remain usable at 390 pixels wide without horizontal overflow,
orphaned display punctuation, or clipped controls.

## React Architecture

Create a standalone React, TypeScript, and Vite workspace in
`apps/landingpage`.

Recommended component boundaries:

- `App`: locale state and page composition.
- `Header`: brand, anchors, language selection, and primary action.
- `Hero`: primary promise and idea-input product surface.
- `ProductMoment`: conversation and playable-preview composition.
- `FirstPlay`: full-bleed game-world climax.
- `StoryScene`: reusable copy-and-image lifestyle section with reversible
  layout.
- `Waitlist`: client-side email validation and non-network integration state.
- `Footer`: language-independent legal and brand structure.
- `LocalizedHeading`: authored desktop and mobile line rendering.

The translation model is a typed object keyed by `zh`, `en`, and `ja`. Each
locale contains complete page copy and separate desktop/mobile heading lines.
Components receive content through props and contain no product-copy keywords,
regular expressions, or language-specific phrase matching.

## Locale Behavior

- Default to the saved locale when it is one of the three supported values.
- Otherwise default to Simplified Chinese.
- Persist explicit selection in local storage.
- Update `document.documentElement.lang` to `zh-CN`, `en`, or `ja`.
- The language selector remains a real accessible dropdown.
- English and Japanese copy must be written for natural rhythm and visual
  balance, not produced by runtime machine translation.

## Waitlist Behavior

The pre-launch form validates a non-empty, plausible email address using native
input semantics rather than keyword-based product logic. No network request is
made in this deliverable because an endpoint was not provided.

The UI must avoid a false "signup completed" claim. It may acknowledge valid
input as a local preview state and explain the backend integration in the
project README. The form boundary must be small enough to replace with a real
submission adapter later.

## Accessibility

- Semantic sections, headings, navigation, form labels, and buttons.
- Visible keyboard focus.
- Descriptive alt text for meaningful illustrations.
- Decorative UI fragments hidden from assistive technology.
- Sufficient contrast in light and dark sections.
- Motion reduction support.
- Language changes reflected in the document language.

## Error Handling

- Invalid email input remains in place and shows a localized inline message.
- Unsupported saved locale values fall back to Simplified Chinese.
- Image dimensions and fallback backgrounds prevent layout collapse while an
  image loads.
- No external runtime dependency is required for the page to render.

## Verification

Automated checks:

- The page renders the primary product promise.
- The language dropdown switches among Chinese, English, and Japanese.
- Locale selection persists and updates the document language.
- Desktop and mobile heading line variants render for each locale.
- Invalid email input produces localized feedback.
- The waitlist form makes no network request.
- Production build succeeds.

Visual checks:

- Desktop viewport around 1280 by 720.
- Mobile viewport 390 by 844.
- No horizontal overflow.
- No isolated display punctuation or invalid CJK line openings.
- Images crop intentionally and keep their subject visible.
- Product UI remains legible without resembling an internal engineering
  dashboard.

## Out of Scope

- A waitlist backend or CRM integration.
- Authentication.
- Running the real Bee creation workflow from the landing page.
- Product pricing.
- Deployment or hosting configuration.
- Additional locales beyond Simplified Chinese, English, and Japanese.
