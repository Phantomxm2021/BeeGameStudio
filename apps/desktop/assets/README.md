# Desktop app icons

The mascot comes from `apps/frontend/public/assets/bgs_logo.svg`. Its original
paths, white fill and transparent eye cutouts are preserved. A dark rounded tile
and transparent outer margin make it legible in Finder, the Dock and Windows.

`app-icon.svg` is the derived vector master. PNG (1024 px), ICNS (16–1024 px) and
ICO (16–256 px) are generated from it. Rebuild with
`node apps/desktop/scripts/generate-icons.mjs` from the repository root. This uses
the existing root `sharp` dependency; generated icons are
included in source so ordinary packaging does not require regenerating them.
