
## Component Workflow

### Safe Component Modification Pattern

1. **Check if component exists:**
```
manage_gameobject(
    action="get_components",
    target="12345",
    search_method="by_id",
    include_properties=false
)
```

2. **Add component if needed:**
```
manage_components(
    action="add",
    target="12345",
    search_method="by_id",
    component_type="Rigidbody"
)
```

3. **Set component properties:**
```
manage_components(
    action="set_property",
    target="12345",
    search_method="by_id",
    component_type="Rigidbody",
    property="mass",
    value=10.0
)
```
