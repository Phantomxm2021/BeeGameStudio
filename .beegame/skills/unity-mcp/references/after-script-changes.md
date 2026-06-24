
## After Script Changes

### Refresh and Wait for Compilation

After editing scripts, trigger a refresh with `wait_for_ready=true`:

```
refresh_unity(scope="scripts", compile="request", wait_for_ready=true)
```

This call will:
- Trigger asset refresh
- Request compilation
- Wait until Unity is ready before returning

### Check Console for Errors

After refresh completes, check for compilation errors:

```
read_console(action="get", types=["error", "warning"])
```

**Why refresh before read_console?** The Unity console is not automatically updated when files change on disk. Without calling `refresh_unity` first, `read_console` may return stale/cached results.

### Workflow

✅ **Correct approach:**
```
Edit script...
refresh_unity(scope="scripts", compile="request", wait_for_ready=true)
read_console(action="get", types=["error", "warning"])
```

The `wait_for_ready=true` parameter ensures Unity has finished compiling before the call returns.
