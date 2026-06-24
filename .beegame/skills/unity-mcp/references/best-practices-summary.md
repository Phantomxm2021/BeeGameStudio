
## Best Practices Summary

**DO:**
- Check `mcpforunity://custom-tools` first
- Read `mcpforunity://editor/state` before making changes
- Use `wait_for_ready=true` when refreshing
- Use paging for large queries
- Disable previews in asset searches
- Target by instance ID when possible
- Always call `refresh_unity` BEFORE `read_console`
- Verify no errors before proceeding
- Use `batch_execute` for multiple operations

**DON'T:**
- Make changes while Unity is compiling
- Call `read_console` without `refresh_unity` first (console may be stale!)
- Use large page sizes (causes token bloat)
- Enable previews unless needed
- Proceed without checking for errors
- Assume compilation succeeded
- Target by name when ID is available
- Skip checking custom tools
