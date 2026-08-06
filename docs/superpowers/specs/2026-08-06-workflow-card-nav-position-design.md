# Workflow Card Navigation Position Design

## Scope

Move the existing workflow stage navigation controls from the card header to the card's bottom-right corner.

## Invariants

- Change placement only; do not change the two buttons' iconography, circular styling, labels, disabled behavior, counter, or keyboard behavior.
- Preserve the opaque card surface, stacked-card offsets, pointer dragging, old-to-current stage range, and latest-stage action behavior.
- Keep the controls inside the front card so they remain part of the card surface and move with it.

## Layout contract

The existing navigation control group remains a single slot rendered by `WorkflowStageCard`. Its positioning changes to an absolutely positioned bottom-right control group within the card content. The card content receives enough bottom padding to prevent the elapsed-time footer or task content from colliding with the controls.

## Verification

- The deck test asserts that the navigation controls remain inside `workflow-card-front`.
- The deck test asserts the control group uses bottom-right positioning classes.
- Existing deck navigation, keyboard, drag, single-card, typecheck, build, and full frontend test suites remain green.
