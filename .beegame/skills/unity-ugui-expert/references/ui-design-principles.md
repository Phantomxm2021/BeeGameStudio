# UI Design Principles for Spatial & Mobile Interfaces

> **Target Audience**: UI Designers, Architects (e.g., Morphe)  
> **Scope**: Design-level decisions, NOT implementation code

---

## 1. Canvas Mode Selection Guide

| Platform | Recommended Mode | Use Case |
|----------|------------------|----------|
| 2D | Screen Space - Overlay | Standard HUD, menus |
| 3D | Screen Space - Camera | Depth-sorted UI behind 3D objects |
| XR/VR/3D UI | World Space | Diegetic UI attached to world objects |
| Floating UI | World Space | Health bars, name tags above characters |

### Decision Criteria
- **Static HUD**: Use Overlay
- **3D Integration**: Use Camera or World Space
- **Character-Attached**: Use World Space with Transform tracking

---

## 2. Responsive Layout Principles

### 2.1 Anchor Strategy
- **Full-Screen Backgrounds**: Anchors = [0,0,1,1] (stretch)
- **Fixed-Size Elements**: Anchors = [0.5,0.5,0.5,0.5] (center)
- **Top Bar**: Anchors = [0,1,1,1] (top stretch)
- **Bottom Bar**: Anchors = [0,0,1,0] (bottom stretch)

### 2.2 Pivot for Animation
- **Scale from Center**: Pivot = [0.5, 0.5]
- **Scale from Bottom**: Pivot = [0.5, 0]
- **Rotate from Corner**: Pivot = [0, 0]

---

## 3. Mobile-Specific Guidelines

### 3.1 Touch Targets
- **Minimum Size**: 44x44 dp (Unity: ~88 pixels at 2x scale)
- **Spacing**: At least 8dp between interactive elements
- **Feedback**: Always provide visual feedback on press

### 3.2 Screen Real Estate
- Avoid cluttering with too many elements
- Use collapsible/expandable panels
- Prioritize essential information

### 3.3 Performance Considerations
- Limit total Canvas count (1-3 for simple UIs)
- Use sub-canvases for frequently updating elements
- Avoid complex nested Layout Groups

---

## 4. Visual Hierarchy & Z-Depth

### 4.1 Layer Order (Low to High)
1. **Background** (z = 0)
2. **Content** (z = 0.1)
3. **Interactive** (z = 0.2)
4. **Overlay/Tooltips** (z = 0.5)
5. **Modal/Popup** (z = 1.0)

### 4.2 Futuristic Aesthetics
| Style | Colors | Materials |
|-------|--------|-----------|
| Glassmorphism | #FFFFFF22, #00000044 | Blur + Transparency |
| Neon Glow | #00FFFF, #FF00FF | Emission + Bloom |
| Holographic | #00FFFF33 | Additive Blend |

---

## 5. Component Hierarchy Template

```
[UI_FeatureName]          <- Canvas Root
├── Bg                    <- Background Image
├── Content               <- Main content container
│   ├── Header            <- Title, icons
│   └── Body              <- Core UI elements
├── Actions               <- Buttons, interactive
└── Overlay               <- Tooltips, floating
```

---

## 6. Naming Conventions (Blueprint)

| Element Type | Prefix | Example |
|-------------|--------|---------|
| Panel | Pnl_ | Pnl_HealthBar |
| Text | Txt_ | Txt_HealthValue |
| Image | Img_ | Img_HealthFill |
| Button | Btn_ | Btn_Attack |
| Icon | Ico_ | Ico_Shield |

 