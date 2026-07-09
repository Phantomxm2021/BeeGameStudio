# Rendering Optimization (Unity)

## Goals
- Reduce draw calls
- Minimize SetPass calls
- Lower GPU overdraw

## Strategies

1. Enable SRP Batching
2. Use static batching
3. Combine meshes
4. Reduce transparent UI overlap
5. Limit real-time shadows
6. Use LOD groups
7. Enable occlusion culling

## Mobile Target
Draw calls < 100
