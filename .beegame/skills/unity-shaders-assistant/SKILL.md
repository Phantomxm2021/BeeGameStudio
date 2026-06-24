---
name: unity-shaders
description: Unity shader patterns - ShaderLab, HLSL, Shader Graph
user-invocable: false
---

# Unity Shaders Skill

**Version:** 1.0
**Stack:** Unity (ShaderLab, HLSL, Shader Graph)

> Patterns for writing and optimizing Unity shaders.

---

## Scope and Boundaries

**This skill covers:**
- ShaderLab structure
- HLSL/CG basics
- Shader Graph patterns
- VR shader considerations
- Performance optimization

**Defers to other skills:**
- `unity-performance`: General optimization
- `vrc-worlds`: VRChat shader restrictions

**Use this skill when:** Writing or modifying Unity shaders.

---

## Core Principles

1. **Simple is Fast** — Fewer instructions, better performance.
2. **Branching is Expensive** — Avoid dynamic if/else in fragment shaders.
3. **Texture Reads Cost** — Minimize samples, use appropriate filtering.
4. **VR Needs Single-Pass** — Write shaders that support instancing.
5. **Mobile Needs Precision** — Use half/fixed where full float isn't needed.

---

## Patterns

### Basic Unlit Shader

```hlsl
Shader "Custom/BasicUnlit"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 100

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float2 uv : TEXCOORD0;
                float4 vertex : SV_POSITION;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = tex2D(_MainTex, i.uv) * _Color;
                return col;
            }
            ENDCG
        }
    }
}
```

### VR Single-Pass Instanced Support

```hlsl
// Required pragmas
#pragma multi_compile_instancing
#pragma instancing_options renderinglayer

// In struct
UNITY_VERTEX_INPUT_INSTANCE_ID    // appdata
UNITY_VERTEX_OUTPUT_STEREO        // v2f

// In vertex shader
UNITY_SETUP_INSTANCE_ID(v);
UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

// In fragment shader (if needed)
UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
```

### Precision Hints (Mobile/Quest)

```hlsl
// Full precision (32-bit) - use sparingly
float4 position;

// Half precision (16-bit) - good for most color/UV
half4 color;
half2 uv;

// Fixed precision (11-bit) - colors, simple math
fixed4 finalColor;
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Dynamic branching in fragment | GPU stalls | Use step(), lerp(), or compile-time branches |
| No instancing support | Breaks VR single-pass | Add instancing pragmas and macros |
| Full precision everywhere | Wastes mobile bandwidth | Use half/fixed where appropriate |
| Dependent texture reads | Cache misses | Calculate UVs in vertex shader |
| Discard/clip overuse | Breaks early-Z | Use alpha testing only when needed |

---

## Checklist

- [ ] Single-pass instanced support for VR
- [ ] Appropriate precision (half/fixed for mobile)
- [ ] No dynamic branching in fragment shader
- [ ] UV calculations in vertex shader
- [ ] Tested on target platform (Quest, mobile)
- [ ] Fallback shader for older hardware

---

## References

- `references/single-pass-stereo.md` — VR single-pass stereo rendering setup

## Assets

- `assets/shader-checklist.md` — Shader development checklist
