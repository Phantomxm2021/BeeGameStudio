
## Example: Complete Script Modification Workflow

```
1. Check existing state (optional but recommended)
   → read_console(action="get", types=["error"])
   → Verify no pre-existing errors

2. Read script content
   → Read("Assets/Scripts/MyScript.cs")

3. Modify script
   → Edit(...) or script_apply_edits(...)

4. Refresh and wait for compilation
   → refresh_unity(scope="scripts", compile="request", wait_for_ready=true)

5. Check console for results
   → read_console(action="get", types=["error", "warning"])
   → If errors exist, fix them and repeat from step 2

6. Proceed to next task
   → Only after confirming no errors
```

This workflow ensures safe, reliable Unity development via MCP.
