

## Common Patterns

### Finding GameObjects by Criteria
```
find_gameobjects(
    search_method="by_name",
    search_term="Player",
    include_inactive=false,
    page_size=10
)
```

### Batch Operations
Use `batch_execute` for multiple operations (10-100x faster):
```
batch_execute(
    commands=[
        {"tool": "manage_gameobject", "params": {...}},
        {"tool": "manage_components", "params": {...}},
        {"tool": "manage_components", "params": {...}}
    ]
)
```

### Safe Property Access
Always verify properties exist before setting:
```
1. Get component with include_properties=true
2. Check if property exists in properties dictionary
3. Set property value
```
