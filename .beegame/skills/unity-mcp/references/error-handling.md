
## Error Handling

### Compilation Errors
```
1. Call refresh_unity(scope="scripts", compile="request", wait_for_ready=true)
2. Read console: read_console(action="get", types=["error"])
3. Identify the error message and file
4. Fix the error in the script
5. Repeat steps 1-2 to verify the fix
```

**IMPORTANT:** Always refresh before reading console! Without refresh, the console may show outdated errors.

### Missing Components
```
1. Check if component exists on GameObject
2. If missing, add component first
3. Then set properties
```

### Asset Not Found
```
1. Use manage_asset(action="search") to find asset
2. Verify path is correct
3. Check if asset exists in project
```
