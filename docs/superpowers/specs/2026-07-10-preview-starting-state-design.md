# Preview Starting State

## Goal

Give immediate feedback after the user starts a live preview, so the delayed backend startup does not look like an unresponsive button.

## Design

`BeeGameLivePreviewPage` will keep a local `isStartingPreview` flag. The flag is set synchronously when the play action is invoked and cleared when the start callback resolves or rejects. While it is active:

- the preview state is treated as `starting`, so the empty surface shows the existing localized starting message;
- the play control is disabled and displays an animated refresh icon;
- repeated starts are prevented.

The existing backend-derived `build_report` and error handling remain authoritative after the callback completes. No new translations or API changes are needed.

## Validation

- Add a component test that keeps the start callback pending and verifies the button becomes disabled, shows the starting label/state, and prevents a second invocation.
- Run the focused preview tests and frontend build.

## Non-goals

- No full-screen loading overlay.
- No changes to preview server startup or polling behavior.
- No changes to refresh, stop, deploy, or external-link actions.
