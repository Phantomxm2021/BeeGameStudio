# BeUI components

Sources: official https://beui.dev/r/{name}.json registries, retrieved 2026-09-19.
Included: button-base, switch, tabs, input, tooltip, popover-morph, select,
context-menu, range-slider and their shared utilities.

Integration changes are limited to relative imports, portal placement inside
`.scene-editor-host`, Select popup positioning and keyboard/focus handling.
Scene command adapters and compact sizing live outside this directory.

The frontend Tailwind entry scans this package with `@source`. Keep all CSS
`@import` statements before `@source` so the global design tokens load.
