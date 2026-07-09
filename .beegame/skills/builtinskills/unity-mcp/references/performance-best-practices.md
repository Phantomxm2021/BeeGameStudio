
## Performance Best Practices

### Use Paging for Large Queries

**Scene Hierarchy:**
```
manage_scene(
    action="get_hierarchy",
    page_size=50,
    cursor=0
)
// Follow next_cursor until null
```

**GameObject Components:**
```
manage_gameobject(
    action="get_components",
    target="12345",
    search_method="by_id",
    include_properties=false,  // Start with metadata only
    page_size=10
)
```

**Asset Searches:**
```
manage_asset(
    action="search",
    path="Assets",
    page_size=25,
    generate_preview=false  // IMPORTANT: Avoid large base64 payloads
)
```

### Recommended Page Sizes
- Components with properties: 3-10 items
- Components without properties: 10-25 items
- Scene hierarchy: 50 items
- Asset searches: 25-50 items

### Always Disable Previews
Set `generate_preview=false` in asset searches unless you explicitly need thumbnails (they add large base64 blobs to responses).
