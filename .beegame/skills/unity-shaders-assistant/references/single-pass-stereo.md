# Single-Pass Stereo Rendering Reference

## What Is Single-Pass Stereo?

VR renders two views (left and right eye). Single-pass renders both in one draw call instead of two.

| Mode | Draw Calls | Performance |
|------|------------|-------------|
| Multi-Pass | 2x (once per eye) | Slow |
| Single-Pass Instanced | 1x (both eyes) | Fast |

**All VR shaders must support single-pass instanced rendering.**

---

## Required Shader Setup

### Pragmas

```hlsl
#pragma multi_compile_instancing
#pragma instancing_options renderinglayer
```

### Vertex Input Struct

```hlsl
struct appdata
{
    float4 vertex : POSITION;
    float2 uv : TEXCOORD0;
    UNITY_VERTEX_INPUT_INSTANCE_ID  // Required
};
```

### Vertex Output Struct

```hlsl
struct v2f
{
    float4 vertex : SV_POSITION;
    float2 uv : TEXCOORD0;
    UNITY_VERTEX_OUTPUT_STEREO  // Required
};
```

### Vertex Shader

```hlsl
v2f vert(appdata v)
{
    v2f o;

    UNITY_SETUP_INSTANCE_ID(v);           // Required
    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);  // Required

    o.vertex = UnityObjectToClipPos(v.vertex);
    o.uv = v.uv;
    return o;
}
```

### Fragment Shader (If Needed)

```hlsl
fixed4 frag(v2f i) : SV_Target
{
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);  // If using eye-dependent logic

    return tex2D(_MainTex, i.uv);
}
```

---

## Complete Example

```hlsl
Shader "Custom/VR-Compatible-Unlit"
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
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                return tex2D(_MainTex, i.uv) * _Color;
            }
            ENDCG
        }
    }
}
```

---

## Common Issues

### Shader Renders Wrong in One Eye

**Cause:** Missing stereo macros

**Fix:** Add all required macros:
```hlsl
UNITY_VERTEX_INPUT_INSTANCE_ID
UNITY_VERTEX_OUTPUT_STEREO
UNITY_SETUP_INSTANCE_ID(v)
UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o)
```

### Shader Works in Editor, Breaks on Device

**Cause:** Missing instancing pragma

**Fix:** Add:
```hlsl
#pragma multi_compile_instancing
```

### World-Space Calculations Wrong

**Cause:** Using `_WorldSpaceCameraPos` directly

**Fix:** Use stereo-aware version:
```hlsl
float3 worldSpaceViewDir = WorldSpaceViewDir(v.vertex);
// Or use unity_StereoWorldSpaceCameraPos for direct access
```

---

## Eye-Specific Logic

If you need different behavior per eye:

```hlsl
v2f vert(appdata v)
{
    v2f o;
    UNITY_SETUP_INSTANCE_ID(v);
    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

    // Get current eye (0 = left, 1 = right)
    int eyeIndex = unity_StereoEyeIndex;

    // Eye-specific offset (rare, usually avoid)
    float3 offset = eyeIndex == 0 ? float3(-0.01, 0, 0) : float3(0.01, 0, 0);

    o.vertex = UnityObjectToClipPos(v.vertex + offset);
    return o;
}
```

---

## Texture Arrays for Stereo

For render textures that need per-eye content:

```hlsl
UNITY_DECLARE_SCREENSPACE_TEXTURE(_MainTex);

fixed4 frag(v2f i) : SV_Target
{
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
    return UNITY_SAMPLE_SCREENSPACE_TEXTURE(_MainTex, i.uv);
}
```

---

## Testing Checklist

- [ ] `#pragma multi_compile_instancing` present
- [ ] `UNITY_VERTEX_INPUT_INSTANCE_ID` in appdata
- [ ] `UNITY_VERTEX_OUTPUT_STEREO` in v2f
- [ ] `UNITY_SETUP_INSTANCE_ID(v)` in vertex shader
- [ ] `UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o)` in vertex shader
- [ ] Tested on device, both eyes correct
- [ ] No visual differences between eyes (unless intentional)
