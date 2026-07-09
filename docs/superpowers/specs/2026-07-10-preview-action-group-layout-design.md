# Preview Action Group Layout

## Goal

Improve the live preview toolbar so that the refresh action and the action for opening the online version are visually grouped together, while keeping preview start/stop and deployment actions distinct.

## Scope

- Update the action layout in `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`.
- Keep all existing callbacks, labels, tooltips, disabled states, and permission checks unchanged.
- Do not change preview, deployment, or external-link behavior.

## Design

The toolbar will contain two horizontal groups:

1. Primary preview controls: start/stop and deployment.
2. Online preview controls: refresh and open online version.

The online preview group will be placed at the right edge of the toolbar and separated from the primary controls with a small gap. Refresh and open-online-version remain connected within their own segmented `ButtonGroup`, preserving the existing icon-only visual language and separator treatment.

When the preview is unavailable, the existing disabled behavior remains visible for both online preview actions. When the preview is available, refresh still invokes the restart callback and open-online-version still invokes `onOpenExternal` with the current preview URL.

## Validation

- Add or update a focused frontend test to verify the action order and grouping semantics through accessible labels.
- Run the focused dashboard/frontend test suite.
- Run the frontend typecheck/build command if available in the repository scripts.
- Review the final diff to ensure unrelated working-tree changes remain untouched.

## Non-goals

- No copy changes or new translations.
- No changes to toolbar dimensions beyond the spacing required to show the two groups.
- No refactoring of preview state management or deployment dialogs.
