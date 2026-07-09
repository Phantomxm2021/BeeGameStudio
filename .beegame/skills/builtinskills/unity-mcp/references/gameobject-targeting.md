
## GameObject Targeting

**Prefer instance ID (most reliable):**
```
target="12345"
search_method="by_id"
```

**Hierarchy path (good for known structures):**
```
target="Player/Hand/Weapon"
search_method="by_path"
```

**By name (finds first match):**
```
target="Player"
search_method="by_name"
```

**By tag:**
```
target="Enemy"
search_method="by_tag"
```

**By component type:**
```
target="Rigidbody"
search_method="by_component"
```
