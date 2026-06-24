## Before Making Changes

### 1. Check Editor State
Always verify Unity isn't compiling before making changes:

```
Read resource: mcpforunity://editor/state
Check: isCompiling field
If true: Wait before proceeding
```

### 2. Check for Existing Errors
**IMPORTANT:** The console may contain stale data. Always refresh before reading:

```
refresh_unity(scope="scripts", compile="request", wait_for_ready=true)
read_console(action="get", types=["error"])
```

This ensures you see current compilation errors, not cached/stale results.

### 3. Verify Scene Context
Check which scene is active:

```
manage_scene(action="get_active")
```
