# Memory Optimization (Unity)

## Goals
- Eliminate GC spikes
- Avoid per-frame allocation
- Stabilize memory footprint

## Allocation Hotspots
- Update / FixedUpdate
- Coroutines
- UI updates
- LINQ
- String concatenation

## Rules

1. Never allocate in hot path
2. Reuse collections (Clear instead of new)
3. Cache WaitForSeconds
4. Avoid ToArray()
5. Prefer struct over class for small data
6. Avoid boxing (interface calls on struct)

## GC Monitoring
Profiler → GC.Alloc column  
Target: 0B/frame in steady state
