# Shader Development Checklist

## Before Writing

- [ ] Understand the visual goal
- [ ] Check if existing shader can be modified
- [ ] Determine target platform (Quest/PC/Both)
- [ ] Know the render pipeline (Built-in/URP/HDRP)

---

## Shader Structure

### Properties Block
- [ ] All tweakable values exposed
- [ ] Sensible defaults set
- [ ] Attributes for editor UX (`[HDR]`, `[NoScaleOffset]`)

```hlsl
Properties
{
    _MainTex ("Albedo", 2D) = "white" {}
    [HDR] _EmissionColor ("Emission", Color) = (0,0,0,0)
    [NoScaleOffset] _NormalMap ("Normal", 2D) = "bump" {}
    [Toggle] _UseNormal ("Use Normal Map", Float) = 1
}
```

### Tags
- [ ] RenderType set correctly
- [ ] Queue set if non-standard
- [ ] DisableBatching only if necessary

```hlsl
Tags
{
    "RenderType" = "Opaque"        // Or Transparent, TransparentCutout
    "Queue" = "Geometry"           // Or Transparent, Overlay
    "IgnoreProjector" = "True"     // For transparent
}
```

---

## VR Compatibility

- [ ] `#pragma multi_compile_instancing`
- [ ] `UNITY_VERTEX_INPUT_INSTANCE_ID` in appdata
- [ ] `UNITY_VERTEX_OUTPUT_STEREO` in v2f
- [ ] `UNITY_SETUP_INSTANCE_ID(v)` in vert
- [ ] `UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o)` in vert
- [ ] Tested on VR device with both eyes

---

## Performance

### Mobile/Quest
- [ ] Use `half` and `fixed` where possible
- [ ] Minimize texture samples
- [ ] No dynamic branching in fragment
- [ ] No discard/clip unless necessary
- [ ] Calculate UVs in vertex shader

```hlsl
// ❌ Bad - full precision
float4 color = tex2D(_MainTex, i.uv);

// ✅ Good - half precision
half4 color = tex2D(_MainTex, i.uv);

// ❌ Bad - dynamic branch
if (color.a < 0.5) discard;

// ✅ Better - alpha test variant
#pragma shader_feature _ALPHATEST_ON
#ifdef _ALPHATEST_ON
    clip(color.a - 0.5);
#endif
```

### General
- [ ] Avoid dependent texture reads
- [ ] Use LOD for distant rendering
- [ ] Consider multi-compile vs shader_feature

---

## Precision (Mobile)

| Type | Precision | Use For |
|------|-----------|---------|
| `float` | 32-bit | Position, world coords |
| `half` | 16-bit | Most color, UV, vectors |
| `fixed` | 11-bit | Final color, simple values |

```hlsl
// Typical precision usage
float4 worldPos;        // World position needs precision
half3 normal;           // Normals are fine with half
half2 uv;               // UVs typically fine with half
fixed4 color;           // Final color output
```

---

## Variants

### Multi-Compile vs Shader Feature
```hlsl
// multi_compile: All variants always compiled
// Use for: Runtime toggles, global keywords
#pragma multi_compile _ _SHADOWS_SOFT

// shader_feature: Only used variants compiled
// Use for: Material-specific options
#pragma shader_feature _NORMALMAP
```

### Common Variants
```hlsl
#pragma multi_compile_fog
#pragma multi_compile_instancing
#pragma multi_compile _ _MAIN_LIGHT_SHADOWS
```

---

## Fallback

- [ ] Fallback shader specified
- [ ] Fallback is simpler (mobile-friendly)

```hlsl
SubShader
{
    // Main shader
}

Fallback "Mobile/Diffuse"
```

---

## Testing

### Visual
- [ ] Looks correct in Editor
- [ ] Looks correct on target device
- [ ] Both eyes correct in VR
- [ ] Works with intended lighting

### Performance
- [ ] Batches correctly (check Frame Debugger)
- [ ] GPU time reasonable (check Profiler)
- [ ] No excessive variants (check build log)

### Edge Cases
- [ ] Works with negative scale
- [ ] Works with non-uniform scale
- [ ] Handles missing textures gracefully

---

## Documentation

- [ ] Comment complex calculations
- [ ] Note performance implications
- [ ] Document required setup (layers, textures)

```hlsl
// Calculate rim lighting
// Based on Fresnel effect - brighter at glancing angles
half rim = 1.0 - saturate(dot(viewDir, normal));
rim = pow(rim, _RimPower);  // _RimPower controls falloff
```

---

## Common Bugs

| Bug | Cause | Fix |
|-----|-------|-----|
| Pink/magenta | Shader error | Check console |
| One eye wrong | Missing stereo macros | Add VR macros |
| Black on Quest | Unsupported features | Use mobile-compatible |
| Z-fighting | Same depth values | Offset or change queue |
| Sorting issues | Wrong queue/blend | Check Tags and Blend |
