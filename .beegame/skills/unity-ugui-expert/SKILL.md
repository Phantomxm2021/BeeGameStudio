---
name: unity-ugui-expert
description: Use when implementing or auditing explicitly Unity UGUI interfaces, responsive layouts, touch targets, Canvas architecture, UI performance, or UI logic binding.
---

# Unity UGUI Expert Skill Document

## 0. Overview

This skill equips the Agent with the capability to construct high-performance, scalable, and industry-standard Unity 2D/3D UI systems. It focuses on resolving common bottlenecks such as Canvas Rebuilds, Fill Rate overdraw, and Layout Group nesting, while enforcing strict naming conventions.

---

## 1. Core Usage Principles

### 1.1 Component Selection Guide

* **Canvas**: The heart of UI modules. Distinguish between **Static Canvases** (rarely changed) and **Dynamic Canvases** (high-frequency updates) to minimize mesh regeneration.
* **Graphic Raycaster**: Remove this from any Canvas that does not require user interaction.
* **TextMesh Pro (TMP)**: **Mandatory Standard**. Legacy `UI.Text` is forbidden to ensure text clarity and rendering efficiency.
* **Image**: Prefer `Simple` or `Sliced` modes. Avoid `Preserve Aspect` unless strictly necessary, as it adds extra calculation overhead.

### 1.2 Render Modes (Spatial Computing Context)

* **Overlay**: Standard HUD, always on top.
* **Camera**: Used for depth sorting between UI and 3D objects.
* **World Space**: **Critical for XR**. Must use a dedicated Event Camera and ensure proper Z-depth sorting for spatial interaction.

---

## 2. Performance Optimization Standards

### 2.1 Minimizing Canvas Rebuilds

* **Separation of Concerns**: Place frequently moving elements (e.g., progress bars, mini-maps) on a sub-canvas. Moving an element in a sub-canvas prevents the parent canvas from rebuilding.
* **Hide vs. Destroy**: Use `Canvas.enabled = false` or `CanvasGroup.alpha = 0` to hide UI. This is significantly cheaper than `SetActive(false)`, which triggers heavy CPU spikes.

### 2.2 Raycast Optimization

* **Raycast Target**: Disable by default! Only enable for interactive components like `Buttons` or `Toggles`.
* **Large Backgrounds**: Ensure all background images have `Raycast Target` unchecked to prevent unnecessary spatial calculations during input events.

### 2.3 Rendering Efficiency

* **Sprite Atlas**: All UI elements must be packed into Atlases to maximize Draw Call Batching.
* **Mask vs. RectMask2D**:
  * **Mask**: GPU Stencil-based. Use only for non-rectangular shapes. High overhead.
  * **RectMask2D**: CPU-side culling. **Preferred** for lists and rectangular windows.
* **Overdraw**: Avoid stacking multiple full-screen transparent images.

---

## 3. Layout Logic & Workflow

### 3.1 Anchors & Responsiveness

* **Anchors**: Must be set relative to the parent container. Use **Stretch** for adaptive filling and **Center/Corner** for fixed-size elements.
* **Pivot**: The core of UI scaling and rotation. Calibrate Pivots before animating.
* **Aspect Ratio Fitter**: Use only for specific media content (e.g., avatars or photo previews).

### 3.2 Layout Group Constraints

* **Avoid Nested Layout Groups**: Nesting `Vertical/Horizontal Layout Groups` leads to $O(n^2)$ layout recalculations.
* **Content Size Fitter**: Use only for dynamic text or auto-expanding lists. Avoid leaving it active on complex root objects.

---

## 4. Engineering & Naming Conventions

### 4.1 Component Prefixes

| Component Type  | Prefix |
| :-------------- | :----- |
| Canvas          | `Cvs_` |
| Image           | `Img_` |
| Button          | `Btn_` |
| Text (TextMeshProUGUI)      | `Txt_` |
| Toggle          | `Tgl_` |
| ScrollRect      | `Sr_`  |
| Panel/Container | `Pnl_` |

### 4.2 Hierarchy Structure

1. **Root**: `[UI_WindowName]` (Attached: Canvas, Canvas Scaler, Graphic Raycaster)
2. **Background**: `Bg`
3. **Content**: `Content`
4. **Interactions**: `Actions` (Container for buttons)
5. **Overlays**: `Overlay` (Pop-ups or tooltips)


### 4.3 For XR Platform
- All UGUI canvas **MUST** add `Tracked Device Graphic Raycaster` component when run on XR platform.

---

## 5. Agent Execution Logic

1. **Discovery Phase**: Identify if the task is "Creation" or "Optimization."
2. **Activation Phase**:
    * Plan Canvas hierarchy based on update frequency.
    * Determine interactive vs. static elements.
3. **Execution Phase**:
    * Auto-disable `Raycast Target` for non-interactive nodes.
    * Implement TMP with the project's global font asset.
    * Opt for manual `RectTransform` adjustments over LayoutGroups for complex, static interfaces.
4. **Validation Phase**: Profile the scene to monitor `Canvas.SendWillRenderCanvases` execution time.
