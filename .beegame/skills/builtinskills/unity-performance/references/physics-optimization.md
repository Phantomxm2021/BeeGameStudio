# Physics Optimization (Unity)

## Goals
- Reduce collision checks
- Minimize FixedUpdate cost

## Rules

1. Configure Layer Collision Matrix
2. Disable unnecessary collision pairs
3. Use LayerMask in Raycast
4. Reduce Fixed Timestep if needed
5. Avoid excessive Rigidbody count
6. Let Rigidbody sleep

## Avoid

- Raycast in Update (unless critical)
- Continuous collision on all objects
