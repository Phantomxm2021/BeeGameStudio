# Runtime cost and presentation tradeoffs

Use for a measured runtime problem or a consequential implementation-cost choice. A small effect/binding repair does not require a performance audit. For an unbuilt design, choose a supported, proportionate representation and label cost estimates; do not claim measured savings.

## Match the work to the bottleneck

| Evidence to distinguish | Candidate change | Cost or correctness relationship to preserve |
| --- | --- | --- |
| CPU repeatedly builds unchanged paths, gradients or static subtrees | Reuse static geometry or an existing cached drawing/texture | Cache uses memory and needs invalidation for real changes, scale or fonts; caching a frequently changing subtree can cost more |
| Text/layout work repeats although displayed content/constraints are unchanged | Update when relevant inputs change; reuse stable layout/font results where the runtime supports it | Current values, wrapping, responsive layout, focus and control identity still need correct updates; a continuous visual tween may genuinely require frames |
| GPU/fill pressure rises with overlapping transparent effects, masks or filters | Reduce unnecessary coverage, isolate an effect region or use a simpler treatment | Preserve silhouettes, required emphasis and occlusion; fewer objects do not guarantee fewer pixels or cheaper filters |
| Allocation/GC spikes coincide with frequent creation/destruction | Reuse owned resources or the engine's suitable pool when lifecycle data supports it | Retained memory, stale callbacks/state and shared-resource ownership need checking; pooling is not a prerequisite |
| First-use stalls occur during decode or texture upload | Load/prepare the required asset before its imminent use or stage optional loads | Do not turn all assets into startup dependencies; preloading moves cost and can increase first-interaction time/memory |
| Pixel cost rises with output resolution/antialiasing | Compare appropriate resolution or selective quality settings on the target | Lower resolution can blur text/edges and alter hit mapping if spaces are mixed; inspect the same view rather than assume a mobile quality tier |

These are candidate relationships, not diagnoses from symptoms alone. Use actual engine facilities/version before adding a cache, worker, pool or renderer abstraction. Batching may reduce submissions, but reordering transparent objects can change the picture. Culling adds bounds work and may hurt a CPU-bound scene; a static always-visible HUD does not automatically benefit.

## Observe the same meaningful situation

Keep build mode, target device/browser, viewport, resolution, game state/action path and cold versus warm loading comparable. Use the actual runtime's profiler or available browser tools to distinguish CPU/update/layout, GPU/rendering, loading and memory. Collect enough samples for the observed question and retain duration/sample count alongside typical and tail behavior; average FPS alone can hide a pause or rare long frame. Choose targets from requirements, not universal limits.

A browser `requestAnimationFrame` interval measures scheduling/display cadence, not GPU execution or physical input latency. A heap figure is not total texture/audio/device memory. Headless observations do not certify the player's device. Video/audio recording, diagnostic overlays and profilers add work; use a suitably uninstrumented comparison for a performance claim when their overhead matters. Existing captures can still answer composition/motion questions without serving as the timing baseline.

For memory across retries or scene transitions, distinguish intended caches/shared assets from resources still growing after equivalent returns. Release only what the departing owner owns; unloading a shared atlas can break another scene. Do not infer a leak from one elevated memory sample or add global destruction to hide it.

## Preserve the chosen experience

Suppose a hypothetical board redraws an elaborate but unchanged frame while its cells and lamps change. Reusing the frame may reduce repeated work without changing the look. Caching the entire board instead would require updates for cell/lighting changes and could conceal current state. Compare the relevant rendering work and the same state change; a cached screenshot matching one frame is insufficient.

Preserve required subject identity, facing/contact alignment, decision-critical text, feedback meaning and input response. When a measured effect is too expensive, first remove duplicate work or reduce nonessential coverage/density before altering those requirements. A material quality/scope change needs the authorized decision. Record the changed relationship and before/after observation in the existing task evidence, not another quality ledger. More speed without correct state or the chosen presentation is not a successful optimization.

Primary method sources: [MDN Canvas optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) describes repeated/static drawing reuse; [PixiJS performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips) and its [performance Skill](https://github.com/pixijs/pixijs/blob/dev/skills/pixijs-performance/SKILL.md) discuss text updates, caching, batching, filters and culling tradeoffs. Adapt mechanisms to the selected runtime, not their API snippets, fixed counts or assumptions as cross-engine rules.
