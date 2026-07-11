# Create Pack dialog layout design

## Selected direction

Use the approved metadata-first layout (visual option B). The top of the dialog
captures the Pack's three defining fields in one compact group: name, dimension,
and primary category. This makes the Pack's purpose clear before the author
selects style or game types.

## Layout

1. Keep the existing header, close button, modal width, outer padding, visual
   tokens, and footer action.
2. Replace the current vertical name field plus a separate two-column metadata
   row with one responsive metadata row:
   - desktop: name takes the wider first column; dimension and primary category
     occupy the remaining columns;
   - narrow screens: stack the same fields without changing their controls.
3. Add a subtle divider after the metadata row.
4. Keep style and game type as separate selection sections, each with its
   existing label, multi-select Tags, custom-value field, and add button.
5. Keep the existing native primary-category select, Tag dimensions, input
   heights, button dimensions, and no internal modal scroll.

## Accessibility and verification

- Existing labels, dialog name, button names, and selected-state semantics stay
  unchanged.
- Add a component assertion for the responsive metadata container/classes.
- Run the Create Pack dialog test and test-mode frontend build.
