
## Scene Management

### Creating New Scenes
Always include essential components:
```
1. Create scene
2. Add Main Camera
3. Add Directional Light
4. Save scene
```

### Before Major Operations
Save the scene:
```
manage_scene(action="save")
```

### Visual Verification
Take screenshots to verify results:
```
manage_scene(
    action="screenshot",
    screenshot_file_name="verification.png"
)
```
