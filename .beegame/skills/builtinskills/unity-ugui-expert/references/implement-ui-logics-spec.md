# Implement UI Logics Spec

> **Role**: Unity Client Developer (XRMOD Specialist)
> **Objective**: Implement robust, decoupled UI logic scripts that strictly adhere to the XRMOD Framework lifecycle.

---

## 1. The XRMOD Standard (NON-NEGOTIABLE)

In this environment, you are **NOT** writing standard Unity MonoBehaviours. You are writing **XRMOD Modules**.
Failure to follow these core rules will result in immediate runtime crashes (`NullReferenceException`) due to the framework's asynchronous binding nature.

### A. Inheritance & Namespace
- **MUST** inherit from: `XRMODBehaviour` (NOT `MonoBehaviour`).
- **MUST** use namespace: `using Phantom.XRMOD.Core.Runtime;`

### B. The "Awake Guard" (Lifecycle Safety **IF NEED**)
XRMOD instantiates objects *before* injecting dependencies. Running initialization logic immediately in `Awake` is **FATAL**.
You **MUST** gate your `Awake` method:

```csharp
protected void Awake()
{
    // CRITICAL: Stop execution if XRMOD hasn't finished binding this component
    if (!enabled) return; 
}
```

---

## 2. Decoupled Architecture

### A. Communication Pattern
**Strict Rule**: UI Components must **never** directly reference Game Systems or Logic Managers.
Instead, use the **`UnityFusionEventBus`**.

- **To Send Data**: Publish an Event.
- **To Receive Data**: Subscribe to an Event in `OnEnable`.

```csharp
private void OnEnable()
{
    if (!enabled) return;
    // Subscribe to domain events
    UnityFusionEventBus.Subscribe<PlayerHealthChangedEvent>(OnHealthChanged);
}

private void OnDisable()
{
    // MANDATORY: Prevention of memory leaks
    UnityFusionEventBus.Unsubscribe<PlayerHealthChangedEvent>(OnHealthChanged);
}
```

### B. Component Binding
- **Prefer**: `[SerializeField] private` for reliable, inspector-assigned references.
- **Avoid**: `transform.Find()` strings (brittle).
- **Validation**: If you must look up components effectively, check for nulls immediately in `Awake`.

---

## 3. Implementation Workflow

1.  **Analyze Context**: Identify what data this UI needs (e.g., "Health", "Score").
2.  **Define Events**: Ensure the relevant Event structs exist (or ask to create them).
3.  **Draft Script**:
    -   Inherit `XRMODBehaviour`.
    -   Add `Awake` guard.
    -   Add Event subscriptions.
    -   Implement UI update script (`OnHealthChanged` -> `_slider.value = ...`).
5.  **CURD**: Run `safe_update_script` to CURD the script.
6.  **Validate**: Run `validate_script` to ensure proper compilation.

---

## 4. Code Style & Quality
- **Clarity**: Comments must explain *why* (e.g., "// Gating for XRMOD Binding").
- **Safety**: Use `?.` operators and null checks for all UI references.
- **Formatting**: Standard C# style.  