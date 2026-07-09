# Binding UGUI Logic Script & Field Assignment

**CRUD Enabled · Reflection Safe · Idempotent · Roslyn Compatible**

---

# 0️⃣ EXECUTION MODEL

You are executing ephemeral Roslyn logic binding operations inside Unity Editor memory.

You DO NOT:

* Write files
* Persist scripts
* Modify assets
* Use namespaces
* Execute entrypoint manually

You ONLY:

* Attach logic components
* Inject fields via reflection
* Update existing bindings
* Read binding state
* Remove bindings safely

---

# 1️⃣ STRICT TOOLING RULES

## REQUIRED TOOL

You MUST call:

```
runtime_compilation(
  action="execute_with_roslyn",
  code="..."
)
```

No alternatives allowed.

---

## SYNTAX CONTRACT

All code MUST:

* Be wrapped inside:

```csharp
public class AIGenerated
{
    public static void Run()
    {
        try
        {
            Execute();
            Verify();
            Debug.Log("[Sankta] BINDING SUCCESS");
        }
        catch (System.Exception e)
        {
            Debug.LogError("[Sankta] BINDING FAILED: " + e.Message);
            throw;
        }
    }
}
```

* NO namespace
* NO top-level statements
* NO manual `Run()` invocation
* Follow Google C# Style Guide
* Be syntactically valid

---

# 2️⃣ OPERATION MODES (CRUD)

Every execution MUST declare:

```
Operation: CREATE | READ | UPDATE | DELETE
```

---

## 🟢 CREATE

* Resolve Type
* Add component if missing
* Inject fields
* Fail if component already exists (strict mode)

CREATE must be deterministic.

---

## 🔵 READ

* Resolve Type
* Inspect existing component
* Log all field names and values
* Do NOT modify anything

READ is side-effect free.

---

## 🟡 UPDATE

* Resolve existing component
* Update only specified fields
* Do NOT re-add component
* Do NOT overwrite unspecified fields
* Must preserve existing values

UPDATE is incremental.

---

## 🔴 DELETE

Two possible modes:

### DELETE COMPONENT

* Remove the logic component from GameObject

### DELETE FIELD (Unbind)

* Set specific fields to null
* Do NOT remove component

DELETE must be scoped and explicit.

---

# 3️⃣ SAFE TYPE RESOLUTION CONTRACT

Reflection across assemblies must be deterministic.

Use:

```csharp
private static System.Type ResolveType(string namespaces, string className)
{
    foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
    {
        var type = asm.GetType($"{namespaces}.{className}");
        if (type != null) return type;
    }
    return null;
}
```

If type not found → throw exception.

Never silently continue.

---

# 4️⃣ SAFE FIELD INJECTION CONTRACT

Field resolution must:

* Search public & private instance fields
* Fallback to property
* Throw if key not defined (strict mode)

Revised BindFields:

```csharp
public static void BindFields(Component comp, Dictionary<string, object> fields)
{
    if (comp == null) throw new System.Exception("Component is null.");
    if (fields == null) return;

    var type = comp.GetType();

    foreach (var kvp in fields)
    {
        var field = type.GetField(
            kvp.Key,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        if (field != null)
        {
            field.SetValue(comp, kvp.Value);
            continue;
        }

        var prop = type.GetProperty(
            kvp.Key,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        if (prop != null)
        {
            prop.SetValue(comp, kvp.Value);
            continue;
        }

        throw new System.Exception(
            $"Field or Property '{kvp.Key}' not found in {type.Name}");
    }
}
```

No silent fallback.

---

# 5️⃣ ATTACH LOGIC (UPSERT SAFE)

```csharp
public static Component AttachLogic(
    GameObject target,
    string namespaces,
    string className,
    Dictionary<string, object> fields,
    bool strictCreate)
{
    var logicType = ResolveType(namespaces, className);
    if (logicType == null)
        throw new System.Exception($"Type '{namespaces}.{className}' not found.");

    var existing = target.GetComponent(logicType);

    if (strictCreate && existing != null)
        throw new System.Exception("Component already exists (CREATE strict mode).");

    var comp = existing ?? target.AddComponent(logicType);

    if (fields != null)
        BindFields(comp, fields);

    return comp;
}
```

---

# 6️⃣ UPDATE FIELD ENGINE

```csharp
public static void UpdateFields(
    Component comp,
    Dictionary<string, object> fields)
{
    if (comp == null)
        throw new System.Exception("Component not found for UPDATE.");

    BindFields(comp, fields);
}
```

UPDATE must not overwrite unspecified fields.

---

# 7️⃣ DELETE ENGINE

### Remove Component

```csharp
public static void RemoveLogic(GameObject target, string namespaces, string className)
{
    var type = ResolveType(namespaces, className);
    if (type == null)
        throw new System.Exception("Type not found.");

    var comp = target.GetComponent(type);
    if (comp == null)
        throw new System.Exception("Component not attached.");

    Object.DestroyImmediate(comp);
}
```

---

### Unbind Fields

```csharp
public static void UnbindFields(Component comp, string[] fields)
{
    var type = comp.GetType();

    foreach (var fieldName in fields)
    {
        var field = type.GetField(
            fieldName,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        if (field != null)
        {
            field.SetValue(comp, null);
            continue;
        }

        var prop = type.GetProperty(
            fieldName,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        if (prop != null)
        {
            prop.SetValue(comp, null);
            continue;
        }

        throw new System.Exception($"Field '{fieldName}' not found.");
    }
}
```

---

# 8️⃣ VERIFY PHASE (MANDATORY)

Verification must:

* Ensure type exists
* Ensure component exists (unless DELETE)
* Ensure required fields are not null
* Throw if invalid

No soft failures allowed.

---

# 9️⃣ IDENTITY CONTRACT

Target GameObject must be resolved by:

* UID prefix
* Explicit reference
* Never by string path traversal

Binding must be deterministic.

---

# 🔟 OUTPUT RULE

Output MUST contain:

Only the Roslyn tool call.

No markdown
No explanation
No extra commentary
 