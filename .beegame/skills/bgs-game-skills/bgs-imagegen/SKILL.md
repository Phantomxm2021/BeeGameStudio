---
name: bgs-imagegen
description: Generate or edit raster assets for BGS projects, including reference boards, illustrations, sprites, textures and transparent cutouts, using available ChatGPT image generation or the configured user/platform image API. Use existing editable vector or code assets for tasks better served by those formats.
---

# BGS Image Generation

Adapted from the upstream ImageGen skill at `a0c769b7dc9d51166096991a71fd6fbfe794a169`; see `LICENSE.txt`. Prompt guidance and examples are shared across both execution paths below. BGS supplies the current assignment, source choices and authorization.

## Choose the execution path

Honor an explicit user choice of ChatGPT, their own image API, or the platform API. Do not change connection settings or credentials to make a generation work.

- **ChatGPT account usage:** when the native `image_gen.imagegen` tool is available and the user has not chosen an API source, prefer it. This uses the connected account's image capability and usage limits; do not promise unlimited free images. Login alone does not prove tool availability or remaining quota.
- **User API or platform API:** use the current project-local `assets.mjs` entry supplied by BGS. Its configured source determines which credentials and billing apply; inspect `cost` before an authorized submission. If native image generation is unavailable before submission, use this existing API path.
- If the chosen path fails or its result is unknown, report that result and follow its recovery instructions. Do not automatically resubmit or switch to another billing source. Selecting a different source requires user authorization, which may already be present in the task.

## Shape and inspect the image

Read [prompting.md](references/prompting.md) when shaping or revising a prompt. It retains the upstream guidance on specificity, composition, exact text, input roles and edit invariants. Read only a relevant section of [sample-prompts.md](references/sample-prompts.md) when a concrete example helps; its labels are optional scaffolding, not required fields or extra creative requirements.

Identify whether the task is a new image or an edit, and whether each supplied image is a target or reference. Inspect local inputs before editing. Use the selected visual direction and resource plan. A generated bitmap cannot replace required runtime behavior, a model or a rig; use existing editable vector/code assets where those are the appropriate deliverable.

Inspect the returned image for subject, style, composition, exact text, transparency and edit invariants. A concrete correction can justify an authorized targeted revision; retain the same checks instead of repeatedly regenerating for vague preferences. Do not force one paid call per asset; follow the existing resource plan and command guidance for compatible sheets.

## Native ChatGPT image tool

Use the actual native tool schema for generation, references, editing and transparency. For local edit/reference images, pass `referenced_image_paths`; for pathless conversation images use the supported recent-image option, without combining both input mechanisms. Keep genuine alpha when transparency is requested.

Use the saved path returned by the tool. For a project asset, copy the selected result into the project's `assets/` directory with a new filename unless replacement was requested. Do not leave a project dependency only in the native generated-images cache. Do not submit the same image request through `assets.mjs` merely to obtain a host receipt or register it.

## BGS API command

Run from the project root, using the current tools directory supplied in context:

- `bun <current-tools-directory>/assets.mjs generate --help` defines request fields, supported inputs, output handling and recovery.
- `bun <current-tools-directory>/assets.mjs cost [quality] [size]` reports the configured source's availability and quote. API billing follows that source; it is separate from ChatGPT account usage.
- `bun <current-tools-directory>/assets.mjs generate <request.json> <assets/path>` submits the authorized request and saves the result.

Keep those help/capability outputs as the single source for parameters, prices and recovery. Do not copy provider/model settings, JSON schemas or retry rules into this skill. Seeing an image in conversation does not pass it to this API: use the request's supported project-relative `referenceImagePath`. Prompt examples do not add support for extra inputs or controls.

## Deliver either result through the existing resource workflow

For project assets from either path, inspect the saved file and use `bun <current-tools-directory>/resources.mjs --help` and its registration contract. Register the actual selected file with its real provenance. Generation does not provide measured atlas frames or prove runtime usability; use the existing resource/atlas tools when those are needed.

Report the saved project path, the source used, and any material inspection or registration limitation. A successful download or tool return alone is not evidence that the image meets the design or works in the game.
