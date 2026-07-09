# Color Language System

## Purpose
Define how color communicates emotion, gameplay state, and hierarchy.

---

## 1. Emotional Palette Mapping

Define:

- Primary Mood Color (world baseline)
- Secondary Emotional Accent
- Danger Color
- Reward Color
- Neutral / Background Tone

Color must be tied to gameplay logic.

Example mapping:
- Red → Damage / Threat
- Green → Heal / Safe
- Yellow → Attention / Temporary boost

Never reuse semantic colors randomly.

---

## 2. Hierarchy Rules

Priority order:

1. Interactive Objects
2. Player Characters
3. Enemies
4. Environment
5. Background

Color contrast must reflect hierarchy.

---

## 3. Saturation Strategy

- High saturation = focus element
- Low saturation = background
- Avoid equal saturation across screen

---

## 4. Platform Adaptation

Mobile:
- Strong contrast
- Limited palette (≤ 5 main colors)

PC:
- Broader palette allowed
- Subtle gradients acceptable

XR:
- Avoid intense color flicker
- Maintain spatial readability
