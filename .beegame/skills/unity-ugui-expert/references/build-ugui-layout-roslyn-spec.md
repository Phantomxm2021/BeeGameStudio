# Build UGUI Layout Spec

**CRUD Enabled · Deterministic · Incremental · Roslyn-Safe**

---

# 0️⃣ EXECUTION MODEL

You are executing **ephemeral Roslyn layout builders**.

You do NOT write files.
You do NOT persist scripts.
You ONLY manipulate Scene hierarchy via runtime compilation.

You build and mutate UI structure deterministically.

---

# 1️⃣ CRITICAL CONSTRAINTS (ABSOLUTE)

## 🚫 BANNED ACTIONS

1. No `.cs` file creation
2. No `batch_execute`
3. No `namespace` blocks
4. No top-level statements
5. No calling `AIGenerated.Run()`
6. No attaching logic MonoBehaviours
7. No AssetDatabase operations
8. No file IO
9. No prefab saving
10. No Selection API usage
11. No ScriptableObject creation

---

## ✅ REQUIRED TOOL

You MUST call:

```
runtime_compilation(
  action="execute_with_roslyn",
  code="..."
)
```

No alternatives allowed.

---

# 2️⃣ OPERATION MODES (CRUD)

Every execution MUST explicitly define:

```
Operation: CREATE | READ | UPDATE | DELETE
```

Behavior depends strictly on operation type.

---

## 🟢 CREATE

* Create new root if not exists
* If root exists → FAIL (do NOT destroy automatically)
* Build full hierarchy
* Assign Stable IDs
* Verify structure

CREATE is non-destructive.

---

## 🔵 READ

* Traverse hierarchy
* Build structured snapshot
* Log tree structure
* Do NOT modify anything

READ is side-effect free.

---

## 🟡 UPDATE

* Must NOT destroy root
* Must locate nodes using Stable ID
* Only mutate targeted nodes
* Must NOT affect unrelated hierarchy
* Verify after patch

UPDATE is incremental and scoped.

---

## 🔴 DELETE

* Locate node by Stable ID
* Destroy ONLY that node
* Must NOT affect siblings
* Throw if target not found

DELETE is scoped.

---

# 3️⃣ STABLE IDENTITY CONTRACT (MANDATORY)

CRUD requires addressable nodes.

Every created GameObject MUST:

```
go.name = "[UID:ScoreText]";
```

Rules:

* Format: `[UID:UniqueId]ReadableName`
* UID must be stable across updates
* All UPDATE and DELETE operations MUST use UID lookup
* Never rely on transform.Find string paths

Helper:

```csharp
private static GameObject FindByUID(string uid)
{
    GameObject[] all = Object.FindObjectsOfType<GameObject>(true);
    foreach (var go in all)
    {
        if (go.name.StartsWith($"[UID:{uid}]"))
            return go;
    }
    return null;
}
```

---

# 4️⃣ RECTTRANSFORM SAFETY STANDARD

Every RectTransform MUST explicitly define:

* anchorMin
* anchorMax
* pivot
* anchoredPosition
* sizeDelta

No reliance on Unity defaults.

---

# 5️⃣ LAYOUT SCOPE RESTRICTION

You ONLY manage:

* Hierarchy
* RectTransform
* LayoutGroups
* Image
* Button
* TMP_Text
* Default or specified Font

You MUST NOT:

* Bind logic
* Subscribe events
* Access game systems
* Add custom scripts

---

# 6️⃣ STRICT ROSLYN TEMPLATE

All generated code MUST follow:

```csharp
using UnityEngine;
using UnityEngine.UI;
using UnityEditor;
using TMPro;

public class AIGenerated
{
    public static void Run()
    {
        try
        {
            Execute();
            Verify();
            Debug.Log("[Sankta] OPERATION SUCCESS");
        }
        catch (System.Exception e)
        {
            Debug.LogError("[Sankta] OPERATION FAILED: " + e.Message);
            throw;
        }
    }
```

NO namespace.
NO top-level code.
All helpers inside class.

---

# 7️⃣ BUILD / PATCH STRUCTURE

You MUST implement:

```
private static void Execute()
```

This method switches behavior based on Operation.

Example pattern:

```csharp
private const string ROOT_UID = "MainUI";

private static void Execute()
{
    string operation = "UPDATE";

    if (operation == "CREATE")
    {
        CreateRoot();
    }
    else if (operation == "READ")
    {
        ReadTree();
    }
    else if (operation == "UPDATE")
    {
        UpdateNode("ScoreText");
    }
    else if (operation == "DELETE")
    {
        DeleteNode("ScoreText");
    }
}
```

---

# 8️⃣ READ SNAPSHOT REQUIREMENT

READ mode must:

* Recursively traverse children
* Log hierarchy depth
* Log UID
* Log RectTransform key properties

Example:

```
[Sankta-Read] UID=ScoreText | AnchorMin=(0,0)
```

Must not modify scene.

---

# 9️⃣ VERIFY PHASE (MANDATORY)

Verify must:

* Ensure root exists (except DELETE root case)
* Ensure no duplicate UIDs
* Ensure RectTransform properties set
* Throw exception if invalid

Verification failure must stop execution.

---

# 🔟 SAFETY RULES

Before finishing, ensure:

* No namespace block
* No entrypoint call
* All RectTransforms explicit
* UID used for all targeting
* No global destruction in UPDATE
* No unintended side effects

---

# 1️⃣1️⃣ OUTPUT RULE

Your output MUST contain:

Only the Roslyn tool call.

No commentary.
No markdown.
No explanation.
No code fences.

Only:

```
runtime_compilation(...)
```

---

# 1️⃣2️⃣ SYSTEM INTENT

This engine is:

* Deterministic
* Incremental
* Addressable
* Safe for repeated execution
* Compatible with large-scale UI pipelines

It is NOT:

* A visual editor
* A prefab generator
* A logic binder
 