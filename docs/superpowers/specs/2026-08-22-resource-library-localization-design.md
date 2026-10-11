# Resource Library Localization Design

## Goal

Make every static, user-visible string in the frontend Resource Library follow the application's selected language.

## Scope

- Localize text in `apps/frontend/src/components/ResourceLibrary`, including visible labels, buttons, status and empty states, validation feedback, placeholders, tooltips, dialog labels, and accessibility labels.
- Localize the Resource Library loading accessibility label in `apps/frontend/src/App.tsx`.
- Support the existing ten frontend locales: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Spanish, Italian, and Portuguese.
- Preserve authored resource data, filenames, paths, user-entered names/tags/styles, and server-provided error text verbatim.

## Architecture

The existing `resourceLibrary` namespace is the single source of UI copy. Each locale JSON file exposes an identical `resourceLibrary` object. Components use `useTranslation('resourceLibrary')`, interpolating counts and indexed labels. `useResourceLibraryText` is removed once callers have migrated; stored enum values and authored data remain unchanged.

## Error Handling

Frontend-owned validation and operation-state messages use translation keys. Backend error payloads are displayed unchanged because the backend is outside this scope and may include diagnostic or user data.

## Verification

Tests prove that selected language changes Resource Library controls and that key dynamic strings resolve from locale data. Resource Library tests and frontend type checking run after the migration.
