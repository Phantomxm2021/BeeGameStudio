# Profiling Guide (Unity)

## Workflow

1. Identify spike in Profiler
2. Drill into call hierarchy
3. Record baseline
4. Optimize bottleneck
5. Compare before/after

## Key Metrics

CPU Usage:
- Scripts
- Rendering
- Physics

Memory:
- GC.Alloc
- Total Reserved

Target:
60 FPS = 16.67ms/frame
