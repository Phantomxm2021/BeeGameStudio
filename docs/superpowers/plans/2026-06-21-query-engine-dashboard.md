# QueryEngine-backed dashboard plan

## Goal

Replace the dashboard's CLI/stdout runner with a Web session host that uses
BeeGame's `QueryEngine.submitMessage()` stream directly.

## Steps

1. Replace the current console subprocess abstraction with a structured BeeGame
   session runner interface.
2. Add a default runner that lazily creates one `QueryEngine` per dashboard
   session and emits SDK messages as dashboard events.
3. Keep the existing `/api/console/*` endpoints temporarily as a compatibility
   shell, but remove stdout/stderr semantics from the implementation.
4. Update the dashboard UI to render structured events instead of ANSI-cleaned
   terminal output.
5. Follow up with permission request UI, endpoint renaming, and artifact panels.

