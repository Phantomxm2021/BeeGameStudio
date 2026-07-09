
## Script Management Workflow

### 1. Create Script
```
create_script(
    path="Assets/Scripts/MyScript.cs",
    contents="using UnityEngine;\n\npublic class MyScript : MonoBehaviour\n{\n    // Implementation\n}"
)
```

### 2. Trigger Refresh and Wait for Compilation
```
refresh_unity(scope="scripts", compile="request", wait_for_ready=true)
```

### 3. Check for Compilation Errors
```
read_console(action="get", types=["error"])
If errors exist: Fix them and repeat from step 1
```

### 4. Proceed with Next Step
Only after compilation succeeds and no errors exist.
