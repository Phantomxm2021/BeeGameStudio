---
name: react-vite-vertical-slice
description: Use when implementing a React TypeScript interactive app with Vite, especially when scaffolding, TSX growth, dependency setup, or repeated build-fix loops risk losing a working vertical slice.
---

# React Vite Vertical Slice

## Overview

For React/Vite implementation, follow React's from-scratch/Vite setup shape inside the existing DAC working directory. Create a buildable vertical slice before extracting modules. A small, working entrypoint with upstream IDs in runtime state is better than many disconnected files.

This skill avoids project generators in DAC headless runs because the project root already exists and generators often create nested folders, extra boilerplate, and long install/read cycles. It does not reject React's official setup model; it applies the same minimal Vite-compatible project shape manually so DAC writes only the files required by the current stage.

## Use This Pattern

1. Write the minimal Vite-compatible React project files: `package.json`, `index.html`, `src/main.tsx`, and one stylesheet first.
2. Model upstream IDs directly in runtime state objects: entity/source IDs, action IDs, screen IDs, asset slots.
3. Implement one input action, one state mutation, and one visible render path before adding extra modules.
4. Run `npm install` after writing `package.json`, then run `npm run build`.
5. Only extract modules after the first build passes and the current stage needs more runtime surface.

## Avoid

- Running `npm create`, `create-vite`, template generators, or creating nested project folders inside DAC's existing output root.
- Reading `node_modules`, `dist`, build outputs, or generated dependency files.
- Creating collision/render/asset/UI engines before the first passing build.
- Empty handlers, comments-only TODOs, registry-only source ID tables, or local short-name state that replaces upstream IDs.
- `npm run dev`, `vite --host`, preview, watch, or other long-running commands for final verification.

## Minimal Shape

```tsx
type RuntimeEntity = {
  sourceId: string;
  position: { x: number; y: number };
  state: string;
};

type RuntimeState = {
  screenId: string;
  player: RuntimeEntity;
  score: number;
};
```

Use the actual upstream IDs from `../generated/implementation_spec.md` and the raw structured artifacts it cites instead of placeholder names.
