---
name: unity-mcp
description: .Orchestrate Unity Editor via MCP (Model Context Protocol) tools and resources. Use when working with Unity projects through MCP for Unity - creating/modifying GameObjects, editing scripts, managing scenes, running tests, or any Unity Editor automation. Provides best practices, tool schemas, and workflow patterns for effective Unity-MCP integration.
version: 1.1.0
category: Tooling/MCP
tags: [Automation, UnityEditor, Scripts, Assets]
security:
  risk_level: high
  require_confirmation: false # Set to false by default as it's a core tool, but risk is high
context_strategy:
  references: 
  - id: best-practices-summary
    title: Best Practices Summary
    description: Summary of best practices for using Unity MCP
    audience: [implementation]
  - id: complete-script-modification-workflow
    title: Complete Script Modification Workflow
    description: Example workflow for modifying scripts using Unity MCP
    audience: [implementation]
  - id: multiple-unity-instances
    title: Multiple Unity Instances
    description: Information about handling multiple Unity instances
    audience: [implementation]
  - id: custom-tools
    title: Custom Tools
    description: Information about custom tools
    audience: [implementation]
  - id: before-making-changes 
    title: Before Making Changes
    description: Information about before making changes
    audience: [implementation]
  - id: after-script-changes
    title: After Script Changes
    description: Information about after script changes
    audience: [implementation]
  - id: best-practices-summary
    title: Best Practices Summary
    description: Summary of best practices for using Unity MCP
    audience: [implementation]
  - id: common-patterns
    title: Common Patterns
    description: Information about common patterns
    audience: [implementation]
  - id: component-workflow
    title: Component Workflow
    description: Information about component workflow
    audience: [implementation]
  - id: gameobject-targeting
    title: GameObject Targeting
    description: Information about GameObject targeting
    audience: [implementation]
  - id: scene-management
    title: Scene Management
    description: Information about scene management
    audience: [implementation]
  - id: error-handling
    title: Error Handling
    description: Information about error handling
    audience: [implementation]
  - id: resource-vs-tool-usage
    title: Resource vs Tool Usage
    description: Information about resource vs tool usage
    audience: [implementation]
  - id: script-management-workflow
    title: Script Management Workflow
    description: Example workflow for managing scripts using Unity MCP
    audience: [implementation]
---

# Unity MCP Skill
This skill helps you effectively use the Unity Editor with MCP tools and resources.

## Resource URIs: Do NOT Guess

Resource URIs use a specific scheme — do NOT guess or fabricate them. If you are unsure of a URI, call `ListMcpResourcesTool(server="UnityMCP")` first to get the exact list. Common URIs:

| Resource | URI |
|----------|-----|
| Editor state | `mcpforunity://editor/state` |
| Project info | `mcpforunity://project/info` |
| Scene GameObject API | `mcpforunity://scene/gameobject-api` |
| Tags | `mcpforunity://project/tags` |
| Layers | `mcpforunity://project/layers` |
| Instances | `mcpforunity://instances` |
| Custom tools | `mcpforunity://custom-tools` |

## Quick Start: Resource-First Workflow

**Always read relevant resources before using tools.** This prevents errors and provides the necessary context.

```
1. Check editor state     → mcpforunity://editor/state
2. Understand the scene   → mcpforunity://scene/gameobject-api
3. Find what you need     → find_gameobjects or resources
4. Take action            → tools (manage_gameobject, create_script, script_apply_edits, apply_text_edits, validate_script, delete_script, get_sha, etc.)
5. Verify results         → read_console, capture_screenshot (in manage_scene), resources
```

### 1. After Writing/Editing Scripts: Always Refresh and Check Console

```python
# After create_script or script_apply_edits:
refresh_unity(mode="force", scope="scripts", compile="request", wait_for_ready=True)
read_console(types=["error"], count=10, include_stacktrace=True)
```

**Why:** Unity must compile scripts before they're usable. Compilation errors block all tool execution.

### 2. Use `batch_execute` for Multiple Operations

```python
# 10-100x faster than sequential calls
batch_execute(
    commands=[
        {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube1", "primitive_type": "Cube"}},
        {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube2", "primitive_type": "Cube"}},
        {"tool": "manage_gameobject", "params": {"action": "create", "name": "Cube3", "primitive_type": "Cube"}}
    ],
    parallel=True  # Hint only: Unity may still execute sequentially
)
```

**Max 25 commands per batch by default (configurable in Unity MCP Tools window, max 100).** Use `fail_fast=True` for dependent operations.

### 3. Use `screenshot` in manage_scene to Verify Visual Results

```python
# Via manage_scene
manage_scene(action="screenshot")  # Returns base64 image

# After creating/modifying objects, verify visually:
# 1. Create objects
# 2. capture screenshot
# 3. Analyze if result matches intent
```

### 4. Check Console After Major Changes

```python
read_console(
    action="get",
    types=["error", "warning"],  # Focus on problems
    count=10,
    format="detailed"
)
```

### 5. Always Check `editor_state` Before Complex Operations

```python
# Read mcpforunity://editor/state to check:
# - is_compiling: Wait if true
# - is_domain_reload_pending: Wait if true  
# - ready_for_tools: Only proceed if true
# - blocking_reasons: Why tools might fail
```

## Parameter Type Conventions

These are common patterns, not strict guarantees. `manage_components.set_property` payload shapes can vary by component/property; if a template fails, inspect the component resource payload and adjust.

### Vectors (position, rotation, scale, color)
```python
# Both forms accepted:
position=[1.0, 2.0, 3.0]        # List
position="[1.0, 2.0, 3.0]"     # JSON string
```

### Booleans
```python
# Both forms accepted:
include_inactive=True           # Boolean
include_inactive="true"         # String
```

### Colors
```python
# Auto-detected format:
color=[255, 0, 0, 255]         # 0-255 range
color=[1.0, 0.0, 0.0, 1.0]    # 0.0-1.0 normalized (auto-converted)
```

### Paths
```python
# Assets-relative (default):
path="Assets/Scripts/MyScript.cs"

# URI forms:
uri="mcpforunity://path/Assets/Scripts/MyScript.cs"
uri="file:///full/path/to/file.cs"
```

## Core Tool Categories

| Category | Key Tools | Use For |
|----------|-----------|---------|
| **Scene** | `manage_scene`, `find_gameobjects` | Scene operations, finding objects |
| **Objects** | `manage_gameobject`, `manage_components` | Creating/modifying GameObjects |
| **Scripts** | `create_script`, `script_apply_edits`, `refresh_unity` | C# code management |
| **Assets** | `manage_asset`, `manage_prefabs` | Asset operations |
| **Editor** | `manage_editor`, `execute_menu_item`, `read_console` | Editor control |
| **Testing** | `run_tests`, `get_test_job` | Unity Test Framework |
| **Batch** | `batch_execute` | Parallel/bulk operations |
| **UI** | `batch_execute` with `manage_gameobject` + `manage_components` | Canvas, Panel, Button, Text, Slider, Toggle, Input Field (see [UI workflows](references/workflows.md#ui-creation-workflows)) |

## Common Workflows

### Creating a New Script and Using It

```python
# 1. Create the script
create_script(
    path="Assets/Scripts/PlayerController.cs",
    contents="using UnityEngine;\n\npublic class PlayerController : MonoBehaviour\n{\n    void Update() { }\n}"
)

# 2. CRITICAL: Refresh and wait for compilation
refresh_unity(mode="force", scope="scripts", compile="request", wait_for_ready=True)

# 3. Check for compilation errors
read_console(types=["error"], count=10)

# 4. Only then attach to GameObject
manage_gameobject(action="modify", target="Player", components_to_add=["PlayerController"])
```

### Finding and Modifying GameObjects

```python
# 1. Find by name/tag/component (returns IDs only)
result = find_gameobjects(search_term="Enemy", search_method="by_tag", page_size=50)

# 2. Get full data via resource
# mcpforunity://scene/gameobject/{instance_id}

# 3. Modify using the ID
manage_gameobject(action="modify", target=instance_id, position=[10, 0, 0])
```

### Running and Monitoring Tests

```python
# 1. Start test run (async)
result = run_tests(mode="EditMode", test_names=["MyTests.TestSomething"])
job_id = result["job_id"]

# 2. Poll for completion
result = get_test_job(job_id=job_id, wait_timeout=60, include_failed_tests=True)
```

## Pagination Pattern

Large queries return paginated results. Always follow `next_cursor`:

```python
cursor = 0
all_items = []
while True:
    result = manage_scene(action="get_hierarchy", page_size=50, cursor=cursor)
    all_items.extend(result["data"]["items"])
    if not result["data"].get("next_cursor"):
        break
    cursor = result["data"]["next_cursor"]
```

## Multi-Instance Workflow

When multiple Unity Editors are running:

```python
# 1. List instances via resource: mcpforunity://instances
# 2. Set active instance
set_active_instance(instance="MyProject@abc123")
# 3. All subsequent calls route to that instance
```

## Error Recovery

| Symptom | Cause | Solution |
|---------|-------|----------|
| Tools return "busy" | Compilation in progress | Wait, check `editor_state` |
| "stale_file" error | File changed since SHA | Re-fetch SHA with `get_sha`, retry |
| Connection lost | Domain reload | Wait ~5s, reconnect |
| Commands fail silently | Wrong instance | Check `set_active_instance` |