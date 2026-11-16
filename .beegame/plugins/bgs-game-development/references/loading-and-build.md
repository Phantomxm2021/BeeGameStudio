# Loading and build diagnosis

Use for black screens, missing images, bad URLs or development/build differences.

## Identify the first failed boundary

| Symptom | Useful next observation |
|---|---|
| No canvas | Host mount, boot exception, game construction and parent size |
| Canvas but no scene | Scene registration/key, preload completion, create exception |
| Missing texture | Requested URL, response type, texture key/frame name |
| Image visible but misplaced | Origin, scale, camera, depth and display/body coordinates |
| Development works, build fails | Public base path, emitted asset URLs, filename case, initialization order |

A dev server may return the HTML app fallback with status 200 for a missing PNG
or JSON. Inspect content type/body and loader events rather than treating every
200 response as a valid asset. Trace the earliest exception instead of adding
fallback textures that hide a broken asset contract.

## Vite and Phaser loading

Files in `public/` are served as static assets; their URLs must account for the
configured deployment base. Bundler-imported URLs are another valid strategy
when the project already uses them. Preserve the existing strategy rather than
assuming assets can only be referenced through one directory.

Phaser texture keys, URLs and atlas frame names are separate identifiers.
Scenes can share cached textures but should not assume an unrelated asynchronous
loader has completed. A loader progress bar communicates queued file progress;
it does not prove every needed file was actually queued.

## Build and runtime observations

Use project TypeScript/build commands when they resolve a relevant uncertainty.
Phaser 4 exports its own types; inherited Phaser 3 type-root configuration can
cause resolution errors. `import.meta.env` requires matching host typings when
used. A type cast does not make a missing plugin or removed method available.

Observe changed behavior with the project's available runtime tools. A clean
compile cannot establish that a scene renders, an input works or an audio clip
plays. Conversely, a screenshot cannot establish collision transitions or save
restoration. Select the evidence that answers the actual change; no bundled
harness, global debug property, report schema or full-suite rerun is prescribed.

Source topics: phaser-init, phaser-build, phaser-debugger.

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).
